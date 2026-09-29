'use strict';
/*
 * publish.js - prepara a versão pública da página, para o GitHub Pages.
 *
 * O progress.json que o serviço grava é de uso interno e NÃO pode ir para a
 * internet como está. Ele carrega o caminho do save:
 *
 *     C:\Users\<usuario>\AppData\Roaming\Sekiro\<steamid64>\S0000.sl2
 *
 * ou seja, o nome de usuário do Windows e o Steam ID - que é um identificador
 * real, ligado ao perfil da pessoa. Publicar isso seria vazar identidade junto
 * com o progresso do jogo, sem ninguém perceber, e sem volta depois de
 * indexado. Então a versão pública é montada campo a campo, por lista do que
 * ENTRA, e não por lista do que sai: assim um campo novo no futuro nasce
 * privado, em vez de vazar por esquecimento.
 *
 * Também ficam de fora os despejos crus (goodsRaw, weaponsRaw), que a página
 * não usa para nada e respondem por quase todo o tamanho do arquivo.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..');

/**
 * Só estes campos vão para o ar.
 *
 * A lista é do que ENTRA, não do que sai, para campo novo nascer privado. Isso
 * é deliberado, e tem o preço de que um campo novo some do site público até
 * alguém lembrar de pô-lo aqui — foi o que houve com playtime e bossKills. O
 * selftest agora cruza esta lista com tudo que a página lê de `sync`, então o
 * esquecimento passa a falhar em vez de sumir calado.
 */
const CAMPOS_PUBLICOS = [
  'generatedAt', 'ok', 'error', 'message', 'stale',
  'essentials', 'deaths', 'playtime', 'bossKills', 'achievements',
  'prayerBeadList', 'gourdSeedList',
  'bosses', 'miniBosses', 'headless', 'idols', 'idolCalibration',
  'tools', 'arts', 'goodsUnlocks', 'history', 'notes', 'efeitos',
  'jogador', 'demonBell', 'dragonrot', 'jogosVigiados',
];

/** O que sobra de `source` depois de tirar o que identifica a máquina. */
function fonteLimpa(source) {
  if (!source) return null;
  return {
    slot: source.slot,
    slotSelection: source.slotSelection,
    // saveModified fica de fora: é a mesma informação que a data da última
    // partida — a que horas a pessoa jogou. Esconder uma e publicar a outra
    // não esconderia nada.
    itemsRead: source.itemsRead,
  };
}

/**
 * Campos que vão para o ar, mas não inteiros.
 *
 * O tempo de jogo é um número inofensivo; a data da última partida não é. Ela
 * diz a que horas a pessoa jogou, e repetida ao longo do tempo desenha a
 * rotina dela para quem quiser olhar. O total de horas fica; o quando, não.
 */
const PODAS = {
  // A hora de cada conquista diz quando a pessoa jogou, igual ao last played.
  /*
   * Das conquistas sai a hora de cada desbloqueio, e só ela.
   *
   * A lista é por campo que ENTRA, como a de cima, e isso já cobrou o preço
   * uma vez: ícone, dificuldade e raridade nasceram e sumiram do site sem
   * nada falhar, porque não estavam escritos aqui. Nenhum dos três é privado
   * — caminho de arquivo local, faixa calculada, e porcentagem que a Steam
   * publica para todo mundo. O que não pode passar é `em`, a hora, que diz
   * quando a pessoa estava jogando.
   */
  achievements: (a) => (a ? Object.assign({}, a, {
    lista: a.lista.map((x) => ({
      bloco: x.bloco, stat: x.stat, nome: x.nome, descricao: x.descricao,
      oculta: x.oculta, conquistada: x.conquistada,
      icone: x.icone, dificuldade: x.dificuldade, raridade: x.raridade, shinobi: x.shinobi,
      descricaoOculta: x.descricaoOculta,
      fonte: x.fonte, incerta: x.incerta, confere: x.confere,
    })),
  }) : a),
  /*
   * Das mortes sai `em`, a hora da leitura.
   *
   * Parece inofensivo e nao e: quando o jogo esta fechado, `aoVivo` vem falso
   * e essa hora passa a ser exatamente a ultima vez que o jogo foi visto
   * aberto -- o last played por outro nome, que e o que o link publico nao
   * pode entregar. A pagina nunca leu esse campo; ele estava indo de carona.
   */
  deaths: (d) => (d ? {
    known: d.known, count: d.count, confidence: d.confidence,
    how: d.how, escopo: d.escopo, aoVivo: d.aoVivo,
  } : d),
  /*
   * Do jogador sai só o apelido.
   *
   * O objeto do módulo já nasce sem o nome de login da conta, mas a poda é
   * declarada aqui do mesmo jeito: a regra deste arquivo é que campo novo não
   * vaza por esquecimento, e para isso ela precisa valer para todo objeto que
   * tem mais de um campo. Apelido do Steam é público por natureza — é o nome
   * que aparece na lista de amigos de quem quer que seja.
   */
  jogador: (j) => (j ? { nick: j.nick, fonte: j.fonte } : j),  // sem o apelido de conferência
  /*
   * Dos jogos saem nome, pinos e escolha. A hora da varredura fica: ela diz
   * quando o computador estava ligado, que é do mesmo tipo da hora de jogo.
   */
  jogosVigiados: (j) => (j && Array.isArray(j.lista) ? {
    escolheu: !!j.escolheu,
    lista: j.lista.map((g) => ({
      chave: g.chave, nome: g.nome, leitura: g.leitura, vigiado: !!g.vigiado,
      instalado: g.instalado === undefined ? null : g.instalado,
      naSteam: !!g.naSteam, semSteam: !!g.semSteam, popular: g.popular || null,
      arte: g.arte || null,
    })),
  } : j),
  /*
   * Da podridão saem os nomes, não os números de item.
   *
   * O id do EquipParamGoods não diz nada a quem lê a página e é detalhe de
   * como o save foi lido. O que interessa é de quem é cada essência.
   */
  dragonrot: (d) => (d ? {
    ativo: d.ativo, quantos: d.quantos, total: d.total,
    essencias: (d.essencias || []).map((e) => ({ item: e.item, npc: e.npc })),
  } : d),
  demonBell: (b) => (b ? { ativo: b.ativo, label: b.label } : b),
  playtime: (p) => (p ? { minutos: p.minutos, horas: p.horas, fonte: p.fonte, internoSegundos: p.internoSegundos } : p),
};

