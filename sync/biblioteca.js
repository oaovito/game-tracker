'use strict';
/*
 * biblioteca.js - quais jogos existem nesta máquina e na conta da pessoa.
 *
 * O pedido tem três fontes para o que pode ser encontrado:
 *
 *   - a biblioteca da Steam da pessoa: o que está instalado pela Steam e o que
 *     a conta já jogou;
 *   - o catálogo geral da Steam: serve para reconhecer um jogo pelo nome da
 *     pasta numa máquina que não tem Steam nenhuma (instalado pela Epic, pela
 *     GOG, por um instalador próprio, copiado de outro disco);
 *   - os jogos mais populares do momento, que incluem os que nem existem na
 *     Steam (Valorant, League of Legends, Fortnite, Minecraft).
 *
 * A regra do projeto vale aqui por inteiro: nada depende da Steam. Sem ela,
 * a varredura continua pelo disco, pelo registro do Windows e pelos
 * manifestos da Epic, e reconhece os nomes pela lista de populares que vem
 * com o projeto e pelo catálogo guardado da última vez que houve rede. Com
 * ela, ela acrescenta o que só ela sabe e confirma o que o disco achou.
 *
 * A varredura é pesada para o padrão do serviço (lista pastas de vários
 * discos e lê o registro), então não roda a cada ciclo: roda na partida e uma
 * vez por dia, entre duas rodadas, nunca com jogo aberto. O resultado fica em
 * biblioteca.json, estado desta máquina e fora do git.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ARQUIVO = path.join(RAIZ, 'biblioteca.json');
const CACHE = path.join(RAIZ, 'sync', 'cache');
const POPULARES = path.join(__dirname, 'populares.json');

const DIA = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------- nomes */

/**
 * O nome reduzido ao que identifica o jogo.
 *
 * Pasta e catálogo escrevem o mesmo jogo de jeitos diferentes: "Baldurs Gate
 * 3" contra "Baldur's Gate 3", "ELDEN RING" contra "Elden Ring™". Minúsculas,
 * sem marca registrada e sem pontuação sobrevive às duas grafias.
 */
function normalizar(nome) {
  return String(nome || '')
    .replace(/[™®©]/g, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** A chave estável de um jogo: o appId quando há, senão o nome. */
function chaveDe(j) {
  return j.appId ? 'steam-' + j.appId : 'jogo-' + normalizar(j.nome);
}

/*
 * O que não é jogo mesmo estando no catálogo da Steam: trilha sonora, kit de
 * desenvolvimento, servidor dedicado, demonstração. Reconhecer uma pasta
 * "Soundtrack" como jogo seria a varredura inventando coisa.
 */
const NAO_JOGO = /\b(soundtrack|ost|sdk|dedicated server|server|demo|playtest|benchmark|editor|tool|redistributable|dlc|season pass|artbook|wallpaper engine|beta)\b/i;

/* ------------------------------------------------------------- VDF */

/**
 * Lê VDF em texto (o formato dos .acf e .vdf da Steam) para um objeto.
 * Chaves em minúscula: a Steam não é consistente entre "apps" e "Apps".
 */
function lerVdf(texto) {
  const raiz = {};
  const pilha = [raiz];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let chave = null;
  let m;
  while ((m = re.exec(texto))) {
    const atual = pilha[pilha.length - 1];
    if (m[2] === '{') {
      const novo = {};
      if (chave !== null) atual[chave.toLowerCase()] = novo;
      pilha.push(novo);
      chave = null;
    } else if (m[2] === '}') {
      if (pilha.length > 1) pilha.pop();
      chave = null;
    } else if (chave === null) {
      chave = m[1];
    } else {
      atual[chave.toLowerCase()] = m[1].replace(/\\\\/g, '\\');
      chave = null;
    }
  }
  return raiz;
}

function lerTexto(arq) {
  try { return fs.readFileSync(arq, 'utf8'); } catch (e) { return null; }
}

function lerJson(arq) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return null; }
}

/* ------------------------------------------------------------- Steam local */

