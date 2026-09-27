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
  'tools', 'arts', 'goodsUnlocks', 'history', 'notes',
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
  achievements: (a) => (a ? Object.assign({}, a, { lista: a.lista.map((x) => ({ bloco: x.bloco, stat: x.stat, nome: x.nome, descricao: x.descricao, oculta: x.oculta, conquistada: x.conquistada })) }) : a),
  playtime: (p) => (p ? { minutos: p.minutos, horas: p.horas, fonte: p.fonte } : p),
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

  const pagina = fs.readFileSync(path.join(RAIZ, 'sekiro-progresso.html'), 'utf8');
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

  const fontes = copiarFontes(path.join(dir, 'src'));

  const antes = fs.statSync(path.join(RAIZ, 'progress.json')).size;
  const depois = fs.statSync(path.join(dir, 'progress.json')).size;
  return { dir, antes, depois, campos: Object.keys(limpo).length, fontes };
}

/**
 * O código-fonte, junto do site.
 *
 * Existe por dois motivos. O primeiro é que o GitHub mede as linguagens do
 * repositório pelo que está versionado nele: com só a página publicada, o
 * projeto aparecia como "HTML 100%", o que não descreve nada — a maior parte
 * do trabalho é JavaScript de leitura do save e PowerShell de leitura de
 * memória. O segundo é que uma cópia feita à mão envelhece: esta é refeita a
 * cada publicação, então nunca diverge do que está rodando.
 *
 * Nada entra sem ser conferido, mas a conferência aqui é outra. O detector do
 * progresso é de forma: qualquer "AppData", qualquer "S0000.sl2" é vazamento,
 * porque no arquivo de dados essas palavras só apareceriam dentro de um
 * caminho real. No código elas são a descrição do formato — o parser precisa
 * dizer onde o save mora —, e recusar por isso deixaria de fora justamente os
 * arquivos que explicam o projeto. Então aqui se procura pelos valores
 * concretos desta máquina: o nome de usuário do Windows, os IPs das placas de
 * rede, um Steam ID de verdade, um caminho de usuário com nome no lugar do
 * marcador. É a diferença entre falar de um endereço e escrever o seu.
 */
const FORA = new Set(['node_modules', '.git', 'site', 'docs', 'redirect', 'snapshots', 'icones']);
const EXTS = new Set(['.js', '.ps1', '.json', '.html', '.md', '.bat', '.gitignore']);

function copiarFontes(destino) {
  const copiados = [];
  const recusados = [];

  const anda = (de, para) => {
    for (const nome of fs.readdirSync(de)) {
      if (FORA.has(nome)) continue;
      const cheio = path.join(de, nome);
      const st = fs.statSync(cheio);
      if (st.isDirectory()) { anda(cheio, path.join(para, nome)); continue; }
      const ext = path.extname(nome) || nome;
      if (!EXTS.has(ext)) continue;
      // O log traz caminho de máquina em cada linha, e o progresso cru traz o
      // save inteiro; nenhum dos dois é código.
      if (/\.log(\.\d+)?$/.test(nome) || nome === 'progress.json') continue;
      const texto = fs.readFileSync(cheio, 'utf8');
      const achados = vazamentosNoCodigo(texto);
      if (achados.length) { recusados.push({ arquivo: path.relative(RAIZ, cheio), achados }); continue; }
      fs.mkdirSync(para, { recursive: true });
      fs.writeFileSync(path.join(para, nome), texto);
      copiados.push(path.relative(destino, path.join(para, nome)));
    }
  };

  // Refaz do zero: arquivo apagado no projeto não pode sobreviver no site.
  fs.rmSync(destino, { recursive: true, force: true });
  anda(RAIZ, destino);
  return { copiados: copiados.length, recusados };
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
  if (/\b7656119\d{10}\b/.test(texto)) achados.push('Steam ID');

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

module.exports = { sanitizar, fonteLimpa, montar, copiarFontes, vazamentos, vazamentosNoCodigo, CAMPOS_PUBLICOS };

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
