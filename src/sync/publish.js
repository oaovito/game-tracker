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

  const antes = fs.statSync(path.join(RAIZ, 'progress.json')).size;
  const depois = fs.statSync(path.join(dir, 'progress.json')).size;
  return { dir, antes, depois, campos: Object.keys(limpo).length };
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

module.exports = { sanitizar, fonteLimpa, montar, vazamentos, CAMPOS_PUBLICOS };

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