/** Jogos instalados pela Steam: um appmanifest por jogo, em cada biblioteca. */
function steamInstalados(steam, bibliotecas) {
  const saida = [];
  for (const lib of bibliotecas) {
    const apps = path.join(lib, 'steamapps');
    let nomes = [];
    try { nomes = fs.readdirSync(apps); } catch (e) { continue; }
    for (const n of nomes) {
      if (!/^appmanifest_\d+\.acf$/.test(n)) continue;
      const txt = lerTexto(path.join(apps, n));
      if (!txt) continue;
      const st = lerVdf(txt).appstate || {};
      if (!st.appid || !st.name || NAO_JOGO.test(st.name)) continue;
      // Ferramentas da própria Steam (Proton, runtime) não são jogo.
      if (/^(proton|steam linux runtime|steamworks common)/i.test(st.name)) continue;
      saida.push({
        appId: String(st.appid),
        nome: st.name,
        pasta: st.installdir ? path.join(apps, 'common', st.installdir) : null,
      });
    }
  }
  return saida;
}

/**
 * Jogos que a conta já jogou, estejam instalados ou não.
 *
 * O arquivo guarda por appId quando o jogo foi aberto e por quanto tempo; o
 * nome não está lá, e vem do catálogo. Sem nome no catálogo, o jogo fica de
 * fora em vez de aparecer como um número.
 */
function steamConta(steam) {
  const ids = new Set();
  let contas = [];
  try { contas = fs.readdirSync(path.join(steam, 'userdata')); } catch (e) { return []; }
  for (const c of contas) {
    const txt = lerTexto(path.join(steam, 'userdata', c, 'config', 'localconfig.vdf'));
    if (!txt) continue;
    const v = lerVdf(txt);
    const apps = (((v.userlocalconfigstore || {}).software || {}).valve || {}).steam;
    const lista = apps && (apps.apps || apps.Apps);
    if (!lista) continue;
    for (const [id, dados] of Object.entries(lista)) {
      if (!/^\d+$/.test(id) || !dados || typeof dados !== 'object') continue;
      if (dados.lastplayed || dados.playtime) ids.add(id);
    }
  }
  return [...ids];
}

/* ------------------------------------------------------------- catálogo e populares */

function pedir(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'trackeroao' }, timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => { try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

function guardar(nome, dados) {
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(path.join(CACHE, nome), JSON.stringify(dados));
  } catch (e) { /* cache é conveniência */ }
}

function doCache(nome, validade) {
  const arq = path.join(CACHE, nome);
  try {
    const st = fs.statSync(arq);
    const dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
    return { dados, fresco: Date.now() - st.mtimeMs < validade };
  } catch (e) { return null; }
}

/**
 * O catálogo geral da Steam, { appId: nome }.
 *
 * Duas fontes públicas e sem chave, uma de reserva da outra: a lista de apps
 * da própria Steam, e a do SteamSpy (só os mais jogados, mas com nome).
 * Guardado por uma semana. Sem rede, vale o último que houve; sem nunca ter
 * havido, o catálogo é vazio e a varredura segue com os populares.
 */
async function catalogoGeral(opts) {
  const o = opts || {};
  const c = doCache('catalogo-steam.json', 7 * DIA);
  if (c && c.fresco && !o.forcar) return c.dados;
  if (o.semRede) return c ? c.dados : {};
  const mapa = {};
  try {
    const r = await pedir('https://api.steampowered.com/ISteamApps/GetAppList/v2/');
    for (const a of ((r.applist || {}).apps || [])) {
      if (a && a.appid && a.name && !NAO_JOGO.test(a.name)) mapa[String(a.appid)] = a.name;
    }
  } catch (e) { /* segue para a reserva */ }
  if (!Object.keys(mapa).length) {
    for (let pagina = 0; pagina < 5; pagina++) {
      try {
        const r = await pedir('https://steamspy.com/api.php?request=all&page=' + pagina);
        for (const a of Object.values(r || {})) {
          if (a && a.appid && a.name && !NAO_JOGO.test(a.name)) mapa[String(a.appid)] = a.name;
        }
      } catch (e) { break; }
    }
  }
  if (Object.keys(mapa).length) { guardar('catalogo-steam.json', mapa); return mapa; }
  return c ? c.dados : {};
}

