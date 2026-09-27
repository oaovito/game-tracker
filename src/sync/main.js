'use strict';
/*
 * main.js - the resident process.
 *
 * Two jobs, deliberately kept separate:
 *
 *   1. A cheap poll (default every 5s) that just asks "is sekiro.exe running?".
 *      This is all that runs while the game is closed - no file handles, no
 *      watcher, no reading an 11 MB save.
 *   2. Only while the game IS running, a real fs.watch on the save directory
 *      that re-reads and re-parses the save shortly after each autosave.
 *
 * When the game exits the watcher is closed and we drop back to job 1.
 * The web server runs the whole time so the page stays reachable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const sl2 = require('./sl2');
const parse = require('./parse');
const serve = require('./serve');
const mdns = require('./mdns');
const publish = require('./publish');
const instalacao = require('./instalacao');
const hibernar = require('./hibernar');
const qrfile = require('./qrfile');

// --------------------------------------------------------------------- log
// Instalado como tarefa agendada, o processo roda oculto e o stdout se perde.
// Espelhar tudo num arquivo é a única forma de diagnosticar depois.
const LOG_FILE = path.join(__dirname, 'sekiro-sync.log');
const LOG_MAX = 512 * 1024;

function rotateLog() {
  try {
    if (fs.statSync(LOG_FILE).size > LOG_MAX) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    }
  } catch (e) {
    /* ainda não existe */
  }
}