function sanitizar(progresso) {
  const out = {};
  for (const campo of CAMPOS_PUBLICOS) {
    if (progresso[campo] === undefined) continue;
    out[campo] = PODAS[campo] ? PODAS[campo](progresso[campo]) : progresso[campo];
  }
  out.source = fonteLimpa(progresso.source);
  return out;
}

/**
 * Monta a pasta que o Pages serve.
 *
 * `index.html` é a mesma página, sem cópia divergente: uma segunda versão do
 * arquivo seria a primeira coisa a ficar velha.
 */
function montar(destino) {
  const dir = destino || path.join(RAIZ, 'docs');
  fs.mkdirSync(dir, { recursive: true });

  const pagina = fs.readFileSync(path.join(RAIZ, 'trackeroao.html'), 'utf8');
  fs.writeFileSync(path.join(dir, 'index.html'), pagina);

  let progresso = null;
  try {
    progresso = JSON.parse(fs.readFileSync(path.join(RAIZ, 'progress.json'), 'utf8'));
  } catch (e) {
    progresso = { ok: false, error: 'no-progress', message: 'Nothing read yet.' };
  }
  const limpo = sanitizar(progresso);
  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(limpo));

  // O Pages passa tudo pelo Jekyll por padrão, que ignora pasta começada com
  // underscore e pode reescrever arquivo. Aqui não há nada para processar.
  fs.writeFileSync(path.join(dir, '.nojekyll'), '');

  // Sem leitura nenhuma ainda, nao ha arquivo local para medir.
  let antes = 0;
  try { antes = fs.statSync(path.join(RAIZ, 'progress.json')).size; } catch (e) { /* nada lido */ }
  const depois = fs.statSync(path.join(dir, 'progress.json')).size;
  return { dir, antes, depois, campos: Object.keys(limpo).length };
}

/**
 * Confere o código do projeto inteiro, que agora é o próprio repositório.
 *
 * Isto substituiu uma cópia do fonte que era feita para dentro do site. A
 * cópia existia porque o repositório publicado era só a página montada; agora
 * o repositório é o projeto, então não há o que copiar — mas há mais o que
 * conferir, porque tudo que está aqui está no ar.
 *
 * A conferência é diferente da do progresso. O detector dos dados é de forma:
 * qualquer "AppData", qualquer "S0000.sl2" é vazamento, porque num arquivo de
 * dados essas palavras só apareceriam dentro de um caminho real. No código
 * elas são a descrição do formato — o parser precisa dizer onde o save mora —,
 * e recusar por isso acusaria justamente os arquivos que explicam o projeto.
 * Então aqui se procura pelos valores concretos desta máquina. É a diferença
 * entre falar de um endereço e escrever o seu.
 */
const FORA = new Set(['node_modules', '.git', 'docs', 'redirect', 'snapshots', 'arquivo', 'icones']);
const EXTS = new Set(['.js', '.ps1', '.vbs', '.html', '.md', '.bat', '.gitignore']);
/*
 * JSON é a exceção, e por lista fechada.
 *
 * A pasta tem dois tipos de JSON: os que são projeto (as dependências, a
 * tabela de offsets do save) e os que são estado (o que já foi contado, e
 * quando). Os de estado carregam carimbo de hora — `iniciadoEm`, `ultima`,
 * `contandoDesde` —, que é a mesma informação que a data da última partida,
 * justamente o que não vai para o ar. Como a diferença não está na extensão,
 * ela precisa estar escrita: entra quem está aqui, o resto fica de fora do
 * git e fora desta conferência.
 */
const JSON_DE_PROJETO = new Set(['package.json', path.join('sync', 'offsets.json')]);

