/**
 * Roda os renderizadores da própria página contra um progress.json, num DOM de
 * brinquedo. Serve para pegar o erro clássico deste tracker: a config muda de
 * chave ou de campo, a página continua "funcionando" e simplesmente deixa de
 * marcar as linhas.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { install, stripTags } = require('./domshim.js');

const RAIZ = path.join(__dirname, '..');
const PAGINA = path.join(RAIZ, 'trackeroao.html');

const IDS = ['categories', 'topics', 'essentials', 'beads', 'seeds', 'bosses', 'minibosses', 'headless',
  'deaths', 'deathsCount', 'deathsNote', 'syncDot', 'syncText', 'anelFio', 'overallPct', 'overallCount', 'tempoNum', 'skillEmote', 'marcos', 'bossPanel', 'bossHead', 'bossNum', 'bossLista', 'bossNota', 'quadroTempo', 'tempoRot', 'therm', 'thermFill', 'thermPin',
  'idols', 'novidades', 'syncDot', 'syncText', 'overallCount', 'overallLabel', 'overallBar',
  'themeBtn',
  // As listas passaram a morar dentro de janelas nativas.
  'bossJanela', 'headlessJanela', 'conqJanela', 'headlessPanel', 'headlessHead',
  'headlessNum', 'headlessLista', 'anelPanel', 'anelHead', 'conqLista'];

/**
 * Carrega o <script> da página num contexto com `sync` já preenchido.
 * A página busca o progress.json sozinha no boot; aqui trocamos isso por uma
 * injeção direta, porque o que queremos testar é o render, não o fetch.
 */
async function carregar(progress, opts) {
  const html = fs.readFileSync(PAGINA, 'utf8');
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (blocos.length !== 1) throw new Error('esperava um único <script>, achei ' + blocos.length);

  const nodes = install(IDS, opts);
  // O progresso entra pelo mesmo caminho do navegador — fetch e pollProgress —
  // em vez de ser enfiado numa variável. Assim o teste cobre também a leitura
  // da resposta, e não só o render.
  let atual = progress;
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(atual) });

  // Contexto novo a cada carga, e não o global do processo: o script declara
  // `const DATA` no topo, então rodá-lo duas vezes no mesmo contexto estoura
  // com "já declarado". `createContext({})` dá um ambiente com os embutidos
  // próprios, e por cima entram os nossos remendos.
  const ctx = vm.createContext({});
  Object.assign(ctx, {
    document: global.document,
    localStorage: global.localStorage,
    window: global.window,
    location: global.location,
    fetch: global.fetch,
    console,
    setInterval: global.setInterval,
    setTimeout: global.setTimeout,
    clearInterval: global.clearInterval,
    clearTimeout: global.clearTimeout,
  });
  new vm.Script(blocos[0][1], { filename: 'trackeroao.html' }).runInContext(ctx);
  await ctx.pollProgress();

  /**
   * Troca o progresso e redesenha.
   *
   * Não dá para mexer em `sync` de fora: é uma `let` de topo do script, invisível
   * do contexto. Então o caminho é o mesmo do navegador — mudar o que o fetch
   * devolve e chamar pollProgress. O generatedAt tem de mudar junto, senão a
   * página vê o mesmo carimbo e não redesenha, de propósito.
   */
  // Contador, não relógio: duas trocas no mesmo milissegundo dariam o mesmo
  // carimbo, a página não redesenharia — corretamente — e o teste falharia sem
  // haver defeito nenhum na página.
  let seq = 0;
  const trocar = async (mudancas) => {
    seq += 1;
    atual = Object.assign({}, progress, mudancas, {
      generatedAt: new Date(Date.now() + seq * 1000).toISOString(),
    });
    await ctx.pollProgress();
    return atual;
  };
  return { nodes, ctx, trocar, original: () => trocar({}) };
}