const ANSI = /\x1b\[[0-9;]*m/g;

function hookConsole() {
  rotateLog();
  try {
    // BOM para o Bloco de Notas e o Get-Content lerem os acentos direito.
    if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '﻿');
  } catch (e) {
    /* segue sem log */
  }
  for (const nivel of ['log', 'error']) {
    const original = console[nivel].bind(console);
    console[nivel] = (...args) => {
      original(...args);
      try {
        const bruto = args
          .map((a) => (typeof a === 'string' ? a : require('util').inspect(a)))
          .join(' ');
        const limpo = bruto.replace(ANSI, '');
        // O QR é desenhado com blocos coloridos: sem as cores sobram centenas
        // de linhas só de espaço, que não dizem nada num arquivo de log.
        if (limpo.trim() === '' && bruto.length > 40) return;
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${limpo}\n`);
      } catch (e) {
        /* log é diagnóstico, nunca motivo para derrubar o serviço */
      }
    };
  }
}

const PROCESS_NAME = 'sekiro.exe';
const POLL_MS = Number(process.env.SEKIRO_POLL_MS || 5000);
const DEBOUNCE_MS = Number(process.env.SEKIRO_DEBOUNCE_MS || 900);
const PORT = Number(process.env.PORT || 8777);

/**
 * Por quais nomes a máquina atende na rede local.
 *
 * O sufixo `.local` não é preferência minha: é o único que o mDNS atende, e é
 * justamente ele que faz iPhone, iPad e Mac resolverem sem instalar nem
 * configurar nada. Um nome como "oaovito.sekiro" sairia do aparelho como
 * consulta de DNS comum, não chegaria até aqui, e morreria no servidor do
 * provedor.
 *
 * `oaovito.sekiro.local` vem primeiro por ser o mais parecido com o nome
 * pedido; os outros dois ficam como garantia, porque nem todo resolvedor
 * procura nomes de vários rótulos dentro de `.local` - alguns só tratam o
 * nome simples.
 */
const NOMES_REDE = ['oaovito.sekiro.local', 'sekiro.local', 'oaovito.local'];

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'progress.json');

// --------------------------------------------------------- process detection
function isGameRunning() {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile(
        'tasklist',
        ['/FI', `IMAGENAME eq ${PROCESS_NAME}`, '/NH', '/FO', 'CSV'],
        { windowsHide: true, timeout: 8000 },
        (err, stdout) => {
          if (err) return resolve(false);
          resolve(stdout.toLowerCase().includes(PROCESS_NAME));
        }
      );
    });
  }
  // Linux / Steam Deck: read /proc directly rather than spawning anything.
  return new Promise((resolve) => {
    fs.readdir('/proc', (err, entries) => {
      if (err) return resolve(false);
      for (const e of entries) {
        if (!/^\d+$/.test(e)) continue;
        try {
          const comm = fs.readFileSync(`/proc/${e}/comm`, 'utf8').trim().toLowerCase();
          if (comm === PROCESS_NAME || comm.startsWith('sekiro')) return resolve(true);
        } catch (err2) {
          /* process vanished between readdir and read; ignore */
        }
      }
      resolve(false);
    });
  });
}

// ------------------------------------------------------------- slot learning
/**
 * Remember each slot block's checksum. When exactly one changes between two
 * reads, that is the slot the game is actually writing, which is a far more
 * reliable answer than guessing from the contents.
 */
function learnActiveSlot(save, state) {
  const digests = {};
  for (const entry of sl2.slotEntries(save)) {
    digests[entry.index] = sl2
      .blockChecksums(save.buf, entry)
      .stored.toString('hex');
  }
  const previous = state.slotDigests;
  state.slotDigests = digests;

  if (!previous) return null;
  const changed = Object.keys(digests).filter((k) => previous[k] && previous[k] !== digests[k]);
  if (changed.length === 1) {
    const idx = Number(changed[0]);
    if (state.activeSlot !== idx) {
      state.activeSlot = idx;
      return idx;
    }
  }
  return null;
}

// ------------------------------------------------------------------ the sync
let config = parse.loadConfig();
let state = parse.loadState();
let lastWrittenHash = null;

/* --------------------------------------------------------- hibernação */

// De dez em dez minutos, e só age depois de três confirmações seguidas E meia
// hora. Um disco externo que não montou, ou o Steam no meio de uma atualização,
// dão uma leitura de "não instalado" que se desfaz sozinha em segundos —
// desligar na primeira delas seria desligar por engano.
const CHECAR_INSTALACAO_MS = 10 * 60 * 1000;
const CONFIRMACOES = 3;
const ESPERA_MINIMA_MS = 30 * 60 * 1000;
let ausenteDesde = null;
let ausenteVezes = 0;

function vigiarInstalacao(aoSumir) {
  const checar = () => {
    let e;
    try { e = instalacao.estado(); } catch (err) { return; }

    // Só o `false` conta. O `null` quer dizer "não sei", e não saber nunca
    // pode virar motivo para desligar nada.
    if (e.instalado !== false || !e.checagemValida) {
      if (ausenteVezes) console.log('  [jogo] voltou a aparecer; hibernação cancelada');
      ausenteDesde = null;
      ausenteVezes = 0;
      return;
    }

    ausenteVezes++;
    if (!ausenteDesde) {
      ausenteDesde = Date.now();
      console.log('  [jogo] não encontrei o Sekiro instalado; confirmando antes de agir');
      return;
    }
    const tempo = Date.now() - ausenteDesde;
    if (ausenteVezes < CONFIRMACOES || tempo < ESPERA_MINIMA_MS) {
      console.log(`  [jogo] segue ausente (${ausenteVezes}/${CONFIRMACOES})`);
      return;
    }
    aoSumir(e);
  };
  checar();
  const t = setInterval(checar, CHECAR_INSTALACAO_MS);
  if (t.unref) t.unref();
  return { checar, timer: t };
}

/** Guarda tudo, tira a tarefa do login e encerra o processo. */
function hibernarAgora(e) {
  console.log('');
  console.log('  O Sekiro não está mais instalado. Guardando tudo e saindo.');
  let saves = [];
  try {
    for (const s of sl2.listSavePaths()) {
      saves.push(s.file);
      if (fs.existsSync(s.file + '.bak')) saves.push(s.file + '.bak');
    }
  } catch (err) { /* sem save: guarda o resto do mesmo jeito */ }

  let r = null;
  try {
    r = hibernar.arquivar({ saves, evidencias: e.evidencias });
    console.log(`  [guardado] ${r.destino}`);
    for (const g of r.manifesto.projeto) {
      console.log(`     ${g.arquivo} — ${g.porque}`);
    }
    for (const g of r.manifesto.save) {
      console.log(`     save/${g.arquivo} — ${(g.bytes / 1048576).toFixed(1)} MB`);
    }
  } catch (err) {
    console.log(`  [guardado] FALHOU: ${err.message} — não vou remover a tarefa sem ter guardado`);
    return;                           // sem cópia, nada é desligado
  }

  const t = hibernar.removerTarefa();
  console.log(t.ok ? '  [tarefa] removida do login' : `  [tarefa] ${t.erro}`);
  console.log('');
  console.log('  Para voltar, depois de reinstalar o jogo:');
  console.log('      powershell -ExecutionPolicy Bypass -File reativar.ps1');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------- GitHub Pages */

const SITE = path.join(ROOT, 'site');
// Uma publicação a cada três minutos, no máximo. O save é gravado o tempo todo
// enquanto se joga, e empurrar a cada gravação encheria o histórico de commits
// e passaria o dia esperando o Pages reconstruir.
const PUBLICAR_MS = 3 * 60 * 1000;
let ultimaPublicacao = 0;
let publicando = false;
let pendente = false;
let agendado = false;

function temSite() {
  try { return fs.existsSync(path.join(SITE, '.git')); } catch (e) { return false; }
}

/** Marca que há novidade para publicar. A hora de fato quem decide é a fila. */
function publicar() {
  if (!temSite()) return;
  pendente = true;
  escoar();
}

function escoar() {
  if (publicando || !pendente) return;
  const espera = PUBLICAR_MS - (Date.now() - ultimaPublicacao);
  if (espera > 0) {
    if (agendado) return;
    agendado = true;
    const t = setTimeout(() => { agendado = false; escoar(); }, espera + 200);
    if (t.unref) t.unref();
    return;
  }
  // Alguém pode estar mexendo no repositório à mão neste momento. Duas escritas
  // simultâneas dão "index.lock: File exists" e a publicação sai pela metade —
  // aconteceu. Se há lock, adia em vez de disputar.
  try {
    if (fs.existsSync(path.join(SITE, '.git', 'index.lock'))) {
      console.log('  [pages] repositório ocupado; publico na próxima');
      pendente = true;
      publicando = false;
      const t = setTimeout(escoar, 30000);
      if (t.unref) t.unref();
      return;
    }
  } catch (e) { /* se nem dá para olhar, segue e o git reclama */ }

  publicando = true;
  pendente = false;
  ultimaPublicacao = Date.now();

  let r;
  try {
    r = publish.montar(SITE);
  } catch (err) {
    console.log(`  [pages] não consegui montar: ${err.message}`);
    publicando = false;
    return;
  }

  // Porta de segurança: se o que identifica a máquina ou a conta passar pelo
  // saneamento, não publica. Preferir não atualizar o site a vazar Steam ID.
  for (const arquivo of ['index.html', 'progress.json']) {
    let achados = [];
    try { achados = publish.vazamentos(fs.readFileSync(path.join(SITE, arquivo), 'utf8')); } catch (e) { /* some depois */ }
    if (achados.length) {
      console.log(`  [pages] PUBLICAÇÃO CANCELADA - ${arquivo} traz ${achados.join(', ')}`);
      publicando = false;
      return;
    }
  }

  const git = (args) => new Promise((resolve) => {
    execFile('git', args, { cwd: SITE, windowsHide: true }, (err, out, errOut) =>
      resolve({ err, out: String(out || ''), errOut: String(errOut || '') }));
  });

  (async () => {
    try {
      const st = await git(['status', '--porcelain']);
      if (!st.out.trim()) { publicando = false; return; }   // nada mudou de fato
      await git(['add', '-A']);
      const msg = `Progress at ${new Date().toISOString()}`;
      // Sem forçar identidade aqui: quem manda é o `git config` do próprio
      // site/. Fixar um e-mail no código faria todo commit sair com ele,
      // inclusive se a preferência mudar depois.
      const c = await git(['commit', '-q', '-m', msg]);
      if (c.err && !/nothing to commit/i.test(c.out + c.errOut)) {
        console.log(`  [pages] commit falhou: ${(c.errOut || c.out).trim().split('\n')[0]}`);
        publicando = false;
        return;
      }
      const p = await git(['push', 'origin', 'main']);
      if (p.err) {
        // Sem rede, token vencido: o site fica com a versão anterior e tenta de
        // novo na próxima mudança. Não é motivo para o serviço parar.
        console.log(`  [pages] push falhou: ${(p.errOut || p.out).trim().split('\n').pop()}`);
        pendente = true;
      } else {
        console.log(`  [pages] publicado (${(r.depois / 1024).toFixed(1)} KB)`);
      }
    } catch (err) {
      console.log(`  [pages] erro ao publicar: ${err.message}`);
    } finally {
      publicando = false;
      escoar();
    }
  })();
}

function syncNow(reason) {
  let progress;
  try {
    const file = sl2.findSavePath();
    if (!file) {
      progress = {
        generatedAt: new Date().toISOString(),
        ok: false,
        error: 'no-save-found',
        message: 'No S0000.sl2 found.',
      };
    } else {
      const save = sl2.readSave(file);
      const learned = learnActiveSlot(save, state);
      if (learned !== null) {
        console.log(`  [slot] o jogo está gravando no slot ${learned}; usando esse a partir de agora`);
      }
      parse.saveState(state);
      // observe: este é o processo residente, o único que vê as gravações do
      // save em sequência, e portanto o único que pode alimentar a busca do
      // contador de mortes.
      progress = parse.buildProgress({ config, state, file, save, observe: true });
    }
  } catch (err) {
    progress = {
      generatedAt: new Date().toISOString(),
      ok: false,
      error: 'read-failed',
      message: err.message,
    };
  }

  // Uma falha nunca apaga o ultimo resultado bom; o hash tem que ser o do que
  // vai ser realmente escrito, nao o do objeto cru.
  progress = parse.finalizeProgress(OUT_FILE, progress);

  // Skip the write when nothing actually changed, so the page's poll does not
  // see a new timestamp on every autosave of an unrelated part of the save.
  const body = JSON.stringify(progress);
  const hash = crypto.createHash('md5').update(body.replace(/"generatedAt":"[^"]*"/, '')).digest('hex');
  if (hash === lastWrittenHash) return;
  lastWrittenHash = hash;

  parse.writeProgress(OUT_FILE, progress);
  publicar();
  const stamp = new Date().toLocaleTimeString();
  if (progress.ok) {
    const e = progress.essentials;
    const dead = progress.bosses.filter((b) => b.defeated).length;
    console.log(
      `  [${stamp}] ${reason}: slot ${progress.source.slot}, ` +
        `${e.prayerBeads.collected}/${e.prayerBeads.totalInGame} contas, ` +
        `${e.gourdSeeds.held} semente(s), ${dead} chefe(s) com memória`
    );
  } else {
    console.log(`  [${stamp}] ${reason}: ${progress.message || progress.error}`);
  }
  const recentes = (progress.history || []).filter((h) => h.at === progress.generatedAt);
  for (const r of recentes) console.log(`  [novo] ${r.tipo}: ${r.label} - ${r.texto}`);
  if (progress.stale) {
    console.log(`  [aviso] save indisponivel (${progress.stale.error}); servindo a leitura de ${progress.stale.leituraDe}`);
  }
}

// -------------------------------------------------------------- the watcher
let watcher = null;
let debounceTimer = null;

function startWatching() {
  if (watcher) return;
  const file = sl2.findSavePath();
  if (!file) {
    console.log('  [watch] jogo aberto, mas não achei o save ainda');
    return;
  }
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    // Watching the directory rather than the file survives the game replacing
    // the save rather than writing in place.
    watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
      if (filename && path.basename(filename) !== base) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => syncNow('autosave'), DEBOUNCE_MS);
    });
    watcher.on('error', () => stopWatching());
    console.log(`  [watch] monitorando ${file}`);
  } catch (err) {
    console.log(`  [watch] não consegui monitorar: ${err.message}`);
    watcher = null;
  }
}

function stopWatching() {
  if (!watcher) return;
  try {
    watcher.close();
  } catch (e) {
    /* already gone */
  }
  watcher = null;
  clearTimeout(debounceTimer);
  debounceTimer = null;
  console.log('  [watch] parado (nenhum handle aberto no save)');
}

// ------------------------------------------------------------------ a rede
/*
 * Como serviço, este processo sobe segundos depois do logon - antes de o Wi-Fi
 * associar. Nesse instante não existe IP de LAN, então não adianta anunciar a
 * URL nem gravar o QR uma vez só no boot. Aqui ficamos de olho: quando um
 * endereço aparece (ou muda, por DHCP), anunciamos e regravamos o QR, para que
 * o arquivo na pasta esteja sempre certo sem ninguém rodar nada.
 */
let ultimoIp = null;

/**
 * `obterUrl` existe para poder testar as transições sem depender da placa de
 * rede real; em produção é sempre qrfile.lanUrl.
 */
function vigiarRede(obterUrl, intervalo, aoMudar) {
  const fonte = obterUrl || qrfile.lanUrl;
  const avisar = (ip) => { try { if (aoMudar) aoMudar(ip); } catch (e) { /* gancho não derruba o watcher */ } };
  const checar = () => {
    let url = null;
    try {
      url = fonte();
    } catch (e) {
      return;
    }
    const ip = url ? url.replace(/^http:\/\/([^:]+).*$/, '$1') : null;
    if (ip === ultimoIp) return;

    if (!ip) {
      console.log('  [rede] sem IP de rede local no momento - só localhost');
      ultimoIp = null;
      avisar(null);
      return;
    }
    const antes = ultimoIp;
    ultimoIp = ip;
    console.log(
      antes
        ? `  [rede] o IP mudou de ${antes} para ${ip}`
        : `  [rede] disponível na rede: ${url}`
    );
    try {
      const svg = path.join(ROOT, 'qr-acesso.svg');
      fs.writeFileSync(svg, qrfile.toSvg(require('./qr').encode(url, 'L'), url));
      console.log(`  [qr] ${svg} regravado`);
    } catch (e) {
      console.log(`  [qr] não consegui regravar: ${e.message}`);
    }
    avisar(ip);
  };
  checar();
  const t = setInterval(checar, intervalo || 15000);
  if (t.unref && intervalo) t.unref();
  return { checar, timer: t };
}

// ------------------------------------------------------------------ the loop
let gameWasRunning = null;

async function pollOnce() {
  let running = false;
  try {
    running = await isGameRunning();
  } catch (e) {
    running = false;
  }

  if (running !== gameWasRunning) {
    gameWasRunning = running;
    if (running) {
      console.log('\n  >> Sekiro aberto - sincronização ativa');
      startWatching();
      syncNow('jogo aberto');
    } else {
      console.log('\n  >> Sekiro fechado - só o poll leve continua rodando');
      stopWatching();
    }
  }
}

async function run() {
  hookConsole();
  console.log('');
  console.log('  Sekiro - sincronização de progresso');
  console.log('  (somente leitura: este programa nunca escreve no save do jogo)');
  console.log('');

  // Uma exceção solta não pode derrubar o serviço: o servidor precisa continuar
  // no ar mesmo que uma leitura do save falhe de forma inesperada.
  process.on('uncaughtException', (err) => {
    console.error('  [erro] exceção não tratada:', err && err.stack ? err.stack : err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('  [erro] promessa rejeitada:', err && err.stack ? err.stack : err);
  });

  const saves = sl2.listSavePaths();
  if (saves.length) {
    for (const s of saves) console.log(`  save encontrado: ${s.file}`);
  } else {
    console.log('  Nenhum save encontrado ainda - vou procurar de novo a cada varredura.');
  }

  // One read at startup so the page has data even with the game closed.
  syncNow('leitura inicial');

  try {
    await serve.start({ root: ROOT, port: PORT, indexFile: 'sekiro-progresso.html', quiet: true });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n  A porta ${PORT} já está ocupada.`);
      console.error(`  Feche o outro processo, ou escolha outra porta:`);
      console.error(`      set PORT=8888 && npm start        (Windows)`);
      console.error(`      PORT=8888 npm start               (Linux)\n`);
    } else {
      console.error('\n  Não consegui subir o servidor:', err.message, '\n');
    }
    process.exit(1);
  }

  // Porta 80 além da principal: com ela o endereço perde o ":8777", que é a
  // diferença entre um link que dá para ditar e um que não dá. Se não der,
  // seguimos com a porta principal - não é motivo para nada parar.
  const extra = await serve.listenExtra({ root: ROOT, port: 80, indexFile: 'sekiro-progresso.html' });
  if (extra.ok) console.log('  [http] também na porta 80');
  else console.log(`  [http] porta 80 indisponível (${extra.error}); o endereço sai com :${PORT}`);

  // Nome na rede local. `.local` não é escolha: é o único sufixo que o mDNS
  // atende, e é o que faz iPhone e Mac resolverem sem configurar nada.
  const nomeador = mdns.responder({
    nomes: NOMES_REDE,
    obterIp: () => {
      const a = serve.localAddresses();
      return a.length ? a[0].address : null;
    },
    log: (m) => console.log('  ' + m),
  });

  if (nomeador.ativo()) {
    const porta = extra.ok ? '' : ':' + PORT;
    console.log('');
    console.log('  Link para mandar a quem está no mesmo Wi-Fi:');
    console.log(`      http://sekiro.local${porta}`);
    console.log('');
  }

  vigiarRede(null, null, (novo) => nomeador.ipMudou(novo));
  vigiarInstalacao(hibernarAgora);

  await pollOnce();
  const timer = setInterval(pollOnce, POLL_MS);

  const shutdown = () => {
    clearInterval(timer);
    stopWatching();
    console.log('\n  Encerrando.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = { isGameRunning, learnActiveSlot, syncNow, vigiarRede, vigiarInstalacao };
