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
const instalacao = require('./instalacao');
const hibernar = require('./hibernar');
const jogos = require('./jogos');
const atualizar = require('./atualizar');

// --------------------------------------------------------------------- log
// Instalado como tarefa agendada, o processo roda oculto e o stdout se perde.
// Espelhar tudo num arquivo é a única forma de diagnosticar depois.
const LOG_FILE = path.join(__dirname, 'trackeroao.log');
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
        // Linha só de espaços com muito conteúdo bruto é resto de desenho no
        // terminal: não diz nada num arquivo de log.
        if (limpo.trim() === '' && bruto.length > 40) return;
        fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${limpo}\n`);
      } catch (e) {
        /* log é diagnóstico, nunca motivo para derrubar o serviço */
      }
    };
  }
}

/*
 * O nome do processo saiu daqui e foi para o catalogo.
 *
 * Escrito nesta linha, ele nao tinha como ser escolhido nem trocado sem mexer
 * em codigo -- e o pedido e justamente que a pessoa escolha, dentro da
 * aplicacao, qual jogo faz a bandeja acender. O que sobra aqui e a reserva
 * para o caso de o catalogo nao poder ser lido.
 */
const PROCESS_FALLBACK = 'sekiro.exe';
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
 * `trackeroao.local` é o nome do aplicativo de tela inicial do celular: é por
 * ele que o iPhone e o Android acham este computador na rede de casa, sem IP
 * e sem domínio. Os outros ficam por quem já usava os nomes antigos.
 */
const NOMES_REDE = ['trackeroao.local', 'oaovito.sekiro.local', 'sekiro.local', 'oaovito.local'];

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'progress.json');

// --------------------------------------------------------- process detection
/** Os nomes de imagem a procurar agora, relidos a cada volta do poll. */
function alvos() {
  const lista = jogos.processos();
  return lista.length ? lista : [PROCESS_FALLBACK];
}

/**
 * Qual jogo vigiado esta aberto, ou null.
 *
 * Devolve o nome do processo e nao um booleano porque quem chama precisa saber
 * QUAL jogo abriu: e o nome dele que vai para a bandeja e para o log.
 */
function jogoAberto() {
  const nomes = alvos();
  if (!nomes.length) return Promise.resolve(null);

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      /*
       * Sem filtro, e a filtragem e feita aqui.
       *
       * A versao anterior passava um `/FI IMAGENAME eq X` por jogo vigiado,
       * achando que o tasklist juntaria os filtros com OU. Ele junta com E: com
       * dois jogos no catalogo, a pergunta vira "qual processo se chama ao
       * mesmo tempo sekiro.exe e outracoisa.exe", e a resposta e sempre
       * nenhum. Com um jogo so funcionava por acidente, e teria quebrado
       * exatamente quando o catalogo crescesse -- que e para onde esta parte
       * do projeto existe para ir. Medido: "No tasks are running which match
       * the specified criteria" para dois filtros de processos que ESTAO
       * rodando.
       *
       * A lista inteira custa ~190 ms e ~9 KB uma vez a cada cinco segundos, e
       * e uma chamada so independente de quantos jogos forem vigiados.
       */
      execFile('tasklist', ['/NH', '/FO', 'CSV'],
        { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve(null);
          const saida = String(stdout).toLowerCase();
          // O nome vem entre aspas na primeira coluna do CSV. Comparar com as
          // aspas evita que "sekiro.exe" case com "naosekiro.exe.bak".
          resolve(nomes.find((n) => saida.includes('"' + n + '"')) || null);
        });
    });
  }

  // Linux / Steam Deck: le /proc direto em vez de abrir processo nenhum.
  return new Promise((resolve) => {
    fs.readdir('/proc', (err, entries) => {
      if (err) return resolve(null);
      for (const e of entries) {
        if (!/^\d+$/.test(e)) continue;
        try {
          const comm = fs.readFileSync('/proc/' + e + '/comm', 'utf8').trim().toLowerCase();
          const achou = nomes.find((n) => comm === n || comm === n.replace(/\.exe$/, ''));
          if (achou) return resolve(achou);
        } catch (err2) {
          /* process vanished between readdir and read; ignore */
        }
      }
      resolve(null);
    });
  });
}

/** A forma antiga da pergunta, que o resto do codigo e os testes usam. */
function isGameRunning() {
  return jogoAberto().then((n) => !!n);
}

// ------------------------------------------------------------ bandeja
/*
 * O icone na area de notificacao e o UNICO sinal de que a aplicacao esta
 * aberta.
 *
 * A regra pedida: automaticamente, a aplicacao so abre quando um jogo
 * escolhido comeca, e abre em silencio -- sem janela e sem navegador, que
 * roubariam o foco de quem acabou de entrar no jogo. Pelo atalho da area de
 * trabalho ela abre quando a pessoa quiser.
 *
 * O servico em si continua subindo no logon e servindo a pagina; isso nao e a
 * aplicacao "aberta", e o que mantem o link do celular funcionando e o save
 * sendo lido. O que aparece e some e a chama na bandeja.
 */
let bandeja = null;

function abrirBandeja(motivo) {
  if (bandeja && !bandeja.killed) return;
  if (process.platform !== 'win32') return;
  /*
   * Instalado, o icone e o proprio Trackeroao.exe (/bandeja): o Windows lista
   * o icone com o nome e o desenho do Trackeroao. Num clone, sem a janela,
   * vale o bandeja.ps1, que o Windows lista como PowerShell.
   */
  const exe = path.join(__dirname, '..', 'app', 'Trackeroao.exe');
  const script = path.join(__dirname, 'bandeja.ps1');
  const comExe = fs.existsSync(exe);
  if (!comExe && !fs.existsSync(script)) return;
  try {
    bandeja = comExe
      ? require('child_process').spawn(exe, ['/bandeja', '/porta=' + PORT, '/pai=' + process.pid],
        { windowsHide: false, detached: false, stdio: 'ignore' })
      : require('child_process').spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', script, '-Porta', String(PORT), '-ProcessoPai', String(process.pid),
      ], { windowsHide: true, detached: false, stdio: 'ignore' });
    bandeja.on('exit', () => { bandeja = null; });
    console.log('  [bandeja] icone aceso (' + motivo + ')');
  } catch (e) {
    console.log('  [bandeja] nao consegui acender: ' + e.message);
  }
}

function fecharBandeja() {
  if (!bandeja || bandeja.killed) return;
  try { bandeja.kill(); } catch (e) { /* ja morreu */ }
  bandeja = null;
  console.log('  [bandeja] icone apagado');
}

// A troca da janela pela atualizacao precisa do .exe livre, e o icone da
// bandeja e o mesmo .exe: ele sai durante a troca e volta se estava aceso.
atualizar.aoTrocarJanela(async (trocar) => {
  const acesa = !!(bandeja && !bandeja.killed);
  fecharBandeja();
  if (acesa) await new Promise((r) => setTimeout(r, 1500));
  try { return await trocar(); } finally { if (acesa) abrirBandeja('depois da troca da janela'); }
});

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
  console.log('      powershell -ExecutionPolicy Bypass -File windows\\reativar.ps1');
  console.log('');
  process.exit(0);
}

/*
 * Não há mais site público: o progresso só se vê pela janela do Trackeroao,
 * no próprio computador, e pelos aplicativos do celular na rede de casa.
 * Nada daqui sai para a internet.
 */

function syncNow(reason) {
  let progress;
  try {
    const file = sl2.findSavePath();
    if (!file) {
      progress = {
        generatedAt: new Date().toISOString(),
        ok: false,
        error: 'no-save-found',
        message: sl2.MENSAGEM_SEM_SAVE,
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
 * URL uma vez só no boot. Aqui ficamos de olho: quando um endereço aparece
 * (ou muda, por DHCP), o mDNS reanuncia e o log registra.
 */
let ultimoIp = null;

/**
 * `obterUrl` existe para poder testar as transições sem depender da placa de
 * rede real; em produção é sempre serve.lanUrl.
 */
function vigiarRede(obterUrl, intervalo, aoMudar) {
  const fonte = obterUrl || (() => serve.lanUrl(PORT));
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
  let qual = null;
  try {
    qual = await jogoAberto();
  } catch (e) {
    qual = null;
  }
  const running = !!qual;

  if (running !== gameWasRunning) {
    gameWasRunning = running;
    if (running) {
      const g = jogos.porProcesso(qual);
      const nome = g ? g.nome : qual;
      if (g) jogos.marcarAberto(g.chave);
      console.log('\n  >> ' + nome + ' aberto - sincronização ativa');
      // A aplicacao acende aqui, e so aqui: e o momento que o pedido descreve.
      abrirBandeja(nome);
      startWatching();
      syncNow('jogo aberto');
    } else {
      console.log('\n  >> jogo fechado - só o poll leve continua rodando');
      stopWatching();
      /*
       * Uma ultima leitura antes de apagar, e o icone so sai depois dela: a
       * sessao que acabou e justamente a que interessa ver, e apagar antes
       * faria a aplicacao sumir no instante em que tem mais o que mostrar.
       */
      syncNow('jogo fechado');
      fecharBandeja();
      // A atualização que esperou o jogo fechar roda já na próxima folga.
      conferirLogo();
    }
  }
}

/* ------------------------------------------------------- atualização */

// Primeira conferência pouco depois de subir: no logon a rede costuma chegar
// segundos depois do serviço, e perguntar antes disso só produziria um erro.
const ATUALIZAR_PRIMEIRA_MS = 20 * 1000;
// Uma versão publicada chega em poucos minutos: a release só sai depois que a
// instalação completa passou num Windows limpo, e /releases/latest nunca
// aponta para rascunho ou pré-lançamento. Doze consultas por hora cabem na
// cota anônima da API, e a página de releases cobre quando ela acaba.
const ATUALIZAR_MS = 5 * 60 * 1000;
const ATUALIZAR_ERRO_MS = 5 * 60 * 1000;
let proximaAtualizacao = Date.now() + ATUALIZAR_PRIMEIRA_MS;
// Pedida à mão, pelo menu da bandeja: roda na próxima folga entre rodadas,
// mesmo com o jogo aberto, porque foi a pessoa quem pediu.
let atualizacaoForcada = false;
function pedirAtualizacao() { atualizacaoForcada = true; proximaAtualizacao = 0; }
// Abrir a janela antecipa a conferência para a próxima folga, pela regra de
// sempre (com jogo aberto, espera): quem abre o Trackeroao vê a versão nova.
function conferirLogo() { proximaAtualizacao = Math.min(proximaAtualizacao, Date.now()); }

/**
 * Mantém a instalação atual sem que isso chegue a quem usa.
 *
 * O pedido é que a atualização não interfira em nada: sem mensagem, sem
 * janela, sem navegador, e sem competir com o trabalho da aplicação. Por isso
 * ela não tem relógio próprio. Ela roda DENTRO do ciclo de verificação, no
 * intervalo entre uma volta e a seguinte, e a volta seguinte espera ela
 * terminar -- a verificação atrasa um pouco naquela vez, e nada acontece ao
 * mesmo tempo que ela. Tudo que ela tem a dizer vai só para o log.
 *
 * Com um jogo aberto ela nem começa. Reiniciar o serviço no meio de uma sessão
 * apagaria e reacenderia a chama na bandeja, que é justamente o tipo de coisa
 * que se vê -- e a leitura daquela sessão passaria por dois processos.
 */
async function passoDeAtualizacao() {
  if (gameWasRunning && !atualizacaoForcada) return;
  if (Date.now() < proximaAtualizacao) return;
  if (atualizacaoForcada) console.log('  [atualizacao] pedida pela bandeja');
  atualizacaoForcada = false;
  const r = await atualizar.verificar();
  if (r.atualizou) {
    console.log(`  [atualizacao] ${r.de || 'versão anterior'} -> ${r.para}; reiniciando em silêncio`);
    reiniciar();
    return;
  }
  if (r.erro) console.log('  [atualizacao] não conferiu: ' + r.erro);
  else if (r.motivo) console.log('  [atualizacao] ' + r.motivo);
  proximaAtualizacao = Date.now() + (r.erro ? ATUALIZAR_ERRO_MS : ATUALIZAR_MS);
}

/*
 * A varredura de jogos (biblioteca.js), pela mesma regra da atualização: entre
 * duas rodadas, nunca com jogo aberto, e sem nada na tela. Ela lista pastas de
 * vários discos e lê o registro, então roda na partida e depois uma vez por
 * dia -- ou antes, quando a página pede uma nova.
 */
const VARRER_PRIMEIRA_MS = 45 * 1000;
const VARRER_MS = 24 * 60 * 60 * 1000;
let proximaVarredura = Date.now() + VARRER_PRIMEIRA_MS;
function pedirVarredura() { proximaVarredura = 0; }

async function passoDeVarredura() {
  if (gameWasRunning || Date.now() < proximaVarredura) return;
  proximaVarredura = Date.now() + VARRER_MS;
  try {
    const r = await require('./biblioteca').varrer();
    console.log(`  [jogos] ${r.jogos.length} jogo(s) encontrados${r.comSteam ? '' : ', sem Steam'}`);
  } catch (e) {
    console.log('  [jogos] a varredura falhou: ' + e.message);
  }
}

/**
 * Troca este processo por um novo, já com o código atualizado.
 *
 * O filho nasce desligado deste e sem janela, e sabe por variável de ambiente
 * que é um reinício: se a porta ainda estiver presa a este processo quando ele
 * subir, ele insiste por alguns instantes em vez de desistir. A página aberta
 * num celular fica sem resposta por menos de um ciclo dela, e segue.
 */
function reiniciar() {
  fecharBandeja();
  const filho = require('child_process').spawn(process.execPath, process.argv.slice(1), {
    cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
    env: Object.assign({}, process.env, { TRACKEROAO_REINICIO: '1' }),
  });
  filho.unref();
  process.exit(0);
}

/*
 * Fechado pela bandeja: enquanto este arquivo existir, o serviço não sobe
 * sozinho -- nem pela tarefa do logon, nem por nada. Quem o apaga é a abertura
 * manual (a janela do Trackeroao, ou o abrir.vbs num clone).
 */
const FECHADO = path.join(__dirname, 'fechado.flag');

function encerrarDeVez() {
  try { fs.writeFileSync(FECHADO, new Date().toISOString()); } catch (e) { /* sai mesmo assim */ }
  console.log('  [fechar] fechado pela bandeja; só volta aberto à mão');
  process.exit(0);
}

async function run() {
  if (fs.existsSync(FECHADO)) process.exit(0);
  const reinicio = !!process.env.TRACKEROAO_REINICIO;
  delete process.env.TRACKEROAO_REINICIO;
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
    // Depois de uma atualização, o processo anterior pode ainda estar soltando
    // a porta. Só nesse caso vale insistir; fora dele, porta ocupada é outro
    // programa, e insistir só adiaria a mensagem de erro.
    for (let tentativa = 1; ; tentativa++) {
      try {
        await serve.start({
          root: ROOT, port: PORT, indexFile: 'trackeroao.html', quiet: true,
          aoAbrir: () => { abrirBandeja('atalho'); conferirLogo(); },
          aoVarrer: () => pedirVarredura(),
          aoAtualizar: () => pedirAtualizacao(),
          aoEncerrar: () => encerrarDeVez(),
        });
        break;
      } catch (e) {
        if (!reinicio || e.code !== 'EADDRINUSE' || tentativa >= 20) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
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
  const extra = await serve.listenExtra({ root: ROOT, port: 80, indexFile: 'trackeroao.html' });
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
    console.log('  No celular, no mesmo Wi-Fi:');
    console.log(`      http://trackeroao.local${porta}`);
    console.log('');
  }

  vigiarRede(null, null, (novo) => nomeador.ipMudou(novo));
  vigiarInstalacao(hibernarAgora);

  /*
   * O ciclo se reagenda no fim de cada volta, em vez de um setInterval: é o
   * que deixa a atualização caber entre duas voltas. A próxima só é marcada
   * depois que a anterior -- e a atualização, quando houver -- terminou.
   */
  let timer = null;
  const ciclo = async () => {
    try {
      await pollOnce();
      await passoDeAtualizacao();
      await passoDeVarredura();
    } catch (e) {
      console.error('  [erro] no ciclo:', e && e.message ? e.message : e);
    }
    timer = setTimeout(ciclo, POLL_MS);
  };
  await ciclo();

  const shutdown = () => {
    clearTimeout(timer);
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

module.exports = { isGameRunning, jogoAberto, alvos, learnActiveSlot, syncNow, vigiarRede, vigiarInstalacao };