async function rodar(log) {
  // Num clone recém-feito ainda não houve leitura do save, então a versão
  // publicada é o que existe de progresso. Ela é menor — não traz os despejos
  // crus nem a data da última partida —, mas tem todos os campos que a página
  // desenha, que é o que estes testes verificam. Sem esta reserva, clonar e
  // rodar a suíte dava um erro de arquivo faltando, que parece defeito do
  // projeto quando é só a primeira execução.
  const cru = path.join(RAIZ, 'progress.json');
  const publicado = path.join(RAIZ, 'docs', 'progress.json');
  const de = fs.existsSync(cru) ? cru : publicado;
  const progress = JSON.parse(fs.readFileSync(de, 'utf8'));
  const { nodes, ctx, trocar, original } = await carregar(progress);
  // `sync` é uma `let` de topo do script, invisível de fora do contexto; a
  // prova de que a resposta foi consumida é a página ter desenhado algo.
  const desenhou = nodes.bosses.outerHTML.length > 100;
  log(desenhou, 'a página consome o progress.json que o servidor devolve',
    desenhou ? 'fetch -> pollProgress -> render' : 'nada foi desenhado');

  const secoes = [
    ['bosses', 'bosses', 'Bosses'],
    ['minibosses', 'miniBosses', 'Mini-bosses'],
    ['headless', 'headless', 'Headless'],
  ];

  for (const [id, campo, titulo] of secoes) {
    const html = nodes[id].outerHTML;
    const lista = progress[campo] || [];
    const rastreaveis = lista.filter((x) => x.detected !== false);
    const feitos = rastreaveis.filter((x) => x.defeated === true).length;

    log(html.includes(titulo), 'seção ' + titulo + ' é montada',
      html.includes(titulo) ? 'título presente' : 'título ausente');

    const caixas = (html.match(/<input type="checkbox"/g) || []).length;
    log(caixas === lista.length, titulo + ': uma linha por inimigo',
      caixas + ' caixas para ' + lista.length + ' inimigos');

    const marcadas = (html.match(/<input type="checkbox" checked/g) || []).length;
    log(marcadas === feitos, titulo + ': marcadas batem com o save',
      marcadas + ' marcadas, save diz ' + feitos);

    const contador = titulo === 'Bosses' || titulo === 'Mini-bosses' || titulo === 'Headless';
    const esperado = feitos + '/' + rastreaveis.length;
    log(contador && html.includes(esperado), titulo + ': contador do cabeçalho',
      'esperava ' + esperado);

    // Nenhum rótulo pode sair vazio ou como "undefined": é o sintoma de campo
    // renomeado na config.
    const texto = stripTags(html);
    log(!/undefined|\[object/.test(texto), titulo + ': nenhum rótulo quebrado',
      /undefined/.test(texto) ? 'achei "undefined" no texto' : 'todos com nome');

    // Todo inimigo da config tem de aparecer pelo nome.
    const faltando = lista.filter((x) => !texto.includes(x.label)).map((x) => x.label);
    log(faltando.length === 0, titulo + ': todos os nomes aparecem',
      faltando.length ? 'faltou: ' + faltando.join(', ') : lista.length + ' nomes');
  }

  // As duas checklists de item: cada unidade é nominal agora, então a lista tem
  // de ter uma linha por unidade e o contador tem de bater com as flags.
  for (const [id, campo, titulo] of [['beads', 'prayerBeadList', 'Prayer Beads'],
    ['seeds', 'gourdSeedList', 'Gourd Seeds']]) {
    const html = nodes[id].outerHTML;
    const lista = progress[campo] || [];
    const feitos = lista.filter((x) => x.collected).length;
    const caixas = (html.match(/<input type="checkbox"/g) || []).length;
    const marcadas = (html.match(/<input type="checkbox" checked/g) || []).length;
    log(caixas === lista.length, titulo + ': uma linha por unidade',
      caixas + ' linhas para ' + lista.length + ' no jogo');
    log(marcadas === feitos, titulo + ': marcadas batem com as flags',
      marcadas + ' marcadas, flags dizem ' + feitos);
    log(html.includes(feitos + '/' + lista.length), titulo + ': contador do cabeçalho',
      'esperava ' + feitos + '/' + lista.length);
    const faltando = lista.filter((x) => !stripTags(html).includes(x.label));
    log(faltando.length === 0, titulo + ': todos os nomes aparecem',
      faltando.length ? 'faltou: ' + faltando.map((x) => x.label).join(', ') : lista.length + ' nomes');
  }

  // O contador de mortes: enquanto o offset não existe o cabeçalho tem de
  // mostrar um traço, nunca zero — zero afirmaria que você não morreu.
  const d = progress.deaths || {};
  const mostrado = nodes.deathsCount.textContent;
  log(d.known ? mostrado === String(d.count) : mostrado === '—',
    'contador de mortes no cabeçalho', d.known
      ? 'offset calibrado, mostra ' + mostrado
      : 'sem offset, mostra "' + mostrado + '" em vez de 0');
  log(!/hunting log/i.test(nodes.deaths.outerHTML), 'o texto antigo do cabeçalho saiu',
    'subtítulo removido');

  // O rótulo "deaths" voltou, ao lado do número — decisão revertida, e o teste
  // reverte junto em vez de ficar afirmando o contrário do que a página faz.
  //
  // Ele é marcação estática, então não aparece no DOM de brinquedo, que só
  // conhece os ids: procurar aqui dava sempre "passou", por não haver o que
  // achar. Teste que não pode falhar não é teste, então este olha o arquivo.
  const marcacao = fs.readFileSync(PAGINA, 'utf8');
  const linhaMortes = /<div class="deaths-head"[\s\S]*?<\/div>/.exec(marcacao);
  const dentro = linhaMortes ? linhaMortes[0] : '';
  log(/deaths-rot">deaths</.test(dentro), 'o rótulo "deaths" está ao lado do número',
    dentro ? stripTags(dentro).replace(/\s+/g, ' ').trim() : 'não achei o cabeçalho');
  const rotuloDepois = dentro.indexOf('deathsCount') < dentro.indexOf('deaths-rot');
  log(rotuloDepois, 'e vem depois do número, não antes', '死 <número> deaths');

  // Geometria do termômetro: o pino e o preenchimento têm de sair da contagem,
  // e a escala para em 1000 sem esticar sozinha.
  for (const caso of [
    { count: 0, pct: '0%' }, { count: 250, pct: '25%' }, { count: 1000, pct: '100%' },
    { count: 2500, pct: '100%', over: true },
  ]) {
    await trocar({ deaths: { known: true, count: caso.count, how: 'discovered', confidence: 'likely' } });
    const bate = nodes.thermFill.style.width === caso.pct && nodes.thermPin.style.left === caso.pct;
    log(bate, 'termômetro em ' + caso.count + ' mortes',
      'barra ' + nodes.thermFill.style.width + ', pino ' + nodes.thermPin.style.left +
      ' (esperado ' + caso.pct + ')');
    if (caso.over) {
      log(/\bover\b/.test(nodes.deaths.className) && nodes.deathsCount.textContent === '2500',
        'acima de 1000 o pino encosta mas o número real continua',
        'classe "' + nodes.deaths.className + '", mostra ' + nodes.deathsCount.textContent);
    }
  }
  // Enquanto procura, o painel não carrega parágrafo de explicação: o traço já
  // diz que não se sabe.
  await trocar({ deaths: { known: false, count: null, how: 'learning', progresso: { fase: 'baseline', gravacoes: 0, mortes: 0 } } });
  const limpo = nodes.deathsNote.textContent.trim() === '';
  log(limpo, 'painel sem texto enquanto a busca corre',
    limpo ? 'nota vazia' : 'sobrou: "' + nodes.deathsNote.textContent.slice(0, 60) + '"');

  // --- menu de tópicos ---
  await original();

  // Estado inicial (nada guardado): o menu aparece e mais nada. Nenhuma seção
  // no lugar onde elas ficavam, e nenhum botão marcado.
  const secInicial = (id) => nodes[id].children[0];
  const limpoNoInicio =
    ['essentials', 'beads', 'seeds', 'bosses', 'minibosses', 'headless', 'idols']
      .every((id) => !secInicial(id) || secInicial(id).hidden === true) &&
    !/topic on/.test(nodes.topics.outerHTML);
  log(limpoNoInicio, 'estado inicial não mostra seção nenhuma',
    limpoNoInicio ? 'só o menu' : 'alguma seção apareceu sem ninguém escolher');

  const menu = nodes.topics.outerHTML;
  const esperados = ['Bosses', 'Mini-bosses', 'Items'];
  const ausentes = esperados.filter((t) => !menu.includes(t));
  log(ausentes.length === 0, 'menu tem os três tópicos pedidos',
    ausentes.length ? 'faltou: ' + ausentes.join(', ') : esperados.join(', '));
  log(!/>All</.test(menu), 'o tópico "All" saiu do menu',
    /All</.test(menu) ? 'All ainda está lá' : 'nenhum atalho de ver tudo');

  // Três tópicos e a gaveta, nessa ordem. O menu é atalho, não índice: se uma
  // seção nova entrar sozinha aqui, ele volta a crescer sem ninguém pedir.
  const naBarra = nodes.topics.children;
  const topicosFixos = naBarra.filter((c) => c.tagName === 'BUTTON');
  log(topicosFixos.length === 3, 'menu tem exatamente três tópicos fixos',
    topicosFixos.length + ' botões soltos na barra');
  const gaveta = naBarra.find((c) => /(^| )gaveta( |$)/.test(c.className));
  log(!!gaveta, 'a gaveta de três risquinhos existe', gaveta ? 'presente' : 'ausente');
  const risquinhos = gaveta && gaveta.children[0] ? gaveta.children[0].children.length : 0;
  log(risquinhos === 3, 'a gaveta é desenhada com três risquinhos', risquinhos + ' traços');

  // Prosthetic Tools mora na gaveta, não na barra.
  const naGaveta = gaveta && gaveta.children[1] ? stripTags(gaveta.children[1].outerHTML) : '';
  log(naGaveta.includes('Prosthetic Tools'), '"Prosthetic Tools" está dentro da gaveta',
    naGaveta.trim() ? 'gaveta: ' + naGaveta.replace(/\s+/g, ' ').trim() : 'gaveta vazia');
  const barraTexto = topicosFixos.map((b) => stripTags(b.outerHTML)).join(' | ');
  for (const fora of ['Prayer Beads', 'Gourd Seeds', 'Headless', 'Prosthetic Tools']) {
    log(!barraTexto.includes(fora), 'a barra não lista "' + fora + '"', 'fora da barra do menu');
  }

  // Escolher uma aba mostra ela e esconde as outras.
  const secao = (id) => nodes[id].children[0];
  ctx.selecionarAba('Bosses');
  const soBosses = secao('bosses').hidden === false && secao('beads').hidden === true;
  log(soBosses, 'escolher um tópico isola a seção',
    'bosses hidden=' + secao('bosses').hidden + ', beads hidden=' + secao('beads').hidden);
  log(/class="topic on"|topic on/.test(nodes.topics.outerHTML), 'o tópico escolhido fica marcado',
    'classe "on" aplicada');

  // Fechar a seção fecha a aba: volta ao menu e à página limpa.
  ctx.setOpen(secao('bosses'), 'bosses');
  const fechou = secao('bosses').hidden && secao('essentials').hidden &&
    !/topic on/.test(nodes.topics.outerHTML);
  log(fechou, 'fechar a seção volta ao estado limpo',
    fechou ? 'nada mostrado, nenhum botão marcado' : 'a seção ou o botão continuaram');

  // Clicar de novo no tópico já marcado faz a mesma coisa. O clique tem de ser
  // no botão de verdade: `abaAtual` é uma `let` do script, invisível daqui, e
  // reimplementar a decisão no teste testaria o teste, não a página.
  // `outerHTML`, não `innerHTML`: o botão é montado com appendChild, então o
  // innerHTML dele está vazio e a busca por nome não achava nada.
  const clicar = (el) => el.listeners.click[0]({ stopPropagation() {} });
  const nomeDe = (b) => stripTags(b.outerHTML).replace(/\d+\/\d+$/, '').trim();
  const botao = (nome) => nodes.topics.children.find((b) => nomeDe(b) === nome);

  clicar(botao('Mini-bosses'));
  const abriu = !secao('minibosses').hidden;
  clicar(botao('Mini-bosses'));
  const fechouPeloMenu = secao('minibosses').hidden &&
    !/topic on/.test(nodes.topics.outerHTML);
  log(abriu && fechouPeloMenu, 'clicar no tópico marcado fecha a aba',
    'abriu=' + abriu + ', fechou=' + fechouPeloMenu);

  // --- alfinete ---
  const alfinete = (id) => secao(id).children[0].children.find((c) => /(^| )pin( |$)/.test(c.className));
  log(!!alfinete('beads'), 'cada seção tem alfinete no cabeçalho',
    alfinete('beads') ? 'presente' : 'ausente');
  log(alfinete('bosses').className.includes('on') && !alfinete('beads').className.includes('on'),
    'as três do menu começam alfinetadas e as outras não',
    'bosses="' + alfinete('bosses').className + '", beads="' + alfinete('beads').className + '"');

  clicar(alfinete('beads'));
  const entrou = nodes.topics.outerHTML.includes('Prayer Beads');
  log(entrou, 'alfinetar põe a seção no menu',
    entrou ? 'Prayer Beads entrou' : 'não entrou');
  const naBarraDepois = nodes.topics.children.filter((c) => c.tagName === 'BUTTON').length;
  log(naBarraDepois === 4, 'a barra cresce de um', naBarraDepois + ' tópicos na barra');

  clicar(alfinete('beads'));
  log(!nodes.topics.outerHTML.includes('Prayer Beads'), 'desalfinetar tira do menu', 'saiu');

  // Desalfinetar a seção aberta não pode deixar ela na tela sem botão que a feche.
  clicar(alfinete('beads'));
  clicar(botao('Prayer Beads'));
  const aberta = !secao('beads').hidden;
  clicar(alfinete('beads'));
  const semBeco = secao('beads').hidden && !/topic on/.test(nodes.topics.outerHTML);
  log(aberta && semBeco, 'desalfinetar a aba aberta volta ao estado limpo',
    'abriu=' + aberta + ', fechou=' + semBeco);

  // "Items" é um tópico que reúne seis seções: escolher ele traz todas de uma
  // vez, e as de item vêm antes das outras.
  ctx.selecionarAba('Items');
  const grupo = !secao('beads').hidden && !secao('seeds').hidden && !secao('essentials').hidden;
  log(grupo, 'o tópico "Items" abre todas as seções de item',
    grupo ? 'contas, sementes e essenciais juntas' : 'faltou alguma');
  log(!secao('bosses').hidden === false, '"Items" não arrasta os chefes junto',
    'bosses hidden=' + secao('bosses').hidden);
  const ordemCerta = Number(secao('beads').style.order) < Number(secao('essentials').style.order);
  log(ordemCerta, 'dentro do grupo as contas vêm antes dos essenciais',
    'beads order=' + secao('beads').style.order + ', essentials order=' + secao('essentials').style.order);

  // Recolher uma seção do grupo não pode derrubar a aba inteira: só a última.
  ctx.setOpen(secao('beads'), 'beads');
  const grupoIntacto = !secao('essentials').hidden && !secao('seeds').hidden;
  log(grupoIntacto, 'fechar uma seção do grupo não fecha as irmãs',
    grupoIntacto ? 'as demais seguem visíveis' : 'a aba caiu inteira');
  ctx.selecionarAba(null);

  // Aba salva que não existe mais volta ao estado inicial, em vez de abrir numa
  // seção que ninguém pediu.
  ctx.selecionarAba('Uma Aba Que Sumiu');
  await original();
  const voltou = secao('essentials').hidden && secao('bosses').hidden &&
    !/topic on/.test(nodes.topics.outerHTML);
  log(voltou, 'aba salva que não existe mais volta ao estado inicial',
    voltou ? 'nada mostrado, nenhum botão marcado' : 'sobrou seção visível ou botão marcado');
  ctx.selecionarAba('*');

  // --- ritmo do poll conforme onde a página está servida ---
  // Na rede local o arquivo muda em segundos; no GitHub Pages só muda quando o
  // serviço publica, e vem de CDN. Perguntar no mesmo ritmo gastaria rede de
  // quem abriu o link à toa.
  for (const caso of [
    { hostname: 'localhost', esperado: 5000, onde: 'nesta máquina' },
    { hostname: '192.168.1.10', esperado: 5000, onde: 'na rede local' },
    { hostname: 'sekiro.local', esperado: 5000, onde: 'pelo nome na rede local' },
    { hostname: 'oaovito.github.io', esperado: 60000, onde: 'no GitHub Pages' },
  ]) {
    await carregar(progress, { hostname: caso.hostname, protocol: 'https:' });
    const pedido = global.intervalosPedidos[global.intervalosPedidos.length - 1];
    log(pedido === caso.esperado, 'poll ' + caso.onde + ': ' + caso.esperado / 1000 + 's',
      'pediu ' + (pedido / 1000) + 's para ' + caso.hostname);
  }

  // --- tema e assinatura ---
  // Escuro é o padrão, e não o do sistema: quem abre pela primeira vez tem de
  // ver o escuro mesmo com o sistema no claro.
  await carregar(progress, { hostname: 'localhost' });
  const temaInicial = global.document.documentElement.getAttribute('data-theme');
  log(temaInicial === 'dark', 'sem escolha salva, o site abre escuro',
    'data-theme="' + temaInicial + '"');

  const fonte = fs.readFileSync(PAGINA, 'utf8');
  log(!/@media \(prefers-color-scheme/.test(fonte),
    'nenhuma regra de CSS segue o tema do sistema',
    'o escuro vale mesmo se o script não rodar');

  /*
   * A assinatura não está mais escrita no HTML.
   *
   * Ela era a palavra "oaovito", e o teste cobrava essa palavra. Os dois
   * estavam errados pelo mesmo motivo: numa máquina que não a de quem
   * escreveu a página, o nome era mentira. Agora sai do apelido do Steam, e
   * o que se cobra é o contrário — que o nome de ninguém esteja fixo aqui.
   */
  log(!/oaovito game progress/.test(fonte), 'nenhum nome de pessoa escrito no cabeçalho',
    'a assinatura vem do apelido do Steam da máquina');
  log(/id="assinatura"[^>]*hidden/.test(fonte), 'e ela nasce escondida',
    'sem Steam identificado a linha some e o cabeçalho fecha');
  log(/game progress"/.test(fonte) || /\+ " game progress"/.test(fonte),
    'o sufixo continua sendo "game progress"', 'só o nome é que varia');
  // A janela cresceu porque o ponto de sync passou a ficar entre os dois.
  log(/class="topbar"[\s\S]{0,600}themeToggle/.test(fonte),
    'o botão de tema fica na faixa do topo', 'fora do cabeçalho, à direita');

  // --- estado do sync escondido dentro do ponto ---
  await carregar(progress, { hostname: 'localhost' });
  const ponto = nodes.syncDot;
  const texto = nodes.syncText;

  // O estado inicial vem do atributo na marcação, e o DOM de brinquedo não lê
  // marcação. Então o começo escondido é conferido no arquivo, e o resto do
  // teste parte do mesmo ponto que o navegador.
  log(/id="syncText" hidden/.test(fs.readFileSync(PAGINA, 'utf8')),
    'o texto do sync começa escondido na marcação', 'atributo hidden presente');
  texto.hidden = true;
  log(/slot/.test(texto.textContent), 'mas o texto está lá, pronto para aparecer',
    JSON.stringify(texto.textContent.slice(0, 46)));
  log(/Sync status/.test(ponto.getAttribute('aria-label') || ''),
    'o ponto anuncia o estado para leitor de tela',
    ponto.getAttribute('aria-label') ? 'aria-label preenchido' : 'sem rótulo');

  ponto.listeners.click[0]({});
  log(texto.hidden === false && ponto.getAttribute('aria-expanded') === 'true',
    'clicar no ponto revela o texto',
    'hidden=' + texto.hidden + ', aria-expanded=' + ponto.getAttribute('aria-expanded'));

  // Uma nova leitura não pode reabrir nem fechar sozinha o que a pessoa
  // escolheu: só o clique manda nisso.
  await trocar({});
  log(texto.hidden === false, 'a leitura seguinte não fecha o que foi aberto',
    'continua visível');

  ponto.listeners.click[0]({});
  log(texto.hidden === true, 'clicar de novo esconde', 'voltou a esconder');

  // --- blocos 2 e 3: tempo de jogo e mortes de chefe ---
  await carregar(progress, { hostname: 'localhost' });
  const src = fs.readFileSync(PAGINA, 'utf8');

  // A ordem pedida: as duas contagens de combate logo abaixo do menu, depois
  // as mortes, e por último conquistas e tempo de jogo.
  const iMenu = src.indexOf('class="topics"');
  const iCombate = src.indexOf('id="bossPanel"');
  const iCabeca = src.indexOf('id="headlessPanel"');
  const iMortes = src.indexOf('class="deaths-panel"');
  const iAnel = src.indexOf('class="quadro quadro-anel"');
  const iTempo = src.indexOf('id="quadroTempo"');
  const ordem = [iMenu, iCombate, iCabeca, iMortes, iAnel, iTempo];
  log(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])),
    'ordem dos blocos: chefes e Headless, mortes, conquistas e tempo',
    ordem.join(' < '));
  // Os quadrados de combate e os de medida são duas fileiras, não uma grade só.
  const fileiras = (src.match(/class="dois-quadrados"/g) || []).length;
  log(fileiras === 2, 'são duas fileiras de quadrados', fileiras + ' fileiras');
  // A lista tem de nascer entre as duas fileiras: é o que faz abrir empurrar o
  // resto da página para baixo e fechar devolver tudo ao lugar.
  const iLista = src.indexOf('id="bossLista"');
  log(iLista > iCabeca && iLista < iMortes,
    'a lista dos chefes fica entre as contagens e o resto',
    'lista em ' + iLista + ', entre ' + iCabeca + ' e ' + iMortes);

  const t = progress.playtime;
  log(!!t && t.horas > 0, 'o tempo de jogo chega do Steam',
    t ? t.horas.toFixed(1) + ' h (' + t.minutos + ' min)' : 'ausente');
  const horasNaTela = nodes.tempoNum.textContent;
  log(horasNaTela !== '—' && horasNaTela !== '', 'o quadrado mostra as horas', horasNaTela);
  const marcos = (nodes.marcos.outerHTML.match(/<i/g) || []).length;
  log(marcos === 8, 'oito marcos de 25 h até 200 h', marcos + ' marcos');
  log(!/skillEmote/.test(src), 'o emote saiu do quadrado de tempo',
    'nenhum resto de skillEmote');

  // A escada agora é de metal. Tem de subir com as horas, sem repetir metal, e
  // cada degrau precisa das três cores que o gradiente do número consome.
  const degraus = [...src.matchAll(/\[(\d+),\s+"([^"]+)",\s+\["([^"]+)", "([^"]+)", "([^"]+)"\]\]/g)]
    .map((m) => ({ h: Number(m[1]), metal: m[2], cores: [m[3], m[4], m[5]] }));
  const emOrdem = degraus.every((d, i) => i === 0 || d.h > degraus[i - 1].h);
  const semRepetir = new Set(degraus.map((d) => d.metal)).size === degraus.length;
  const comCores = degraus.every((d) => d.cores.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
  log(degraus.length === 9 && emOrdem && semRepetir && comCores,
    'a escada de metal vai de 0 a 200 h sem repetir material',
    degraus.length + ' degraus: ' + degraus.map((d) => d.metal).join(', '));

  // O metal do momento tem de chegar ao quadrado como variável de cor, senão o
  // número fica no metal de partida qualquer que seja o tempo de jogo.
  const m1 = nodes.quadroTempo.style['--m1'];
  log(!!m1 && /^#/.test(m1), 'o metal do momento chega ao número',
    m1 ? 'a ' + (progress.playtime ? progress.playtime.horas.toFixed(0) : '?') + ' h: ' + m1 : 'sem --m1');

  const kills = progress.bossKills || [];
  const somaKills = kills.reduce((a, b) => a + (b.vezes || 0), 0);
  log(nodes.bossNum.textContent === String(somaKills),
    'o contador de chefes soma as mortes',
    nodes.bossNum.textContent + ' para ' + somaKills);
  // O regex precisa fechar a aspa: "boss-card-n", "-nome" e "-area" também
  // começam com "boss-card" e contavam quatro por bloco.
  const cartoes = (nodes.bossLista.outerHTML.match(/class="boss-card[ "]/g) || []).length;
  log(cartoes === kills.length, 'um bloco por chefe na lista',
    cartoes + ' blocos para ' + kills.length + ' chefes');
  log(/boss-card-n/.test(nodes.bossLista.outerHTML), 'cada bloco traz a contagem no topo',
    'contagem por chefe presente');

  /*
   * A lista abre em JANELA, não empurrando a página.
   *
   * Antes ela entrava no fluxo do documento e jogava tudo que vinha abaixo
   * para longe — clicar num contador obrigava a rolar de volta. Os testes
   * mediam esse comportamento; agora medem o contrário, que é o pedido.
   */
  log(nodes.bossJanela && nodes.bossJanela.open === false,
    'a janela dos chefes começa fechada',
    'open=' + (nodes.bossJanela && nodes.bossJanela.open));
  nodes.bossHead.listeners.click[0]({});
  log(nodes.bossJanela.open === true
      && nodes.bossHead.getAttribute('aria-expanded') === 'true',
    'clicar no contador abre a janela',
    'open=' + nodes.bossJanela.open);
  log(/com-janela/.test(ctx.document.body.className),
    'e a página de trás trava a rolagem enquanto ela está aberta',
    'classe no body: "' + ctx.document.body.className + '"');

  nodes.bossJanela.close();
  log(nodes.bossJanela.open === false
      && nodes.bossHead.getAttribute('aria-expanded') === 'false'
      && !/com-janela/.test(ctx.document.body.className),
    'fechar devolve tudo ao lugar',
    'open=' + nodes.bossJanela.open + ', body="' + ctx.document.body.className + '"');
  // A lista não pode mais estar no fluxo: se estivesse, continuaria empurrando.
  log(/<dialog class="janela" id="bossJanela"/.test(src),
    'a lista mora dentro de um dialog', 'backdrop, foco preso e Esc sem script');

  // Emblema por chefe, e o convite a abrir legível sem hover.
  const comEmblema = kills.filter((b) => b.emblema).length;
  log(comEmblema === kills.length, "cada chefe tem emblema",
    comEmblema + "/" + kills.length + " — ex.: " + (kills[0] && kills[0].emblema));
  const emblemasUnicos = new Set(kills.map((b) => b.emblema)).size;
  log(emblemasUnicos >= kills.length - 2, "os emblemas distinguem os chefes",
    emblemasUnicos + " distintos para " + kills.length + " chefes");
  // A arte é servida do próprio site, e não puxada do servidor do wiki a cada
  // visita: hotlink quebra assim que o outro lado muda de caminho ou bloqueia.
  log(!/fextralifeimages\.com/i.test(src), 'a página não faz hotlink de imagem',
    'as artes são arquivos locais em icones/');
  const dirIcones = path.join(RAIZ, 'docs', 'icones');
  const arquivos = fs.existsSync(dirIcones) ? fs.readdirSync(dirIcones).filter((f) => f.endsWith('.png')) : [];
  const semArte = kills.filter((b) => !arquivos.includes(b.key + '.png'));
  log(arquivos.length > 0, 'há arte baixada para os chefes',
    arquivos.length + ' arquivos; sem arte: ' + (semArte.map((b) => b.key).join(', ') || 'nenhum'));
  log(semArte.every((b) => b.emblema), 'quem não tem arte cai no emblema',
    semArte.length ? semArte.map((b) => b.emblema + ' ' + b.key).join(', ') : 'todos têm arte');

  // O quadrado de progresso é um anel, e o anel tem de mover de verdade: o
  // offset é o que falta da volta, então progresso maior = offset menor.
  const VOLTA = 263.89;
  const off = Number(nodes.anelFio.style.strokeDashoffset);
  const alvo = VOLTA - VOLTA * (Number(nodes.overallPct.textContent.replace("%", "")) / 100);
  log(Math.abs(off - alvo) < 1, "o anel de progresso acompanha a porcentagem",
    "offset " + off.toFixed(1) + " para " + nodes.overallPct.textContent);
  log(off > 0 && off < VOLTA, "o anel não está nem vazio nem fechado",
    "entre 0 e " + VOLTA);
  log(!/id="overallBar"/.test(src), "a barra fina saiu do quadrado",
    "substituída pelo anel");

  // O botão saiu; o cabeçalho inteiro continua abrindo.
  log(!/see each boss|boss-abre/.test(src), "o botão de abrir saiu do bloco de chefes",
    "só a seta, e o cabeçalho inteiro é o alvo");
  log(!/.boss-icone {[^}]*border-radius/.test(src), "o anel em volta de cada chefe saiu",
    "sem borda circular no ícone");

  // Cabeçalho: título centralizado e maior que antes.
  log(/.top-centro {[^}]*align-items: center/.test(src), "o cabeçalho é uma coluna centrada",
    "título, sync e assinatura empilhados");
  // O corpo caiu de 3.1rem para 2.7rem quando o título passou a ser caixa alta
  // com entreletra larga: a mesma medida em versal ocupa muito mais linha, e
  // 3.1 quebrava em duas no celular. O que o teste quer garantir é presença, e
  // presença aqui é a largura que o título ocupa, não o corpo da fonte.
  const tam = /h1 \{[^}]*font-size: ([\d.]+)rem/.exec(src);
  const entre = /h1 \{[^}]*letter-spacing: ([\d.]+)em/.exec(src);
  log(tam && Number(tam[1]) >= 2.5, "o título tem porte de cabeçalho",
    tam ? tam[1] + "rem" : "não achei");

  // A tipografia do logo do jogo: o logo do Sekiro é feito sobre a Athelas,
  // que é comercial; a Libre Baskerville é a substituta livre dela, e vem da
  // mesma tradição de impressão de livro. Caixa alta e entreletra larga são o
  // arranjo do logo, e metade do reconhecimento.
  log(/h1 \{[^}]*font-family: "Libre Baskerville"/.test(src),
    "o título usa a serifada do logo do jogo", "Libre Baskerville");
  log(/h1 \{[^}]*text-transform: uppercase/.test(src) && entre && Number(entre[1]) >= 0.1,
    "em caixa alta e com entreletra larga, como o logo",
    entre ? "letter-spacing " + entre[1] + "em" : "sem entreletra");
  // O kanji não pode ir junto: a Baskerville não tem ideograma, e esticar o
  // espaçamento de dois deles quebraria o par.
  log(/h1 span \{[^}]*font-family: var\(--font-display\)/.test(src),
    "e o 進捗 continua na Mincho", "caixa alta e entreletra não valem para ele");

  // Menu: sem régua embaixo, e o traço no lugar da caixa.
  const cssDe = (sel) => {
    const alvo = src.indexOf(String.fromCharCode(10) + "  " + sel + " {");
    if (alvo < 0) return "";
    return src.slice(alvo, src.indexOf("}", alvo) + 1);
  };
  log(!/border-bottom/.test(cssDe(".topics")), "o menu perdeu a linha embaixo",
    "o espaçamento faz o trabalho dela");
  /*
   * O menu é tinta, não caixa.
   *
   * Os testes antigos cobravam borda de 1px e fundo cheio no ativo — a
   * estética de formulário que o pedido chamou de grosseira, e com razão: o
   * Sekiro não tem moldura em lugar nenhum, a interface dele é traço sobre
   * papel. Cobrar o contrário é o que impede a caixa de voltar.
   */
  const cssTopic = cssDe(".topic");
  log(/border: 0/.test(cssTopic) && /background: none/.test(cssTopic),
    "o tópico não tem caixa: nem borda, nem fundo",
    "a interface do jogo é traço sobre papel");
  // A pincelada: paradas de opacidade desiguais é o que separa pincel de régua.
  const paradas = cssDe(".topic::after");
  const stops = (paradas.match(/rgba\(214, 210, 200,/g) || []).length;
  log(stops >= 4, "o traço afina nas pontas, como pincelada",
    stops + " paradas de opacidade — linha de espessura constante é régua");
  log(/#d6402a/.test(cssDe(".topic.on::after")),
    "e o escolhido é marcado em vermelhão de selo",
    "a cor do carimbo, que é como o jogo marca o que vale");

  // O nome manda no bloco do chefe.
  log(/\.boss-card-nome \{[^}]*font-family: var\(--font-display\)/.test(src),
    "o título do bloco de chefe ganhou destaque", "fonte de display, maior");
  // Fechado, o bloco é só contagem: kanji, número e o rótulo do bloco. O que
  // saiu foi o parágrafo de explicação que morava no cabeçalho — a ressalva
  // sobre o jogo não guardar contagem por chefe vive no title, no hover.
  const dentroDoQuadro = stripTags(nodes.bossPanel.outerHTML).replace(/\s+/g, ' ').trim();
  log(dentroDoQuadro.length < 40, 'o bloco de chefes fechado é só a contagem',
    '"' + dentroDoQuadro + '"');
  log(!/no readable flag|goes from undone/.test(src.slice(src.indexOf('id="bossPanel"'), src.indexOf('id="bossLista"'))),
    'nenhum parágrafo de explicação na marcação do bloco', 'só kanji, número e rótulo');

  // O bloco tem de recolher de verdade. O atributo `hidden` sozinho não basta
  // quando a classe declara display: a regra do autor vence a do navegador, e
  // a lista ficava aberta mesmo marcada como escondida.
  log(/\.boss-lista\[hidden\] \{[^}]*display: none/.test(src),
    'o hidden da lista vence o display da classe',
    'regra explícita para .boss-lista[hidden]');

  // Fechado, o bloco só informa a contagem: nada de rodapé com explicação.
  log(nodes.bossNota.textContent.trim() === '', 'o rodapé do bloco de chefes está vazio',
    nodes.bossNota.textContent.trim() ? 'sobrou texto' : 'sem parágrafo');
  log(/per-boss kill count/.test(nodes.bossHead.title || ''),
    'a ressalva dos chefes foi para o hover',
    nodes.bossHead.title ? 'title com ' + nodes.bossHead.title.length + ' caracteres' : 'title vazio');

  // O número de chefes agora é o maior da página, e não mais do mesmo porte
  // que o de mortes.
  const numMortes = /\.deaths-count \{[^}]*font-size: ([\d.]+)rem/.exec(src);
  const numChefes = /\.quadro-botao \.quadro-num \{[^}]*font-size: clamp\([\d.]+rem, [\d.]+vw, ([\d.]+)rem\)/.exec(src);
  log(numMortes && numChefes && Number(numChefes[1]) > Number(numMortes[1]),
    'o número de chefes é maior que o de mortes',
    (numMortes && numMortes[1]) + 'rem vs até ' + (numChefes && numChefes[1]) + 'rem');
  log(/\.quadro-abre \{[^}]*justify-content: center/.test(src),
    'o número fica centralizado no bloco', 'conteúdo do quadrado centrado');
  log(/\.quadro-botao::after \{[^}]*position: absolute/.test(src),
    "a seta sai do fluxo para não desequilibrar o centro", "posicionada no canto");
  // A moldura viva: sangue no de chefes, roxo no de Headless, cada uma com a
  // sua animação.
  log(/\.boss-quadro::before \{[^}]*animation: sangue-borda/.test(src),
    "a moldura do bloco de chefes sangra", "border-image animado");
  log(/\.headless-quadro::before \{[^}]*animation: medo-borda/.test(src),
    "a moldura do bloco de Headless é roxa e pulsa", "border-image animado em roxo");

  // O susto do bloco de Headless: mais forte, mas na mesma cadência. O que
  // define a cadência é onde a janela do tremor começa dentro do ciclo — se
  // ela crescer, os sustos ficam mais frequentes, que não é o que se pediu.
  const tremorCss = /@keyframes tremor \{([\s\S]*?)\n  \}/.exec(src);
  const saltos = tremorCss
    ? [...tremorCss[1].matchAll(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/g)]
      .map((m) => Math.max(Math.abs(Number(m[1])), Math.abs(Number(m[2]))))
    : [];
  const pico = saltos.length ? Math.max(...saltos) : 0;
  log(pico >= 5, 'o tremor do Headless é violento', 'pico de ' + pico + 'px');

  // Medo, e não agitação: todo vetor aponta para o sul, alternando entre
  // sudoeste e sudeste, e a escala só encolhe. Um salto para cima leria como
  // energia — como algo batendo na caixa por dentro, que é o oposto.
  const vetores = tremorCss
    ? [...tremorCss[1].matchAll(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
      .filter((v) => v.x !== 0 || v.y !== 0)
    : [];
  const todosAoSul = vetores.length > 0 && vetores.every((v) => v.y > 0);
  log(todosAoSul, 'todo vetor do susto aponta para o sul',
    vetores.map((v) => v.y).join(', '));
  const alterna = vetores.every((v, i) => (i % 2 === 0 ? v.x < 0 : v.x > 0));
  log(alterna, 'e alterna entre sudoeste e sudeste',
    vetores.map((v) => (v.x < 0 ? 'SO' : 'SE')).join(' '));
  const escalas = tremorCss
    ? [...tremorCss[1].matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]))
    : [];
  log(escalas.every((s) => s <= 1), 'e o bloco só encolhe, nunca incha',
    'maior escala: ' + Math.max(...escalas));
  const janela = tremorCss ? /0%, (\d+)%, 100%/.exec(tremorCss[1]) : null;
  log(janela && Number(janela[1]) === 88,
    'e a janela do susto não mudou: o intervalo entre um e outro é o mesmo',
    janela ? 'começa em ' + janela[1] + '% do ciclo' : 'não achei a janela');
  const ciclo = /\.headless-quadro \{[^}]*animation: tremor ([\d.]+)s/.exec(src);
  log(ciclo && Number(ciclo[1]) === 6.1, 'e o ciclo continua de 6,1s',
    ciclo ? ciclo[1] + 's' : 'não achei o ciclo');
  log(saltos.length >= 8, 'o susto tem mais solavancos dentro da mesma janela',
    saltos.length + ' solavancos');

  // O número do Headless precisa contrastar com o fundo roxo do próprio bloco:
  // roxo sobre roxo sumia. O topo do gradiente é claro e frio, a raiz segue
  // roxa para não sair do tema.
  const gradHeadless = /\.headless-num \{[^}]*background-image: linear-gradient\(180deg,\s*(#[0-9a-f]{6})/i.exec(src);
  const claro = gradHeadless ? gradHeadless[1] : '';
  const brilho = claro
    ? (parseInt(claro.slice(1, 3), 16) + parseInt(claro.slice(3, 5), 16) + parseInt(claro.slice(5, 7), 16)) / 3
    : 0;
  log(brilho > 200, 'o número do Headless contrasta com o fundo do bloco',
    claro + ' (brilho médio ' + brilho.toFixed(0) + ')');
  const azulado = claro && parseInt(claro.slice(5, 7), 16) >= parseInt(claro.slice(1, 3), 16);
  log(azulado, 'e o tom é frio, não mais o roxo do fundo', 'topo do gradiente puxa para o azul');
  log(/\.headless-num \{[^}]*#2a1550/.test(src), 'a raiz do gradiente continua roxa',
    'o número resolve na cor do bloco, então segue no tema');

  /*
   * --- o luto sem listra nenhuma ---
   *
   * A cortina 鯨幕 era a referência certa e falhou três vezes: fita fina virou
   * faixa de pedestre, mais alta virou tecla de piano, apagada virou sujeira
   * na borda. Claro e escuro alternando numa faixa horizontal é sinal de
   * trânsito antes de ser qualquer outra coisa, e nenhuma dose conserta isso.
   *
   * O teste agora guarda a decisão de abandoná-la: padrão repetido em faixa
   * está proibido no bloco, e o luto vem do 白菊, o crisântemo branco que o
   * Japão põe no altar e na sepultura. Mesma referência cultural, em desenho
   * em vez de padrão — e desenho não se confunde com pavimentação.
   */
  const painelMortes = /\.deaths-panel\b[\s\S]*?\.deaths-head \{/.exec(src);
  const cssPainel = painelMortes ? painelMortes[0] : '';
  log(!/repeating-linear-gradient/.test(cssPainel),
    'o bloco de mortes não tem padrão repetido em faixa',
    'é o desenho que lia como travessia de rua, em qualquer dose');
  const fio = /\.deaths-panel::before \{[\s\S]*?\n  \}/.exec(src);
  const cssFio = fio ? fio[0] : '';
  const alturaFio = /height: (\d+)px/.exec(cssFio);
  log(alturaFio && Number(alturaFio[1]) <= 2,
    'no alto ficou só um fio de luz', alturaFio ? alturaFio[1] + 'px' : 'não achei');
  log(/<div class="kiku"/.test(src) && /viewBox="0 0 100 100"/.test(src),
    'e o luto vem do 白菊, desenhado', 'o crisântemo branco dos funerais japoneses');
  const opKiku = /\.deaths-panel \.kiku \{[\s\S]*?opacity: ([\d.]+)/.exec(src);
  log(opKiku && Number(opKiku[1]) <= 0.12,
    'quase apagado, como marca d\'água de lápide',
    opKiku ? 'opacidade ' + opKiku[1] : 'sem opacidade');
  // Dezesseis pétalas em duas coroas: uma coroa só lê como estrela.
  const petalas = (src.match(/<use href="#kikuCoroa"/g) || []).length * 2 + 2;
  log(petalas >= 16, 'com pétalas bastantes para ler como crisântemo',
    petalas + ' pétalas em duas coroas');

  /*
   * A chama do Ídolo, à esquerda do número.
   *
   * Aqui havia cinco fantasmas subindo, e antes deles um 死. Os fantasmas
   * saíram inteiros; o kanji deu lugar à chama. O motivo do segundo vale
   * guardar: os outros dois blocos já abrem com ideograma, 討 e 首, e um
   * terceiro na mesma posição vira padrão em vez de significado. A chama diz
   * a mesma coisa por outro caminho, e diz mais — é o fogo que arde no alto
   * de todo Ídolo do Escultor, onde se ressuscita.
   *
   * O que se testa é o tom, porque é nele que está a referência: turquesa é a
   * única cor dessa família no jogo, e uma chama laranja aqui seria fogo
   * genérico.
   */
  log(!/class=\"alma/.test(src), 'os fantasmas saíram do bloco',
    'o bloco ficou com o 白菊, a névoa e a chama');
  const chama = /<span class=\"deaths-chama\"[\s\S]*?<\/span>/.exec(src);
  const svgChama = chama ? chama[0] : '';
  log(!!svgChama && !/死/.test(svgChama), 'e o 死 deu lugar a uma chama desenhada',
    'emoji traria a paleta de outra pessoa, e o tom aqui é o ponto');
  /*
   * O turquesa do 鬼仏. Conferido pelo canal: num azul de verdade o verde e o
   * azul dominam e o vermelho fica para trás. Se alguém trocar por um laranja
   * de fogo comum, esta conta reprova.
   */
  const tonsChama = (svgChama.match(/#[0-9a-f]{6}/gi) || []);
  const quentes = tonsChama.filter((h) => {
    const r = parseInt(h.slice(1, 3), 16);
    const b = parseInt(h.slice(5, 7), 16);
    // Branco puro (r === b) e o nucleo da chama e passa; o que nao pode e
    // puxar para o quente, que e o fogo comum e nao o do Idolo.
    return r > b;
  });
  log(tonsChama.length > 0 && quentes.length === 0,
    'e o tom e o turquesa dos checkpoints do jogo',
    tonsChama.length + ' paradas, nenhuma puxando para o quente' +
      (quentes.length ? ': ' + quentes.join(', ') : ''));
  const cssChama = cssDe('.deaths-chama');
  log(/animation: vela/.test(cssChama), 'a chama oscila como a do Ídolo',
    'quase apaga e volta, em vez de pulsar num ritmo regular');
  log(/<animate /.test(svgChama), 'e a língua de fogo lambe por conta própria',
    'o d alterna entre desenhos de mesmo número de segmentos, então interpola');
  const fagulhas = (svgChama.match(/class=\"fagulha/g) || []).length;
  log(fagulhas >= 3, 'com fagulhas que sobem soltas e apagam',
    fagulhas + ' delas, em períodos que não são múltiplos entre si');

  /*
   * `hidden` tem de vencer qualquer `display` de classe.
   *
   * A regra do navegador para `[hidden]` é `display: none` com a
   * especificidade mais baixa que existe, então qualquer classe que declare um
   * display a atropela. O elemento continua com o atributo, o JavaScript
   * continua achando que o escondeu, e ele aparece na tela.
   *
   * O defeito é invisível em revisão, porque o código que esconde parece
   * correto — e apareceu duas vezes no mesmo dia: o selo de 100% visível com
   * as conquistas em 20 de 34, e a assinatura do cabeçalho ocupando lugar numa
   * máquina sem Steam.
   *
   * Este teste tem duas metades. A primeira exige a regra global. A segunda
   * varre a página atrás de qualquer classe que nasça com `hidden` e declare
   * display próprio, e existe porque a regra global pode ser removida por
   * alguém que a ache agressiva sem saber o que ela segura.
   */
  log(/\[hidden\]\s*{\s*display:\s*none\s*!important/.test(src),
    'o atributo hidden vence o display de qualquer classe',
    'sem isso o elemento fica escondido no JavaScript e visível na tela');

  const nascemEscondidos = new Set();
  for (const tag of src.match(/<[a-z]+[^>]*\bhidden\b[^>]*>/g) || []) {
    const cls = /class="([^"]+)"/.exec(tag);
    if (cls) for (const c of cls[1].split(/\s+/)) nascemEscondidos.add(c);
  }
  const semGuarda = [];
  for (const c of nascemEscondidos) {
    const re = new RegExp('(?:^|[\\s,])\\.' + c.replace(/-/g, '\\-') + '(?:[\\s,{])[^{]*{([^}]*)}', 'g');
    let r;
    while ((r = re.exec(src))) {
      const d = /display:\s*([^;]+)/.exec(r[1]);
      if (d && d[1].trim() !== 'none') { semGuarda.push(c); break; }
    }
  }
  // Com a regra global elas são inofensivas; o número existe para dizer o
  // tamanho do que ela segura, e para a falha da linha de cima ter contexto.
  log(true, 'e há ' + semGuarda.length + ' classes que dependem disso',
    semGuarda.length ? semGuarda.slice(0, 6).join(', ') + (semGuarda.length > 6 ? '…' : '')
      : 'nenhuma declara display próprio');

  /*
   * A prova no DOM, e não só no fonte: com a contagem longe dos 100%, o selo
   * não pode estar visível. É o caso concreto que originou tudo isto.
   */
  const seloEl = document.getElementById('selo');
  log(!!seloEl && seloEl.hidden, 'e o selo de 100% não aparece antes dos 100%',
    'com 20 de 34, ele fica fora — foi assim que o defeito apareceu');

  /*
   * Os dois estados do bloco de mortes: sino e podridão.
   *
   * Duas regras se cobram aqui, e as duas vieram de correção.
   *
   * A primeira é de hierarquia: o sino é pequeno e só confirma; a podridão é
   * maior, tem contagem dentro e é a única que abre. Dois ícones do mesmo
   * tamanho diriam que as duas coisas pesam igual.
   *
   * A segunda é que ligado e desligado têm de ser duas FIGURAS, e não a mesma
   * figura em dois tons. A primeira versão mudava só cor e opacidade, e de
   * relance não se lia diferença nenhuma — quem olha rápido vê o desenho, não
   * a saturação.
   */
  const cssSinoSvg = cssDe('.estado-sino svg');
  const cssRotN = cssDe('.rot-n');
  const cssRotulo = cssDe('.estado-rot');
  const medida = (css, prop) =>
    parseFloat((new RegExp(prop + ': *([0-9.]+)rem').exec(css) || [])[1] || 0);
  const tamSino = medida(cssSinoSvg, 'width');
  const tamRot = medida(cssRotN, 'font-size');
  const tamRotulo = medida(cssRotulo, 'font-size');
  log(tamSino > 0 && tamRot > 0, 'os dois ícones têm medida declarada',
    'sino ' + tamSino + 'rem, número da podridão ' + tamRot + 'rem');

  /*
   * O número de atingidos é a peça do ícone da podridão, e não um sufixo do
   * rótulo: o pedido fala em contagem bem destacada. Concretamente, o número
   * tem de ser bem maior que o nome embaixo dele.
   */
  log(tamRot > tamRotulo * 1.8, 'a contagem de atingidos é o que se lê primeiro',
    tamRot + 'rem contra ' + tamRotulo + 'rem do nome — o número manda no ícone');
  log(/id=\"rotN\"/.test(src), 'e ela tem elemento próprio',
    'separada do rótulo, para poder ter corpo e cor diferentes');
  log(/>dragonrot</.test(src), 'e o nome dragonrot aparece no ícone',
    'a grafia é a do jogo, uma palavra só');

  /*
   * As duas figuras de cada um. O que se cobra é que o estado aceso
   * acrescente ELEMENTOS, e não só troque cor: badalo e ondas no sino, número
   * e mancha na podridão. Nenhum dos quatro existe no estado apagado.
   */
  log(/\.estado-sino\.on \.sino-badalo/.test(src)
      && /\.estado-sino\.on \.sino-ondas/.test(src),
    'o sino aceso ganha badalo e ondas, que o apagado não tem',
    'sino em repouso tem o badalo no centro; o desalinho é o que diz que ele bateu');
  log(/\.estado-rot-bt\.off \.rot-n *{ *display: none/.test(src),
    'e a podridão limpa não mostra número nenhum',
    'zero não é uma mancha pequena, é a ausência dela');
  log(/\.estado-rot-bt\.on \.rot-mancha/.test(src),
    'enquanto a suja ganha a mancha atrás do kanji',
    'ela cresce com a contagem, via --rot');

  /*
   * O nome do estado do sino é o que o jogo usa. "Bell rung" era descrição do
   * que aconteceu; SINISTER BURDEN é o nome do que se está carregando, e é
   * assim que a interface do Sekiro chama.
   */
  log(/sinister burden/i.test(src), 'o sino aceso diz sinister burden',
    'é o nome que a interface do jogo dá ao estado de quem tocou o sino');
  /*
   * O que se cobra é o RÓTULO, e não o arquivo: o comentário acima da
   * marcação cita a frase antiga para explicar por que ela saiu, e varrer o
   * fonte inteiro faria o teste se acusar pela própria justificativa.
   */
  const trechoRotulo = /rotulo.textContent = b.ativo[^;]*;/.exec(src);
  log(!!trechoRotulo && !/bell rung/i.test(trechoRotulo[0]),
    'e o rótulo antigo saiu',
    'descrevia o gesto, não o estado');

  log(/id=\"estadoRot\"[^>]*type=\"button\"/.test(src)
      && /aria-haspopup=\"dialog\"/.test(src),
    'os atingidos aparecem ao interagir com o ícone',
    'o sino é liga-desliga: não há o que abrir nele');
  log(/Rot Essence/.test(src) || /rot-item/.test(src),
    'e a janela traz Rot Essence: <NPC>', 'item em cima, nome de quem embaixo');
  // Poluir aqui seria escrever a lista e a ressalva no próprio ícone. O
  // desenho leva kanji, número e nome; o resto vive na janela e no hover.
  const marcaRot = /<button class=\"estado estado-rot-bt\"[\s\S]*?<\/button>/.exec(src);
  const textoDoIcone = stripTags(marcaRot ? marcaRot[0] : '').replace(/\s+/g, ' ').trim();
  log(textoDoIcone.length <= 16, 'o ícone da podridão não vira parágrafo',
    '"' + textoDoIcone + '"');

  /*
   * 皆伝: o estado de 100% nas conquistas.
   *
   * O selo não pode empurrar nada. É o ponto mais fácil de errar: qualquer
   * elemento novo no fluxo do quadrado reorganizaria a fileira inteira no dia
   * em que a última conquista cair, e a página mudaria de forma justamente na
   * hora em que a pessoa está olhando para ela.
   */
  const cssSelo = cssDe('.selo');
  log(/position: absolute/.test(cssSelo),
    'o selo não ocupa lugar no fluxo', 'aos 100% ele aparece sem mover nada na página');
  log(/皆伝/.test(src), 'o selo é 皆伝, a licença de transmissão completa',
    'nas escolas japonesas é a mais alta que existe: o mestre ensinou tudo que sabia');
  const cssKaiden = cssDe('.quadro-anel.kaiden');
  log(/box-shadow/.test(cssKaiden) && /translateY/.test(cssKaiden),
    'e o bloco vira o destaque da página a partir dali',
    'sobe e ganha halo — as duas por fora do fluxo, então nada se reorganiza');
  log(/renderKaiden\(ok && todas > 0 && feitas >= todas\)/.test(src),
    'o selo exige contagem real antes de carimbar',
    'sem o "todas > 0", zero de zero seria 100% e a página se parabenizaria sozinha');
  log(/id="kaidenCena"/.test(src) && /pointer-events: none/.test(cssDe('.kaiden-cena')),
    'a cena do selo é a página inteira, e não engole o clique',
    'o pedido é contemplar; uma cena que trava a página vira espera');
  log(/selo\.addEventListener\("click", tocarKaiden\)/.test(src),
    'e ela responde à interação com o selo', 'clicar recomeça a cena');

  /*
   * Toda animação da página declara de onde no jogo ela vem.
   *
   * A regra é do dono do projeto e é fácil de furar sem perceber: um
   * movimento genérico — algo pulsando, algo deslizando — resolve o problema
   * visual do dia e some no meio das outras. Depois de trinta e poucas
   * animações ninguém lembra quais nasceram do jogo e quais nasceram de
   * conveniência.
   *
   * Por isso cada `@keyframes` leva acima dele uma linha `no jogo: ...`
   * nomeando o referente. Não é decoração de comentário: é o teste abaixo que
   * a cobra, então animação nova sem origem declarada falha a suíte, e
   * declarar obriga a procurar o referente antes de escrever o movimento.
   */
  const linhas = src.split(String.fromCharCode(10));
  const semOrigem = [];
  const nomes = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = /@keyframes ([a-z-]+)/.exec(linhas[i]);
    if (!m) continue;
    nomes.push(m[1]);
    if (!/no jogo:/.test(linhas[i - 1] || '')) semOrigem.push(m[1]);
  }
  log(nomes.length > 0 && semOrigem.length === 0,
    'toda animação declara de onde no jogo ela vem',
    semOrigem.length ? 'sem origem: ' + semOrigem.join(', ')
      : nomes.length + ' animações, cada uma com o referente escrito acima dela');
  /*
   * E a origem tem de dizer alguma coisa. "no jogo: animação" passaria no
   * teste de cima e não serviria para nada — o que se quer é a frase que
   * permite conferir a escolha depois, e frase curta demais não é frase.
   */
  const origens = (src.match(/no jogo: ([^*]+)\*\//g) || [])
    .map((t) => t.replace(/^no jogo: /, '').replace(/\s*\*\/$/, '').trim());
  const curtas = origens.filter((t) => t.length < 25);
  log(curtas.length === 0, 'e a origem é descrita, não só nomeada',
    curtas.length ? 'curta demais: ' + curtas.join(' | ')
      : 'a mais curta tem ' + Math.min.apply(null, origens.map((t) => t.length)) + ' caracteres');

  // O fio embaixo do cabeçalho saiu: a página já tem a pincelada do menu logo
  // abaixo, e duas horizontais a poucos pixels uma da outra são uma a mais.
  log(!/border-bottom/.test(cssDe("header.top")),
    'não há linha entre o título e o corpo',
    'o espaço e a diferença de corpo já separam os dois');

  // O tempo de jogo: "h" no número, e nenhum nome de metal na tela.
  log(/\+ "h";/.test(src), 'o número de horas traz o "h"', 'colado no número');
  log(!/getElementById\("tempoRot"\)\.textContent = d\[1\]/.test(src),
    'o nome do metal saiu da tela', 'a cor continua evoluindo, a palavra não aparece');
  const rot = /<span class="quadro-rot" id="tempoRot">([^<]*)</.exec(src);
  log(rot && !/bronze|iron|steel|silver|gold|lazulite|magnetite|adamantite/i.test(rot[1]),
    'e o rótulo do bloco não é um material', '"' + (rot ? rot[1] : '?') + '"');

  // O hover abre o número exato. Duas medidas, cada uma na precisão da fonte:
  // a Steam grava minutos inteiros, então não pode inventar segundo; o tempo
  // interno vem em milissegundos e pode.
  const t2 = nodes.quadroTempo.title || '';
  log(/\d+h \d{2}m on the Steam clock/.test(t2), 'o hover dá o relógio em hora e minuto',
    (t2.split('\n')[0] || '').slice(0, 60));
  const temInterno = typeof progress.playtime.internoSegundos === 'number';
  if (temInterno) {
    log(/\d+h \d{2}m \d{2}s of in-game time/.test(t2), 'e o tempo interno com segundos',
      (t2.split('\n')[1] || '').slice(0, 60));
    log(!/\d+h \d{2}m 00s on the Steam clock/.test(t2),
      'sem segundo inventado no relógio da Steam', 'a fonte só grava minutos');
  } else {
    log(!/in-game time/.test(t2), 'sem tempo interno, o hover não o menciona',
      'nada de linha vazia');
  }
  // Uma segunda atribuição do title apagava a primeira sem deixar rastro.
  log((src.match(/quadro\.title =/g) || []).length === 2,
    'o título do bloco de tempo é escrito num lugar só',
    (src.match(/quadro\.title =/g) || []).length + ' atribuições (a outra é o caso sem dado)');

  // --- o bloco de mortes é um velório, não um ferimento ---
  // Os dois contadores dizem coisas diferentes e precisam parecer diferentes:
  // o de chefes é violência e sangra, este é luto e guarda. Sem isto os dois
  // viram o mesmo bloco vermelho com números distintos.
  log(!/repeating-linear-gradient/.test(cssPainel),
    'o bloco de mortes guarda luto sem imitar pavimentação',
    'a cortina listrada saiu; o 白菊 ficou no lugar dela');

  // O número não pode ter gradiente de sangue: a cor tem de ser de osso.
  const numMorte = /\.deaths-count \{[\s\S]*?background-image: linear-gradient\(\s*180deg,\s*(#[0-9a-f]{6})/i.exec(src);
  const topoMorte = numMorte ? numMorte[1] : '';
  const r = topoMorte ? parseInt(topoMorte.slice(1, 3), 16) : 0;
  const b = topoMorte ? parseInt(topoMorte.slice(5, 7), 16) : 0;
  log(topoMorte && r - b < 30, 'o número de mortes não é mais vermelho',
    topoMorte + ' (osso: vermelho e azul quase iguais)');
  log(!/\.deaths-count \{[^}]*animation: escorrer\b/.test(src),
    'e não escorre como o de chefes', 'a animação de sangue saiu daqui');
  log(/\.deaths-count \{[^}]*animation: luto/.test(src),
    'o número respira em vez de pulsar', 'animação "luto", lenta');
  log(/\.deaths-count::after \{[^}]*animation: incenso/.test(src),
    'sobe fumaça de incenso no lugar da gota de sangue', 'animação "incenso"');
  log(/\.deaths-chama \{[^}]*animation: vela/.test(src),
    'e a chama do Ídolo oscila como vela', 'animação "vela"');
  // A escala também: morrer mais apaga, não esquenta.
  const fim = /\.therm-fill \{[\s\S]*?linear-gradient\(90deg,[^)]*?(#[0-9a-f]{6})\);/i.exec(src);
  const fimCor = fim ? fim[1] : '';
  const fr = fimCor ? parseInt(fimCor.slice(1, 3), 16) : 0;
  const fb = fimCor ? parseInt(fimCor.slice(5, 7), 16) : 0;
  log(fimCor && fr - fb < 30, 'o fim da escala é cinza, não sangue',
    fimCor + ' no extremo de 1000');

  // --- a moldura reage, o conteúdo não espera ---
  // A divisão é a regra toda: o que é do bloco (moldura, tremor, gotas) fica
  // parado até alguém olhar; o que é informação (número, kanji) anima sempre,
  // senão seria preciso passar o mouse para ler o que está escrito.
  const temGatilho = (re) => re.test(src);
  log(/\.boss-quadro, \.headless-quadro \{ --anim: paused; \}/.test(src),
    'os dois blocos nascem com a moldura parada', '--anim: paused');
  log(/\.boss-quadro:hover, \.boss-quadro\.animando/.test(src) &&
      /\.headless-quadro:hover, \.headless-quadro\.animando \{ --anim: running; \}/.test(src),
    'e ligam no hover ou por toque', ':hover para mouse, .animando para celular');

  const gatilhada = (nome) => {
    // Dentro da MESMA regra, e não numa janela de tantos caracteres: o atalho
    // `animation` zera os longhands dele, então um play-state posto em outra
    // regra acima não valeria — e uma janela larga o bastante para alcançar a
    // regra seguinte daria positivo para a animação errada.
    const i = src.indexOf('animation: ' + nome);
    if (i < 0) return null;
    const fim = src.indexOf('}', i);
    return /animation-play-state: var\(--anim/.test(src.slice(i, fim));
  };
  for (const doBloco of ['sangue-borda', 'medo-borda', 'tremor', 'gotejar']) {
    const g = gatilhada(doBloco);
    log(g === true, 'a animação "' + doBloco + '" é do bloco e espera o gatilho',
      g === null ? 'não achei a animação' : 'play-state ligado a --anim');
  }
  for (const doConteudo of ['vela', 'luto', 'incenso', 'polir', 'escorrer-forte']) {
    const g = gatilhada(doConteudo);
    log(g === false, 'a animação "' + doConteudo + '" é conteúdo e corre sempre',
      g === null ? 'não achei a animação' : 'sem gatilho, como deve ser');
  }
  log(/const BLOCOS_ANIMADOS = "\.boss-quadro, \.headless-quadro"/.test(src),
    'o toque alcança os mesmos dois blocos', 'e nenhum outro');

  // O bloco de menos movimento precisa vir depois das animações que desliga:
  // com a mesma especificidade, quem vem antes perde. Declarado lá em cima,
  // ele parava o número mas deixava a borda sangrando e o Headless tremendo.
  const iReduz = src.indexOf('@media (prefers-reduced-motion: reduce)');
  const iUltima = Math.max(
    src.indexOf('animation: tremor'), src.indexOf('animation: medo-borda'),
    src.indexOf('animation: sangue-borda'), src.indexOf('animation: gotejar'));
  log(iReduz > iUltima && iReduz > 0,
    'menos movimento vence as animações que desliga',
    'declarado em ' + iReduz + ', depois da última animação em ' + iUltima);

  // --- a lista de conquistas ---
  const conqs = (progress.achievements && progress.achievements.lista) || [];
  log(/\.conq-lista \{[^}]*flex-direction: column/.test(src),
    'as conquistas ficam em lista de uma coluna, não em grade',
    'nome e descrição têm comprimentos muito diferentes; em grade sobram buracos');
  log(/\.quadro-anel::after \{[\s\S]*?content: "▾"/.test(src),
    'o bloco mostra que pode ser aberto', 'a mesma seta dos blocos de chefe');

  const semDesc = conqs.filter((c) => !c.descricao);
  log(semDesc.length === 0, 'toda conquista tem descrição',
    semDesc.length ? semDesc.length + ' sem texto: ' + semDesc.slice(0, 3).map((c) => c.nome).join(', ')
      : conqs.length + ' de ' + conqs.length);
  const daReserva = conqs.filter((c) => c.descricaoOculta).length;
  log(daReserva > 0, 'e as ocultas vêm marcadas como texto de reserva',
    daReserva + ' das ' + conqs.length + ' o jogo esconde até desbloquear');

  const semIcone = conqs.filter((c) => !c.icone);
  log(semIcone.length === 0, 'toda conquista tem ícone',
    semIcone.length ? semIcone.length + ' sem arte' : conqs.length + ' baixados');
  const faixas = new Set(conqs.map((c) => c.dificuldade).filter(Boolean));
  log(faixas.size === 3, 'separadas em três faixas de dificuldade',
    [...faixas].join(', '));

  /*
   * A dificuldade sai da raridade, e a raridade é dado da Steam — não opinião.
   * O teste confere a consequência disso: dentro de cada faixa as
   * porcentagens têm de ficar nos intervalos declarados, senão alguém mexeu na
   * classificação à mão em algum lugar.
   */
  const dentroDaFaixa = conqs.every((c) => {
    if (typeof c.raridade !== 'number') return true;
    if (c.dificuldade === 'facil') return c.raridade >= 50;
    if (c.dificuldade === 'media') return c.raridade >= 20 && c.raridade < 50;
    return c.raridade < 20;
  });
  log(dentroDaFaixa, 'e a faixa concorda com a porcentagem de jogadores',
    'fácil ≥50%, média 20–50%, difícil <20%');

  // A marca de shinobi: uma só, e na mais rara de todas.
  const comTag = conqs.filter((c) => c.shinobi);
  const maisRara = conqs.slice().sort((a, b) => (a.raridade || 100) - (b.raridade || 100))[0];
  log(comTag.length === 1, 'existe uma marca de shinobi, e uma só',
    comTag.length + ' marcadas');
  log(comTag.length === 1 && maisRara && comTag[0].nome === maisRara.nome,
    'e ela está na conquista mais rara de todas',
    comTag[0] ? comTag[0].nome + ' (' + comTag[0].raridade + '%)' : 'nenhuma');
  log(/antes === "1" \|\| antes === null/.test(src),
    'as cenas só correm na transição, não a cada leitura',
    'a página relê de 5 em 5s; sem isso o site piscaria para sempre');
  log(/\.golpe \{[^}]*pointer-events: none/.test(src),
    'e a cena não rouba o clique de nada', 'pointer-events: none');

  /*
   * Os três marcos de tela inteira, e a coerência de cada um com o seu bloco.
   *
   * Os kanji não são escolha de gosto e por isso viram teste: o 忍殺 é o que o
   * jogo estampa no golpe mortal, o 怖 é o kanji que o Sekiro usa para o
   * Terror (não o 恐怖 mais formal), e o 討 é o que o bloco de chefes já usa.
   */
  const blocoMarcos = /const MARCOS_CENA = \[[\s\S]*?\n\];/.exec(src);
  const cenas = blocoMarcos ? blocoMarcos[0] : '';
  log(/kanji: "忍殺"/.test(cenas) && /kanji: "討"/.test(cenas) && /kanji: "怖"/.test(cenas),
    'há três marcos de tela inteira, com os kanji certos',
    '忍殺 para a conquista, 討 para os chefes, 怖 para os Headless');
  log(/s\.bosses\.every\(\(b\) => b\.defeated\)/.test(cenas),
    'o dos chefes espera todos derrotados', 'every, não some');
  log(/s\.headless\.every\(\(h\) => h\.defeated\)/.test(cenas),
    'e o dos Headless também', 'every, não some');
  // Lista vazia não é conquista: sem save lido, `every` de lista vazia é true
  // e as três cenas disparariam juntas na primeira leitura ruim.
  log(/\.length > 0\s*\n?\s*&& s\.bosses\.every/.test(cenas) || /s\.bosses\.length > 0/.test(cenas),
    'lista vazia não conta como tudo derrotado',
    'every de lista vazia é true, e isso dispararia a cena sem save');
  // Cada cena fala a língua do bloco dela.
  log(/\.golpe-chefes \.golpe-kanji \{[^}]*color: #e0301c/.test(src),
    'a cena dos chefes é de sangue', 'vermelho, e os fios escorrem pela tela');
  log(/\.golpe-headless \.golpe-kanji \{[^}]*color: #c98cf5/.test(src)
      && /animation:[^;]*pavor/.test(src),
    'a dos Headless é roxa e treme', 'os mesmos vetores de medo do bloco');
  log(/@keyframes pavor \{[\s\S]*?25%\s*\{ margin: 3px 0 -3px -4px; \}/.test(src),
    'e o tremor aponta para o sul, como no bloco',
    'medo encolhe e recua para baixo, não pula');

  // O menu não pode precisar de arrasto: no celular o último item ficava
  // cortado na borda e só aparecia se você puxasse de lado.
  const menuCel = /@media \(max-width: 460px\) \{[\s\S]*?\n  \}/.exec(src);
  const menuCelCss = menuCel ? menuCel[0] : '';
  log(!/\.topics \{[^}]*overflow-x: auto/.test(menuCelCss), 'o menu não rola de lado no celular',
    'sem overflow-x na barra');
  log(/\.topics \{[^}]*flex-wrap: wrap/.test(menuCelCss), 'ele quebra em duas colunas',
    'flex-wrap: wrap na largura de celular');
  log(/\.topics > \.topic \{[^}]*flex: 1 1 calc\(50% - 6px\)/.test(menuCelCss),
    'cada tópico ocupa meia largura', 'dois por fileira, nada cortado na borda');

  // O ponto de sync foi para a faixa do topo, à esquerda; o botão de tema
  // continua à direita.
  // Comparação de posição, e não um regex casando dois </div> seguidos: há um
  // botão entre eles, e aquele padrão dava resposta errada com cara de certa.
  const iFaixa = src.indexOf('class="topbar"');
  const iPonto = src.indexOf('syncDot');
  const iTema = src.indexOf('themeToggle');
  const iCab = src.indexOf('<header class="top">');
  log(iFaixa < iPonto && iPonto < iTema && iTema < iCab,
    'o ponto de sync fica à esquerda da faixa do topo',
    'faixa ' + iFaixa + ' < ponto ' + iPonto + ' < tema ' + iTema + ' < cabeçalho ' + iCab);
  log(/\.topbar \{[^}]*justify-content: space-between/.test(src),
    'a faixa separa as duas pontas', 'space-between');
  log(!/<header class="top">[\s\S]{0,400}syncDot/.test(src),
    'e saiu do cabeçalho', 'cabeçalho ficou com título e assinatura');

  /*
   * A assinatura destaca por peso e espaço, não por corpo.
   *
   * O teste antigo cobrava 0.85rem, de quando destaque era tamanho. Ela
   * disputava corpo com um título três vezes maior e perdia de qualquer jeito;
   * encolhida, ganha o que o título não tem. Medir o corpo aqui seria medir a
   * coisa errada de novo.
   */
  const assin = /\.assinatura \{[^}]*font-size: ([\d.]+)rem/.exec(src);
  const blocoAssin = /\.assinatura \{[\s\S]*?\n  \}/.exec(src);
  const cssAssin = blocoAssin ? blocoAssin[0] : '';
  log(assin && Number(assin[1]) <= 0.85,
    'a assinatura encolheu, para o corpo da página caber',
    assin ? assin[1] + 'rem' : 'não achei');
  const pesoAssin = /font-weight: (\d+)/.exec(cssAssin);
  const entreAssin = /letter-spacing: ([\d.]+)em/.exec(cssAssin);
  log(pesoAssin && Number(pesoAssin[1]) >= 700 && entreAssin && Number(entreAssin[1]) >= 0.3,
    'e destaca por peso e entreletra em vez de corpo',
    (pesoAssin ? pesoAssin[1] : '?') + ' / ' + (entreAssin ? entreAssin[1] + 'em' : '?'));
  log(/\.assinatura::before,/.test(src) && /\.assinatura::after \{/.test(src),
    'com um fio de cada lado isolando a linha', 'lê como legenda de placa');
  // O título não pode ter encolhido junto: o pedido foi o cabeçalho menor com
  // o título intacto.
  const alturaCab = /header\.top \{[\s\S]*?padding-bottom: (\d+)px[\s\S]*?margin-bottom: (\d+)px/.exec(src);
  log(alturaCab && Number(alturaCab[1]) + Number(alturaCab[2]) <= 32,
    'e o cabeçalho ficou mais baixo sem mexer no título',
    alturaCab ? alturaCab[1] + 'px + ' + alturaCab[2] + 'px' : 'não achei');
  log(/\.assinatura \{[^}]*color: var\(--gold\)/.test(src),
    'e ganhou cor própria', 'dourado, não cinza apagado');

  // Os dois quadrados do meio perderam moldura e fundo.
  log(/\.quadro \{[^}]*border: 0/.test(src), 'os quadrados não têm borda', 'border: 0');
  log(/\.quadro \{[^}]*background: none/.test(src), 'e são transparentes', 'sem fundo');

  // Os quadrados precisam segurar o 1:1. O que garante isso não é o
  // aspect-ratio sozinho: é ele mais o min-height, porque conteúdo mais alto
  // que a caixa estica a caixa e o aspect-ratio cede.
  log(/\.quadro \{[^}]*aspect-ratio: 1 \/ 1/.test(src),
    'os quadrados declaram 1:1', 'aspect-ratio presente');
  log(/\.quadro \{[^}]*min-height: 0/.test(src),
    'e o conteúdo não pode esticá-los', 'min-height: 0 no quadro');
  log(/\.anel \{[^}]*height: 100%/.test(src) && !/\.anel \{[^}]*max-width/.test(src),
    'o anel dimensiona pela altura, não pela largura',
    'sem max-width fixo empurrando a caixa');

  // Emma entrou com arte, e com enquadramento próprio.
  const emma = kills.find((b) => b.key === "emma");
  log(!!(emma && emma.enquadre), "a arte da Emma tem enquadramento próprio",
    emma && emma.enquadre ? JSON.stringify(emma.enquadre) : "sem enquadre");
  log(fs.existsSync(path.join(RAIZ, "docs", "icones", "emma.png")),
    "a arte da Emma foi baixada", "icones/emma.png");

  // O painel de mortes não pode voltar a carregar parágrafo: o número é para
  // ler de relance, e a ressalva vive no hover.
  await carregar(progress, { hostname: "localhost" });
  const notaMortes = nodes.deathsNote.textContent.trim();
  log(notaMortes === "", "o painel de mortes não mostra texto explicativo",
    notaMortes ? "sobrou: \"" + notaMortes.slice(0, 50) + "\"" : "sem parágrafo");
  const hover = nodes.deaths.title || "";
  log(/counted|save/i.test(hover), "mas a ressalva continua no hover",
    hover ? "title com " + hover.length + " caracteres" : "title vazio");

  // O contador de mortes voltou a dar número.
  log(progress.deaths && progress.deaths.known === true,
    'o contador de mortes está funcionando',
    progress.deaths ? progress.deaths.count + ' (' + progress.deaths.how + ')' : 'ausente');

  // Alvos de toque: o alfinete é desenho, não emoji, e tem alvo grande.
  log(/\.cat-header \.pin \{[^}]*width: 34px/.test(src), 'o alfinete tem alvo de 34px',
    'alvo maior que o desenho');
  log(!/b\.textContent = "📌"/.test(src) && /pin svg/.test(src),
    'o alfinete é desenhado e segue o tema', 'sem emoji, herda currentColor');

  // O rodapé é discreto, mas tem de existir.
  const rodape = /made by oaovito/i.test(fs.readFileSync(PAGINA, 'utf8'));
  log(rodape, 'rodapé de autoria presente', rodape ? 'made by oaovito' : 'ausente');

  await original();

  // Duas contagens independentes das contas: a das flags e a aritmética dos
  // colares. Divergir significa que uma das duas está errada.
  const pb = progress.essentials.prayerBeads;
  const porFlag = (progress.prayerBeadList || []).filter((x) => x.collected).length;
  log(porFlag === pb.collected, 'as duas contagens de Prayer Bead concordam',
    'flags: ' + porFlag + ', colares×4+bolsa: ' + pb.collected);

  // Idem para as sementes: flags contra cargas da cabaça.
  const gs = progress.essentials.gourdSeeds;
  log(gs.charges === gs.startingCharges + gs.collected,
    'sementes por flag batem com as cargas da cabaça',
    gs.collected + ' sementes + ' + gs.startingCharges + ' inicial = ' + gs.charges + ' cargas');

  // O total geral tem de incluir as três seções, senão a barra mede só
  // próteses e artes.
  const total = nodes.overallCount.textContent;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(total);
  // O anel deixou de medir a soma das listas e passou a medir as conquistas do
  // Steam, que é o placar que o jogo reconhece.
  const conq = progress.achievements;
  log(!!m && !!conq && Number(m[1]) === conq.desbloqueadas && Number(m[2]) === conq.total,
    'o bloco de progresso mostra as conquistas do Steam',
    total + (conq ? ' para ' + conq.desbloqueadas + '/' + conq.total : ' (sem conquistas no progresso)'));
  const soma = secoes.reduce((a, [, campo]) =>
    a + (progress[campo] || []).filter((x) => x.detected !== false).length, 0);
  log(soma > 0, 'as listas seguem contando por trás',
    'total mostra ' + total + ', só as três seções já somam ' + soma);

  // Linhas antigas de chefe/mini-chefe no DATA teriam chave morta depois do
  // renome; se sobrou alguma, ela apareceria desmarcada para sempre.
  const cats = nodes.categories.outerHTML;
  log(!/flag:chainedOgre|flag:genichiro1|flag:shichimen\b/.test(cats),
    'nenhuma chave antiga sobrou no DATA', 'renome aplicado');
}

/**
 * Desenha a página com um progresso qualquer e devolve o que ficou na tela.
 *
 * Serve ao teste do espelho: rodar isto com o progresso local e com o
 * publicado tem de dar o mesmo texto. É a checagem mais direta possível da
 * regra de que o link público não é uma versão reduzida da página — é a mesma
 * página.
 */
async function desenhar(progress) {
  const { nodes } = await carregar(progress, { hostname: 'localhost' });
  const pedacos = [];
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (!n || typeof n.outerHTML !== 'string') continue;
    pedacos.push(id + '::' + n.outerHTML.replace(/\s+/g, ' ').trim());
  }
  return pedacos.join(String.fromCharCode(10));
}

module.exports = { rodar, carregar, desenhar };
