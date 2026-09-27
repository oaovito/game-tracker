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
const PAGINA = path.join(RAIZ, 'sekiro-progresso.html');

const IDS = ['categories', 'topics', 'essentials', 'beads', 'seeds', 'bosses', 'minibosses', 'headless',
  'deaths', 'deathsCount', 'deathsNote', 'syncDot', 'syncText', 'anelFio', 'overallPct', 'overallCount', 'tempoNum', 'skillEmote', 'marcos', 'bossPanel', 'bossHead', 'bossNum', 'bossLista', 'bossNota', 'quadroTempo', 'tempoRot', 'therm', 'thermFill', 'thermPin',
  'idols', 'novidades', 'syncDot', 'syncText', 'overallCount', 'overallLabel', 'overallBar',
  'themeBtn'];

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
  new vm.Script(blocos[0][1], { filename: 'sekiro-progresso.html' }).runInContext(ctx);
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
  const progress = JSON.parse(fs.readFileSync(path.join(RAIZ, 'progress.json'), 'utf8'));
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

  // Só o 死 e o número: nenhuma palavra "deaths" solta no painel.
  const semPalavra = !/\bdeaths?\b/i.test(stripTags(nodes.deaths.outerHTML));
  log(semPalavra, 'painel mostra só o kanji e o número',
    semPalavra ? 'sem a palavra "deaths"' : 'ainda aparece: ' + stripTags(nodes.deaths.outerHTML).trim().slice(0, 60));

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

  log(/oaovito game progress/.test(fonte), 'assinatura no cabeçalho', 'presente');
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

  // Fechada por padrão, e o clique abre — é o que torna óbvio que dá para abrir.
  log(nodes.bossLista.hidden !== false || /hidden/.test(src.match(/id="bossLista"[^>]*/)[0]),
    'a lista de chefes começa fechada', 'atributo hidden na marcação');
  // No navegador a lista nasce com `hidden` na marcação; o DOM de brinquedo
  // não lê marcação, então o teste parte do mesmo ponto.
  nodes.bossLista.hidden = true;
  nodes.bossHead.listeners.click[0]({});
  log(nodes.bossLista.hidden === false && /aberto/.test(nodes.bossPanel.className),
    'clicar no contador abre a lista e muda o tom do bloco',
    'hidden=' + nodes.bossLista.hidden + ', classe="' + nodes.bossPanel.className + '"');

  // E tem de recolher: abrir sem fechar foi o defeito relatado.
  nodes.bossHead.listeners.click[0]({});
  const recolheu = nodes.bossLista.hidden === true &&
    !/aberto/.test(nodes.bossPanel.className) &&
    nodes.bossHead.getAttribute('aria-expanded') === 'false';
  log(recolheu, 'clicar de novo recolhe e volta a ser só a contagem',
    'hidden=' + nodes.bossLista.hidden + ', classe="' + nodes.bossPanel.className + '"');

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
  const dirIcones = path.join(RAIZ, 'site', 'icones');
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
  const tam = /h1 \{[^}]*font-size: ([\d.]+)rem/.exec(src);
  log(tam && Number(tam[1]) >= 3, "o título cresceu", tam ? tam[1] + "rem" : "não achei");

  // Menu: sem régua embaixo, e cada tópico com contorno próprio.
  log(!/.topics {[^}]*border-bottom/.test(src), "o menu perdeu a linha embaixo",
    "o espaçamento faz o trabalho dela");
  log(/.topic {[^}]*border: 1px solid/.test(src), "cada tópico é um botão com contorno",
    "não é mais texto solto");
  log(/\.topic\.on \{[^}]*background: var\(--blood\)/.test(src), "o tópico ativo é peça cheia",
    "de relance se vê onde se está");

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

  // A assinatura ganhou peso.
  const assin = /\.assinatura \{[^}]*font-size: ([\d.]+)rem/.exec(src);
  log(assin && Number(assin[1]) >= 0.85, 'a assinatura ficou maior',
    assin ? assin[1] + 'rem' : 'não achei');
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
  log(fs.existsSync(path.join(RAIZ, "site", "icones", "emma.png")),
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

module.exports = { rodar, carregar };