/**
 * Os mais jogados agora: [{ appId, nome, posicao }].
 *
 * Da Steam, a lista dos mais jogados; de reserva, o SteamSpy. Guardado por um
 * dia. A lista que vem com o projeto (populares.json) entra sempre, porque é
 * ela que cobre quem não está na Steam.
 */
async function populares(catalogo, opts) {
  const o = opts || {};
  const semente = (lerJson(POPULARES) || {}).lista || [];
  let daRede = [];
  const c = doCache('populares-steam.json', DIA);
  if (c && (c.fresco || o.semRede)) daRede = c.dados;
  else if (!o.semRede) {
    try {
      const r = await pedir('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/');
      daRede = ((r.response || {}).ranks || []).slice(0, 100)
        .map((x) => ({ appId: String(x.appid), posicao: x.rank }));
    } catch (e) {
      try {
        const r = await pedir('https://steamspy.com/api.php?request=top100in2weeks');
        daRede = Object.values(r || {}).map((a, i) => ({ appId: String(a.appid), nome: a.name, posicao: i + 1 }));
      } catch (e2) { daRede = c ? c.dados : []; }
    }
    if (daRede.length) guardar('populares-steam.json', daRede);
  }
  const lista = semente.map((s, i) => ({ ...s, appId: s.appId ? String(s.appId) : null, posicao: null, semente: i }));
  for (const p of daRede) {
    const nome = p.nome || catalogo[p.appId];
    if (!nome || NAO_JOGO.test(nome)) continue;
    const ja = lista.find((x) => (x.appId && x.appId === p.appId) || normalizar(x.nome) === normalizar(nome));
    if (ja) ja.posicao = ja.posicao || p.posicao;
    else lista.push({ appId: p.appId, nome, posicao: p.posicao, pastas: [], processos: [] });
  }
  return lista;
}

/* ------------------------------------------------------------- disco */

/**
 * Onde jogos costumam morar, em cada disco.
 *
 * Duas famílias de pasta. As "de jogo" (Games, XboxGames, Epic Games, GOG,
 * steamapps\common) só guardam jogo, então ali qualquer nome do catálogo
 * geral vale. As "de programa" (Program Files) guardam de tudo, e ali só
 * vale o que é certamente jogo: a biblioteca da pessoa e os populares. Sem
 * essa separação, um "Blender" em Program Files viraria jogo só porque a
 * Steam também vende o Blender.
 */
function raizesDoDisco() {
  if (process.platform !== 'win32') return [];
  const deJogo = [
    'Games', 'XboxGames', 'Epic Games', 'GOG Games', 'Riot Games', 'SteamLibrary\\steamapps\\common',
    'Program Files\\Epic Games', 'Program Files (x86)\\GOG Galaxy\\Games', 'Program Files\\EA Games',
    'Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games', 'Program Files (x86)\\Steam\\steamapps\\common',
    'Program Files\\Steam\\steamapps\\common', 'Program Files\\ModifiableWindowsApps',
  ];
  const dePrograma = ['Program Files', 'Program Files (x86)'];
  const raizes = [];
  for (const letra of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const disco = letra + ':\\';
    try { if (!fs.existsSync(disco)) continue; } catch (e) { continue; }
    for (const p of deJogo) raizes.push({ pasta: path.join(disco, p), tipo: 'jogo' });
    for (const p of dePrograma) raizes.push({ pasta: path.join(disco, p), tipo: 'programa' });
  }
  return raizes;
}

function subpastas(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) { return []; }
}

/* Executáveis que moram na pasta do jogo mas não são o jogo. */
const NAO_E_O_JOGO = /(unins|uninstall|setup|install|redist|vc_?redist|dxsetup|directx|crash|report|launcher|helper|updater|update|prereq|easyanticheat|eac|battleye|be_service|dotnet|vcredist|ue4prereq|unitycrashhandler|cefprocess|webhelper|overlay|config|settings|server|editor)/i;

/**
 * O executável do jogo numa pasta de instalação: o maior .exe que não seja
 * instalador, atualizador, anti-cheat ou relatório de erro. Procura até três
 * níveis, que é onde os motores costumam pôr (Binaries\Win64, bin\x64).
 */