/** Percorre o projeto e devolve os arquivos que não podem ser publicados. */
function conferirFontes() {
  const sujos = [];
  let vistos = 0;

  const anda = (de) => {
    for (const nome of fs.readdirSync(de)) {
      if (FORA.has(nome)) continue;
      const cheio = path.join(de, nome);
      if (fs.statSync(cheio).isDirectory()) { anda(cheio); continue; }
      const ext = path.extname(nome) || nome;
      const relativo = path.relative(RAIZ, cheio);
      if (ext === '.json') {
        if (!JSON_DE_PROJETO.has(relativo)) continue;
      } else if (!EXTS.has(ext)) continue;
      if (/\.log(\.\d+)?$/.test(nome)) continue;
      vistos++;
      const achados = vazamentosNoCodigo(fs.readFileSync(cheio, 'utf8'));
      if (achados.length) sujos.push({ arquivo: relativo, achados });
    }
  };

  anda(RAIZ);
  return { vistos, sujos };
}

/** Confere que nada que identifica a máquina passou. */
function vazamentos(texto) {
  const achados = [];
  const padroes = [
    [/[A-Za-z]:\\\\?Users\\\\?[^"\\/]+/i, 'caminho de usuário do Windows'],
    [/\b7656119\d{10}\b/, 'Steam ID'],
    [/AppData/i, 'caminho de AppData'],
    [/\bS0000\.sl2\b/i, 'nome do arquivo de save'],
    [/\b192\.168\.\d+\.\d+\b/, 'IP da rede local'],
    [/goodsRaw|weaponsRaw/, 'despejo cru do inventário'],
    [/"ultimaVez"/, 'data da última partida'],
  ];
  for (const [re, nome] of padroes) if (re.test(texto)) achados.push(nome);
  return achados;
}

/** Os endereços IPv4 desta máquina na rede, para procurar por eles no código. */
function ipsDaMaquina() {
  const fora = [];
  const faces = os.networkInterfaces();
  for (const nome of Object.keys(faces)) {
    for (const f of faces[nome] || []) {
      if (f.family === 'IPv4' && !f.internal) fora.push(f.address);
    }
  }
  return fora;
}

/**
 * O mesmo cuidado, aplicado a código em vez de dados.
 *
 * Procura pelos valores desta máquina, não pela forma deles: o nome de usuário
 * do Windows, um IP de placa de rede, um Steam ID real, um caminho de usuário
 * com nome concreto no lugar do marcador `<usuario>`. Falar do formato do save
 * é o trabalho do parser; escrever o caminho da sua casa nele é que não.
 */
function vazamentosNoCodigo(texto) {
  const achados = [];
  // 76561197960265728 é a base universal da Steam, a constante que se subtrai
  // de um SteamID64 para chegar no id de conta. Ela está em qualquer
  // documentação e não identifica ninguém; qualquer outro número dessa forma,
  // sim. Sem esta ressalva o próprio conversor seria recusado.
  for (const m of texto.matchAll(/7656119\d{10}/g)) {
    if (m[0] !== '76561197960265728') { achados.push('Steam ID'); break; }
  }

  // A pasta pessoal, escrita por extenso. Não se procura pelo nome da conta do
  // Windows: aqui ela se chama igual ao apelido que o site publica de
  // propósito, então procurar por ele acusaria o rodapé da própria página. O
  // que identifica a máquina é o caminho, e o caminho não coincide com o
  // apelido.
  let casa = '';
  try { casa = os.homedir() || ''; } catch (e) { /* sem casa, sem problema */ }
  if (casa && texto.toLowerCase().includes(casa.toLowerCase())) achados.push('pasta pessoal desta máquina');

  for (const ip of ipsDaMaquina()) if (texto.includes(ip)) achados.push('IP desta máquina (' + ip + ')');

  // Caminho de usuário com nome de gente. Marcador de documentação passa —
  // `<usuario>`, `...`, `%USERNAME%` —, nome concreto não.
  for (const m of texto.matchAll(/[A-Za-z]:\\+Users\\+([^\\"'\s]+)/g)) {
    const quem = m[1];
    if (/^(\.{2,}|<[^>]*>|%[^%]*%|SEU[-_]?USU[AÁ]RIO)$/i.test(quem)) continue;
    achados.push('caminho de usuário do Windows: ' + quem);
  }

  return [...new Set(achados)];
}

module.exports = { sanitizar, fonteLimpa, montar, conferirFontes, vazamentos, vazamentosNoCodigo, CAMPOS_PUBLICOS };

if (require.main === module) {
  const r = montar(process.argv[2]);
  const texto = fs.readFileSync(path.join(r.dir, 'progress.json'), 'utf8');
  const achados = vazamentos(texto);
  console.log(`  pasta     : ${r.dir}`);
  console.log(`  progresso : ${(r.antes / 1024).toFixed(1)} KB -> ${(r.depois / 1024).toFixed(1)} KB, ${r.campos} campos`);
  if (achados.length) {
    console.error(`  VAZAMENTO : ${achados.join(', ')} - não publique assim`);
    process.exitCode = 1;
  } else {
    console.log('  conferido : nada de máquina, conta ou rede no arquivo público');
  }
}