function executaveis(pasta) {
  const achados = [];
  const andar = (dir, prof) => {
    if (prof > 3 || achados.length > 60) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of itens) {
      const c = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (!/^(_commonredist|redist|redistributables|directx|support|tools|docs|__installer|engine\\extras)$/i.test(it.name)) andar(c, prof + 1);
      } else if (/\.exe$/i.test(it.name) && !NAO_E_O_JOGO.test(it.name)) {
        try { achados.push({ nome: it.name, tam: fs.statSync(c).size }); } catch (e) { /* sumiu */ }
      }
    }
  };
  andar(pasta, 0);
  return achados.sort((a, b) => b.tam - a.tam).slice(0, 2).map((a) => a.nome);
}

/* ------------------------------------------------------------- registro e Epic */

function rodar(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
      (err, out) => resolve(err ? '' : String(out)));
  });
}

/** Programas registrados no Windows: { nome, pasta, editora }. */
async function registro() {
  if (process.platform !== 'win32') return [];
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    'Get-ItemProperty $k | Where-Object { $_.DisplayName } | Select-Object DisplayName,InstallLocation,Publisher | ConvertTo-Json -Compress',
  ].join('; ');
  const out = await rodar('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  try {
    const j = JSON.parse(out);
    return (Array.isArray(j) ? j : [j]).map((x) => ({ nome: x.DisplayName, pasta: x.InstallLocation || null, editora: x.Publisher || '' }));
  } catch (e) { return []; }
}

/** Jogos da Epic: um manifesto .item por jogo, com nome e executável. */
function epic() {
  if (process.platform !== 'win32') return [];
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const saida = [];
  let nomes = [];
  try { nomes = fs.readdirSync(dir); } catch (e) { return []; }
  for (const n of nomes) {
    if (!/\.item$/i.test(n)) continue;
    const j = lerJson(path.join(dir, n));
    if (!j || !j.DisplayName || NAO_JOGO.test(j.DisplayName)) continue;
    if (Array.isArray(j.AppCategories) && j.AppCategories.length && !j.AppCategories.includes('games')) continue;
    saida.push({
      nome: j.DisplayName,
      pasta: j.InstallLocation || null,
      processos: j.LaunchExecutable ? [path.basename(j.LaunchExecutable)] : [],
    });
  }
  return saida;
}

/* ------------------------------------------------------------- a varredura */

/**
 * Junta tudo numa lista só, um jogo por entrada.
 *
 * `fontes` diz de onde cada um veio, e é por ela que a página decide os
 * pinos: 'steam' e 'steam-conta' dizem que está na biblioteca da Steam;
 * 'disco', 'registro' e 'epic' dizem que foi achado sem ela. Um jogo achado
 * pelos dois lados é o caso em que a Steam confirma o que o disco viu.
 */
async function varrer(opts) {
  const o = opts || {};
  const instalacao = require('./instalacao');
  const steam = o.steam !== undefined ? o.steam : instalacao.steamPath();
  const catalogo = await catalogoGeral(o);
  const porNome = new Map();
  for (const [id, nome] of Object.entries(catalogo)) {
    const n = normalizar(nome);
    if (n.length >= 4 && !porNome.has(n)) porNome.set(n, { appId: id, nome });
  }
  const pops = await populares(catalogo, o);
  const popPorPasta = new Map();
  for (const p of pops) {
    for (const pasta of [p.nome, ...(p.pastas || [])]) popPorPasta.set(normalizar(pasta), p);
  }

  const jogos = new Map();
  const juntar = (j, fonte) => {
    const k = chaveDe(j);
    const ja = jogos.get(k) || jogos.get('jogo-' + normalizar(j.nome));
    const alvo = ja || { chave: k, nome: j.nome, appId: j.appId || null, fontes: [], instalado: false, pasta: null, processos: [] };
    if (!alvo.appId && j.appId) { alvo.appId = j.appId; }
    if (!alvo.fontes.includes(fonte)) alvo.fontes.push(fonte);
    if (j.pasta && !alvo.pasta) alvo.pasta = j.pasta;
    if (j.instalado) alvo.instalado = true;
    for (const p of j.processos || []) if (!alvo.processos.includes(p)) alvo.processos.push(p);
    jogos.delete('jogo-' + normalizar(alvo.nome));
    alvo.chave = chaveDe(alvo);
    jogos.set(alvo.chave, alvo);
  };

  // 1. Steam, quando existe.
  if (steam) {
    const libs = instalacao.bibliotecas(steam);
    for (const j of steamInstalados(steam, libs)) juntar({ ...j, instalado: true }, 'steam');
    for (const id of steamConta(steam)) {
      const nome = catalogo[id] || (pops.find((p) => p.appId === id) || {}).nome;
      if (nome) juntar({ appId: id, nome }, 'steam-conta');
    }
  }

  // 2. O disco, com ou sem Steam.
  const raizes = o.raizes || raizesDoDisco();
  for (const r of raizes) {
    for (const nomePasta of subpastas(r.pasta)) {
      const n = normalizar(nomePasta);
      const pop = popPorPasta.get(n);
      const doCat = r.tipo === 'jogo' ? porNome.get(n) : null;
      const naConta = [...jogos.values()].find((j) => normalizar(j.nome) === n);
      const achado = pop || doCat || naConta;
      if (!achado) continue;
      juntar({
        appId: achado.appId || null, nome: achado.nome, pasta: path.join(r.pasta, nomePasta),
        instalado: true, processos: achado.processos || [],
      }, 'disco');
    }
  }

  // 3. O registro do Windows e a Epic.
  for (const e of epic()) juntar({ ...e, instalado: true }, 'epic');
  for (const reg of (o.registro || await registro())) {
    const n = normalizar(reg.nome);
    const pop = popPorPasta.get(n);
    const doCat = porNome.get(n);
    if (!pop && !doCat) continue;
    if (/microsoft|nvidia|intel|amd|adobe|google|mozilla/i.test(reg.editora) && !pop) continue;
    const base = pop || doCat;
    juntar({ appId: base.appId || null, nome: base.nome, pasta: reg.pasta, instalado: !!reg.pasta, processos: (pop && pop.processos) || [] }, 'registro');
  }

  // O executável de quem está instalado e ainda não tem, para poder vigiar.
  for (const j of jogos.values()) {
    if (j.instalado && j.pasta && !j.processos.length) j.processos = executaveis(j.pasta);
    const pop = pops.find((p) => (p.appId && p.appId === j.appId) || normalizar(p.nome) === normalizar(j.nome));
    j.popular = pop && pop.posicao ? pop.posicao : null;
    if (pop && pop.arte) j.arteFonte = pop.arte;
  }

  // O banner de cada um, na maior resolução que houver (ver arte.js).
  try {
    await require('./arte').resolver([...jogos.values()], { semRede: o.semRede, normalizar, pedir: o.pedirArte });
  } catch (e) { /* arte é enfeite: a varredura não cai por ela */ }
  for (const j of jogos.values()) delete j.arteFonte;

  const lista = [...jogos.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const resultado = {
    em: new Date().toISOString(),
    comSteam: !!steam,
    catalogo: Object.keys(catalogo).length,
    jogos: lista,
    populares: pops.filter((p) => p.posicao).sort((a, b) => a.posicao - b.posicao).slice(0, 20)
      .map((p) => ({ appId: p.appId, nome: p.nome, posicao: p.posicao })),
  };
  if (!o.naoGravar) {
    const tmp = ARQUIVO + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(resultado, null, 1));
    fs.renameSync(tmp, ARQUIVO);
  }
  return resultado;
}

/** A última varredura gravada, ou null. */
function ultima() {
  return lerJson(ARQUIVO);
}

module.exports = {
  varrer, ultima, normalizar, chaveDe, lerVdf, steamInstalados, steamConta, executaveis,
  catalogoGeral, populares, ARQUIVO, NAO_JOGO,
};

if (require.main === module) {
  varrer({ semRede: process.argv.includes('--sem-rede') }).then((r) => {
    console.log(`  ${r.jogos.length} jogo(s)${r.comSteam ? ', com Steam' : ', sem Steam'}; catálogo com ${r.catalogo} nomes`);
    for (const j of r.jogos) {
      console.log(`  ${j.instalado ? '[instalado]' : '[na conta] '} ${j.nome}  (${j.fontes.join(', ')})` +
        (j.processos.length ? '  ' + j.processos.join(', ') : ''));
    }
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
