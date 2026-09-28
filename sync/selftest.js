'use strict';
/*
 * selftest.js - prove the pieces work on THIS machine before trusting them.
 *
 * Run: npm run selftest
 *
 * Checks, in order of how badly a failure would hurt:
 *   1. QR encoder round-trips (structural checks + known-answer test)
 *   2. The save file is found, is a BND4, and every block's MD5 matches
 *   3. The item table is located and the essentials parse to sane values
 */

const fs = require('fs');
const path = require('path');

const RAIZ_PROJETO = path.join(__dirname, '..');
const sl2 = require('./sl2');
const inventory = require('./inventory');
const parse = require('./parse');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    const detail = fn();
    pass++;
    console.log(`   ok    ${name}${detail ? '  -  ' + detail : ''}`);
  } catch (err) {
    if (err && err.pular) {
      console.log(`   --    ${name}  -  ${err.message}`);
      return;
    }
    fail++;
    failures.push(name);
    console.log(`   FALHA ${name}\n            ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Sai do teste sem reprovar, porque falta algo que só existe depois de rodar.
 *
 * Um clone recém-feito não tem `progress.json`: ele nasce da primeira leitura
 * do save, nesta máquina. Os testes que dependem dele não têm o que verificar
 * ali, e reprovar faria um clone saudável parecer quebrado — exatamente a
 * dúvida que o projeto precisa não deixar no ar. Então eles se anunciam como
 * pulados, com o motivo, em vez de falhar calados ou passar em falso.
 */
function pular(motivo) {
  const e = new Error(motivo);
  e.pular = true;
  throw e;
}

/** A leitura local do save, ou um pulo explicando que ela ainda não existe. */
function temProgresso() { return fs.existsSync(path.join(RAIZ_PROJETO, 'progress.json')); }

function progressoLocal() {
  const arq = path.join(RAIZ_PROJETO, 'progress.json');
  if (!fs.existsSync(arq)) {
    pular('sem leitura local ainda; rode `npm start` uma vez com o jogo instalado');
  }
  return JSON.parse(fs.readFileSync(arq, 'utf8'));
}


console.log('\n  === 2. Arquivo de save ===');

let save = null;
let saveFile = null;

check('acha o S0000.sl2', () => {
  saveFile = sl2.findSavePath();
  assert(saveFile, 'nenhum save encontrado (o jogo já rodou nesta máquina?)');
  return saveFile;
});

check('lê como BND4 e confere o MD5 de todos os blocos', () => {
  assert(saveFile, 'sem save, pulando');
  save = sl2.readSave(saveFile);
  assert(save.entries.length === 12, `esperava 12 entradas, vieram ${save.entries.length}`);
  for (const e of save.entries) {
    const { ok } = sl2.blockChecksums(save.buf, e);
    assert(ok, `MD5 não bate em ${e.name}`);
  }
  return `${save.entries.length} blocos, todos íntegros`;
});

check('identifica os slots com dados', () => {
  assert(save, 'sem save, pulando');
  const used = sl2.nonEmptySlots(save);
  assert(used.length > 0, 'nenhum slot com dados');
  return `slots ${used.map((e) => e.index).join(', ')}`;
});

console.log('\n  === 3. Leitura do progresso ===');

check('localiza a tabela de itens pela estrutura', () => {
  assert(save, 'sem save, pulando');
  const used = sl2.nonEmptySlots(save);
  const payload = sl2.blockPayload(save.buf, used[used.length - 1]);
  const region = inventory.detectItemTable(payload);
  assert(region, 'tabela de itens não encontrada');
  return `0x${region.start.toString(16)}..0x${region.end.toString(16)}`;
});

check('monta o progress.json', () => {
  const p = parse.buildProgress({});
  assert(p.ok, `parse falhou: ${p.message || p.error}`);
  const e = p.essentials;
  assert(e.prayerBeads.held >= 0 && e.prayerBeads.held <= 40, 'contas fora de faixa');
  assert(
    e.prayerBeads.necklaces >= 0 && e.prayerBeads.necklaces <= e.prayerBeads.totalNecklaces,
    'colares fora de faixa'
  );
  assert(e.materials.length === 9, `esperava 9 materiais, vieram ${e.materials.length}`);
  assert(p.bosses.length > 0, 'nenhum chefe na lista');
  return `slot ${p.source.slot}, ${e.prayerBeads.collected} contas, ${p.bosses.filter((b) => b.defeated).length} chefes`;
});

check('materiais de tier tardio não aparecem antes dos iniciais', () => {
  // A sanity check on the id->name mapping: if it were shuffled, an endgame
  // material would show up while the early ones are still at zero.
  const p = parse.buildProgress({});
  assert(p.ok, 'parse falhou');
  const by = {};
  for (const m of p.essentials.materials) by[m.key] = m.qty;
  const early = by.scrapIron + by.scrapMagnetite + by.blackGunpowder + by.yellowGunpowder;
  const late = by.lapisLazuli + by.adamantiteScrap + by.fulminatedMercury;
  if (late > 0 && early === 0) {
    throw new Error('materiais tardios sem nenhum material inicial - mapeamento suspeito');
  }
  return `iniciais=${early}, tardios=${late}`;
});

console.log('\n  === 4. O progresso não pode ser perdido ===');

check('uma leitura falha não apaga o progresso já conhecido', () => {
  // O save pode sumir por motivos banais (Steam Cloud mexendo no arquivo, o
  // serviço subindo antes do perfil montar). Como a página não tem entrada
  // manual, sobrescrever com um erro deixaria o usuário sem nada.
  const tmp = path.join(require('os').tmpdir(), 'sekiro-preserve-test.json');
  const bom = {
    ok: true,
    generatedAt: '2026-01-01T00:00:00.000Z',
    essentials: { prayerBeads: { collected: 18 } },
    bosses: [{ key: 'gyoubu', defeated: true }],
  };
  fs.writeFileSync(tmp, JSON.stringify(bom));
  try {
    const falha = { ok: false, error: 'no-save-found', message: 'sumiu' };
    const r = parse.preserveGood(tmp, falha);
    assert(r.ok === true, 'o resultado bom foi descartado');
    assert(r.essentials.prayerBeads.collected === 18, 'perdeu as contas');
    assert(r.bosses.length === 1, 'perdeu os chefes');
    assert(r.stale && r.stale.error === 'no-save-found', 'não marcou como velho');
    assert(r.stale.leituraDe === bom.generatedAt, 'não registrou a data da leitura boa');

    // Uma leitura boa nova limpa o estado e não carrega o marcador.
    const novo = parse.preserveGood(tmp, { ok: true, generatedAt: 'x', essentials: {} });
    assert(!novo.stale, 'manteve o marcador depois de uma leitura boa');

    // Sem nada bom no disco, não há o que preservar: reporta o erro mesmo.
    fs.writeFileSync(tmp, JSON.stringify({ ok: false, error: 'antigo' }));
    assert(parse.preserveGood(tmp, falha).ok === false, 'inventou um resultado bom');
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* já foi */ }
  }
  return 'preserva, marca como velho e limpa na próxima leitura boa';
});

check('registra o que mudou entre duas leituras', () => {
  const antes = {
    ok: true,
    generatedAt: 'a',
    essentials: {
      prayerBeads: { collected: 18, necklaces: 4 },
      gourdSeeds: { held: 0 },
      materials: [{ key: 'scrapIron', label: 'Scrap Iron', qty: 4 }],
    },
    bosses: [{ key: 'gyoubu', label: 'Gyoubu', defeated: true }, { key: 'ape', label: 'Guardian Ape', defeated: false }],
    miniBosses: [{ key: 'orin', label: "O'Rin", defeated: false }],
    tools: [{ key: 'axe', label: 'Loaded Axe', unlocked: true }],
    arts: [{ key: 'oneMind', label: 'One Mind', unlocked: false }],
    goodsUnlocks: [],
  };
  const depois = JSON.parse(JSON.stringify(antes));
  depois.generatedAt = 'b';
  depois.bosses[1].defeated = true;
  depois.miniBosses[0].defeated = true;
  depois.arts[0].unlocked = true;
  depois.essentials.prayerBeads.collected = 22;
  depois.essentials.materials[0].qty = 2;

  const d = parse.diffProgress(antes, depois);
  const achar = (label) => d.filter((x) => x.label === label)[0];
  assert(d.length === 5, `esperava 5 mudanças, vieram ${d.length}: ${JSON.stringify(d)}`);
  assert(achar('Guardian Ape').tipo === 'boss', 'chefe não classificado');
  assert(achar("O'Rin").tipo === 'mini-boss', 'mini-chefe não classificado');
  assert(achar('One Mind').tipo === 'art', 'arte não classificada');
  assert(achar('Prayer Beads').texto === '18 → 22', 'contador de contas errado');
  assert(achar('Scrap Iron').subiu === false, 'não marcou que o material caiu');
  assert(d.every((x) => x.at === 'b'), 'carimbo de tempo errado');

  // Sem mudança nenhuma, não inventa entrada.
  assert(parse.diffProgress(antes, antes).length === 0, 'inventou mudança onde não houve');
  // Leitura ruim não gera histórico.
  assert(parse.diffProgress(antes, { ok: false }).length === 0, 'gerou histórico de leitura ruim');
  return '5 mudanças: chefe, mini, arte e 2 contadores';
});

console.log('\n  === 5. Descoberta do IP da rede ===');

check('ignora endereços APIPA (169.254.x) ao escolher o IP da LAN', () => {
  // Esta máquina tem quatro adaptadores com 169.254.x (Bluetooth, Ethernet,
  // Wi-Fi Direct). Entre o logon e o Wi-Fi associar, eles são os únicos que
  // existem — e anunciar um deles daria um endereço morto no QR.
  const serve = require('./serve');
  assert(serve.isApipa('169.254.232.5'), 'não reconheceu APIPA');
  assert(!serve.isApipa('192.168.1.10'), 'classificou IP da LAN como APIPA');
  const addrs = serve.localAddresses();
  const vazou = addrs.filter((a) => a.address.startsWith('169.254.'));
  assert(vazou.length === 0, 'APIPA vazou: ' + JSON.stringify(vazou));
  if (addrs.length) assert(addrs[0].private, 'o primeiro endereço não é privado');
  return addrs.length ? addrs.map((a) => a.address).join(', ') : 'sem rede agora';
});

check('anuncia quando a rede aparece depois do boot', () => {
  // O serviço sobe segundos após o logon, antes de o Wi-Fi associar. Este é o
  // caso que quebrou de verdade num reboot: sem IP no arranque, o serviço
  // dizia que não havia rede e nunca mais reavaliava.
  const main = require('./main');
  const linhas = [];
  const original = console.log;
  console.log = (...a) => linhas.push(a.join(' '));

  let url = null;
  let v;
  try {
    v = main.vigiarRede(() => url, 3600000); // intervalo longo: chamamos à mão
    url = 'http://192.168.1.50:8777/trackeroao.html';
    v.checar();
    url = 'http://192.168.1.77:8777/trackeroao.html';
    v.checar();
    url = null;
    v.checar();
  } finally {
    console.log = original;
    if (v && v.timer) clearInterval(v.timer);
  }

  const texto = linhas.join('\n');
  assert(/sem IP de rede local/.test(texto), 'não avisou que começou sem IP');
  assert(/disponível na rede: http:\/\/192\.168\.1\.50/.test(texto), 'não anunciou o IP quando apareceu');
  assert(/o IP mudou de 192\.168\.1\.50 para 192\.168\.1\.77/.test(texto), 'não detectou a troca de IP');
  return 'sem rede -> aparece -> muda -> some';
});

/*
 * 7. Leitura da memória do jogo.
 *
 * O contador de mortes deixou de sair do save. O save não guarda essa conta —
 * a busca antiga rodou, eliminou todos os candidatos e provou isso —, então
 * agora quem conta é o próprio jogo, lido da memória do processo.
 *
 * O que se testa aqui é o que dá para testar sem o jogo aberto: que o pedido é
 * montado direito, que a recusa é limpa quando o processo não existe, e que o
 * handle é pedido SOMENTE PARA LEITURA. Esse último é o que mais importa: o
 * projeto inteiro se apoia em nunca escrever no jogo nem no save.
 *
 * Com o jogo aberto, o teste vai além e resolve os ponteiros de verdade.
 */
console.log('\n  === 7. Leitura da memória do jogo ===');

const memoria = require('./memoria');
const deathsmem = require('./deathsmem');
const tempo = require('./tempo');

check('o handle é pedido somente para leitura', () => {
  // Sem os comentários: o cabeçalho do arquivo explica que não há escrita, e
  // medir a prosa em vez do código daria falso positivo justo na checagem que
  // mais importa.
  const bruto = fs.readFileSync(path.join(__dirname, 'mem.ps1'), 'utf8');
  const codigo = bruto
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // A primeira ocorrência é a declaração do P/Invoke, que não tem constante
  // nenhuma. A que interessa é a chamada.
  const todas = [...codigo.matchAll(/OpenProcess\(([^)]*)\)/g)];
  const chamada = todas.find((m) => /PROCESS_/.test(m[1]));
  assert(chamada, 'não achei a chamada de OpenProcess com constantes');
  assert(/PROCESS_VM_READ/.test(chamada[1]), 'não pede leitura');
  assert(/PROCESS_QUERY_INFORMATION/.test(chamada[1]), 'não pede consulta');
  assert(!/WRITE|OPERATION|ALL_ACCESS/.test(chamada[1]), 'pede mais que leitura: ' + chamada[1]);
  assert(!/WriteProcessMemory|VirtualProtectEx|CreateRemoteThread/.test(codigo),
    'importa função que escreve no processo');
  return 'OpenProcess(' + chamada[1].trim() + ')';
});

check('os padrões de busca são os documentados, com curinga', () => {
  const nomes = Object.keys(memoria.PADROES);
  assert(nomes.length >= 3, `só ${nomes.length} padrões`);
  for (const [n, p] of Object.entries(memoria.PADROES)) {
    assert(/^[0-9a-fA-F? ]+$/.test(p.padrao), `${n}: padrão com caractere estranho`);
    assert(p.padrao.includes('?'), `${n}: sem curinga, quebraria a cada versão do jogo`);
    assert(typeof p.desloc === 'number' && typeof p.instrucao === 'number', `${n}: sem deslocamento`);
  }
  return nomes.join(', ');
});

const jogoAberto = memoria.conectar();

check('diz claramente quando o jogo está fechado', () => {
  if (jogoAberto.ok) return 'jogo aberto agora; caminho de recusa exercitado por processo inexistente';
  assert(jogoAberto.erro, 'falhou sem dizer o motivo');
  return jogoAberto.erro;
});

check('processo inexistente não derruba nada', () => {
  const r = memoria.executar([], { processo: 'processo-que-nao-existe-xyz' });
  assert(r.ok === false, 'disse que conseguiu abrir um processo inexistente');
  assert(typeof r.erro === 'string' && r.erro.length > 0, 'não explicou');
  return r.erro;
});

if (jogoAberto.ok) {
  check('acha o módulo do jogo', () => {
    assert(jogoAberto.base > 0, 'base zerada');
    assert(jogoAberto.tamanho > 1024 * 1024, 'módulo pequeno demais para ser o jogo');
    return `pid ${jogoAberto.pid}, base 0x${jogoAberto.base.toString(16)}, ` +
      `${(jogoAberto.tamanho / 1048576).toFixed(1)} MB`;
  });

  check('resolve os ponteiros por varredura de padrão', () => {
    const r = memoria.resolverPonteiros();
    assert(r.ok, r.erro || 'falhou');
    const achados = Object.entries(r.res || {}).filter(([, v]) => v && v.alvo);
    assert(achados.length >= 2, `só ${achados.length} ponteiros resolvidos`);
    for (const [n, v] of achados) {
      assert(v.alvo > jogoAberto.base && v.alvo < jogoAberto.base + jogoAberto.tamanho,
        `${n} resolveu para fora do módulo`);
    }
    return achados.map(([n, v]) => n + '@0x' + v.alvo.toString(16)).join('  ');
  });

  check('lê bytes do processo', () => {
    const b = memoria.ler(jogoAberto.base, 64);
    assert(b && b.length === 64, 'não leu');
    // Todo PE começa com "MZ": se não vier isso, não é o módulo do jogo.
    assert(b[0] === 0x4d && b[1] === 0x5a, 'o início do módulo não é um PE');
    return 'cabeçalho MZ conferido na base do módulo';
  });
} else {
  console.log('   --    (jogo fechado: os testes contra o processo vivo ficam de fora)');
}

check('a contagem por memória se cala quando não tem o que ler', () => {
  // A premissa antiga era "calibrado, logo tem número", e ela quebrou no
  // primeiro dia em que o jogo estava fechado na hora do teste. Calibração é
  // sobre saber ONDE ler; ter o que ler depende do jogo estar aberto. São
  // duas condições, e confundi-las fazia um estado perfeitamente normal
  // aparecer como defeito.
  const e = deathsmem.estado();
  const c = deathsmem.contagem();
  const aberto = memoria.conectar().ok;

  if (!aberto) {
    assert(c === null, 'devolveu número com o jogo fechado');
    return 'jogo fechado: devolve null em vez de repetir a última leitura';
  }
  if (e.calibrado || c) {
    assert(c && typeof c.mortes === 'number', 'jogo aberto e calibrado, mas sem número');
    return `${c.mortes} mortes, escopo "${c.escopo}"`;
  }
  assert(c === null, 'devolveu número sem estar calibrado');
  return 'sem offset ainda, devolve null em vez de inventar';
});

check('a contagem é da jornada inteira, não da sessão', () => {
  const j = deathsmem.daJornada();
  if (!j) return 'jogo fechado ou no menu principal; nada a ler';
  // O ponto do teste é a distinção. Um contador da região estática do módulo
  // zera quando o jogo abre, e mediria só a noite de hoje; este vem da struct
  // que o save carrega. Se a página voltar a mostrar o de sessão, isto falha.
  assert(j.escopo === 'jornada', 'escopo "' + j.escopo + '"');
  const p = parse.buildProgress({});
  assert(p.deaths.escopo === 'jornada',
    'a página está publicando escopo "' + p.deaths.escopo + '"');
  assert(p.deaths.count === j.mortes,
    'página diz ' + p.deaths.count + ', a struct diz ' + j.mortes);
  // A conferência que provou a struct: o tempo de jogo interno é campo dela, e
  // tem de ser plausível contra as horas de relógio da Steam — menor, porque
  // não conta menu nem carregamento, e não muito menor.
  const t = tempo.tempoDeJogo();
  if (t && j.igtHoras) {
    assert(j.igtHoras < t.horas, `IGT ${j.igtHoras.toFixed(1)}h não pode passar do relógio ${t.horas}h`);
    assert(j.igtHoras > t.horas * 0.3, `IGT ${j.igtHoras.toFixed(1)}h baixo demais para ${t.horas}h de relógio`);
    return `${j.mortes} mortes, IGT ${j.igtHoras.toFixed(1)}h contra ${t.horas}h de relógio`;
  }
  return `${j.mortes} mortes na jornada`;
});

/*
 * Os efeitos de sessão, contra um relógio controlado.
 *
 * Testar isto esperando acontecer levaria seis horas e dependeria de morrer no
 * jogo. `atualizar` recebe o instante como argumento justamente para que o
 * teste possa viajar no tempo — e é a única razão de esse argumento existir.
 */
check('os efeitos acendem no limiar e vencem em seis horas', () => {
  const efeitos = require('./efeitos');
  const guardado = fs.existsSync(efeitos.ESTADO) ? fs.readFileSync(efeitos.ESTADO) : null;
  try {
    fs.rmSync(efeitos.ESTADO, { force: true });
    const H = 3600000;
    let t = Date.parse('2026-01-01T00:00:00Z');
    const passo = (o, dt) => efeitos.atualizar(o, (t += (dt || 0)));

    let r = passo({ pid: 1, mortesNaSessao: 0, conquistas: 19 });
    assert(!r.podridao && !r.fogo, 'acendeu sem gatilho nenhum');

    r = passo({ pid: 1, mortesNaSessao: 4, conquistas: 19 }, 60000);
    assert(!r.podridao, 'podridão acendeu com 4 mortes, e o limiar é 5');

    r = passo({ pid: 1, mortesNaSessao: 5, conquistas: 19 }, 60000);
    assert(r.podridao > 0, 'não acendeu com 5 mortes na sessão');
    assert(Math.abs(r.podridao - 6 * 3600) < 5, 'não durou seis horas: ' + r.podridao + 's');

    r = passo({ pid: 1, mortesNaSessao: 5, conquistas: 20 }, 60000);
    assert(!r.fogo, 'fogo acendeu com uma conquista só, e o limiar é 2');

    r = passo({ pid: 1, mortesNaSessao: 5, conquistas: 21 }, 60000);
    assert(r.fogo > 0, 'não acendeu com duas conquistas na sessão');

    // Fechar o jogo não apaga o que já acendeu: o pedido é "por seis horas
    // depois", e depois inclui o jogo fechado.
    r = passo({ pid: null }, H);
    assert(r.podridao > 0 && r.fogo > 0, 'fechar o jogo apagou os efeitos');
    r = passo({ pid: null }, 5 * H);
    assert(!r.podridao && !r.fogo, 'ainda aceso depois de seis horas');

    // Sessão nova não reacende pelo acumulado: 21 conquistas continuam 21.
    r = passo({ pid: 2, mortesNaSessao: 0, conquistas: 21 }, 60000);
    assert(!r.fogo, 'sessão nova acendeu o fogo pelo total, não pelo ganho');
    return 'limiar 5/2, duração 6 h, sobrevive ao jogo fechar, não reacende sozinho';
  } finally {
    fs.rmSync(efeitos.ESTADO, { force: true });
    if (guardado) fs.writeFileSync(efeitos.ESTADO, guardado);
  }
});

check('o que é publicado é o tempo que falta, não a hora de início', () => {
  // Hora de início diria quando a pessoa estava jogando, que é exatamente o
  // que o site público não mostra. Segundos restantes dizem só que está aceso.
  const efeitos = require('./efeitos');
  const guardado = fs.existsSync(efeitos.ESTADO) ? fs.readFileSync(efeitos.ESTADO) : null;
  try {
    fs.rmSync(efeitos.ESTADO, { force: true });
    const t = Date.parse('2026-01-01T00:00:00Z');
    efeitos.atualizar({ pid: 1, mortesNaSessao: 0, conquistas: 19 }, t);
    const r = efeitos.atualizar({ pid: 1, mortesNaSessao: 5, conquistas: 19 }, t + 1000);
    for (const v of Object.values(r)) {
      assert(typeof v === 'number', 'efeito publicado como ' + typeof v + ', não número');
    }
    const texto = JSON.stringify(require('./publish').sanitizar({ efeitos: r }));
    assert(!/\d{4}-\d{2}-\d{2}T/.test(texto), 'saiu um carimbo de data no que vai para o ar');
    return 'só segundos restantes: ' + JSON.stringify(r);
  } finally {
    fs.rmSync(efeitos.ESTADO, { force: true });
    if (guardado) fs.writeFileSync(efeitos.ESTADO, guardado);
  }
});

check('fechar o jogo não derruba a contagem', () => {
  // É o estado em que o link público passa a maior parte do tempo, e era onde
  // estava errado: sem a última leitura guardada, a página caía para a
  // estimativa do save e mostrava 6 onde são 221. Morte não desaparece porque
  // o jogo saiu da memória.
  const guardada = deathsmem.ultimaConhecida();
  if (!guardada) return 'ainda não houve leitura boa para guardar';
  const p = parse.buildProgress({});
  const aberto = memoria.conectar().ok;
  assert(p.deaths.count >= guardada.mortes,
    `a página diz ${p.deaths.count} e a última leitura boa foi ${guardada.mortes}`);
  assert(p.deaths.how === 'memoria',
    'com leitura guardada a via deveria ser "memoria", e é "' + p.deaths.how + '"');
  if (!aberto) {
    assert(p.deaths.aoVivo === false, 'jogo fechado, mas a página diz que é ao vivo');
    return `jogo fechado: mantém ${p.deaths.count}, marcado como não ao vivo`;
  }
  return `jogo aberto: ${p.deaths.count} ao vivo, ${guardada.mortes} guardadas`;
});

check('a contagem de sessão continua existindo como reserva', () => {
  const s = deathsmem.daSessao();
  const j = deathsmem.daJornada();
  if (!s) return 'sem offset de sessão calibrado';
  assert(s.escopo === 'sessao', 'escopo "' + s.escopo + '"');
  if (j) {
    assert(s.mortes <= j.mortes,
      'a sessão (' + s.mortes + ') não pode passar da jornada (' + j.mortes + ')');
    return `sessão ${s.mortes} dentro da jornada ${j.mortes}`;
  }
  return `sessão ${s.mortes}`;
});

check('calibrado e com o jogo aberto, quem manda é a memória', () => {
  const e = deathsmem.estado();
  const c = deathsmem.contagem();
  if (!e.calibrado) return 'ainda sem offset; nada a comparar';
  if (!c) return 'calibrado, mas o jogo está fechado agora';
  const p = parse.buildProgress({});
  // Este teste nasce de um defeito que não falhava: a leitura da memória
  // funcionava e devolvia o número certo, mas a linha que montava a resposta
  // usava `confidence: high` sem aspas. O ReferenceError caía no catch em
  // volta, e a página mostrava a contagem do save como se a calibração nunca
  // tivesse ocorrido. Comparar a via, e não só o número, é o que pega isso.
  assert(p.deaths.how === 'memoria',
    'a via é "' + p.deaths.how + '" com o contador calibrado e o jogo aberto');
  assert(p.deaths.count === c.mortes,
    'a página diz ' + p.deaths.count + ' e a memória diz ' + c.mortes);
  assert(p.deaths.confidence === 'high', 'confiança "' + p.deaths.confidence + '", esperada "high"');
  // O offset calibrado é o da sessão; a contagem que chega à página vem da
  // struct da jornada. Dizer o offset aqui sugeriria que ele produziu o número.
  return `${c.mortes} mortes, escopo "${c.escopo}"`;
});

check('o save é a reserva enquanto a memória não fecha', () => {
  const p = parse.buildProgress({});
  assert(p.deaths, 'sem contagem nenhuma');
  const vias = ['memoria', 'counted', 'learning'];
  assert(vias.includes(p.deaths.how), `via desconhecida: ${p.deaths.how}`);
  return `via "${p.deaths.how}"` + (p.deaths.count !== null ? `, ${p.deaths.count} mortes` : '');
});


/*
 * 8. O nome na rede local.
 *
 * O respondedor mDNS fala protocolo binário: um byte fora do lugar e o
 * aparelho simplesmente ignora, sem erro nenhum para aparecer em log. Então o
 * teste monta uma pergunta de verdade, passa pelo mesmo leitor que o socket
 * usa, e confere a resposta byte a byte.
 */
console.log('\n  === 8. Nome na rede local (mDNS) ===');

const mdns = require('./mdns');

/** Monta uma pergunta mDNS como um iPhone mandaria. */
function pergunta(nome, tipo, unicast) {
  const cab = Buffer.alloc(12);
  cab.writeUInt16BE(0, 0);
  cab.writeUInt16BE(0, 2);       // QR=0: é pergunta
  cab.writeUInt16BE(1, 4);       // uma pergunta
  const q = Buffer.alloc(4);
  q.writeUInt16BE(tipo === undefined ? 1 : tipo, 0);
  q.writeUInt16BE(unicast ? 0x8001 : 1, 2);
  return Buffer.concat([cab, mdns.codificarNome(nome), q]);
}

check('lê uma pergunta de nome como o aparelho manda', () => {
  const p = mdns.lerPerguntas(pergunta('sekiro.local'));
  assert(p.length === 1, `esperava 1 pergunta, vieram ${p.length}`);
  assert(p[0].nome === 'sekiro.local', `leu "${p[0].nome}"`);
  assert(p[0].tipo === 1, `tipo ${p[0].tipo}`);
  return 'sekiro.local, tipo A';
});

check('entende o pedido de resposta direta (bit QU)', () => {
  const p = mdns.lerPerguntas(pergunta('sekiro.local', 1, true));
  assert(p[0].unicast === true, 'não marcou unicast');
  const p2 = mdns.lerPerguntas(pergunta('sekiro.local', 1, false));
  assert(p2[0].unicast === false, 'marcou unicast onde não havia');
  return 'unicast e multicast distinguidos';
});

check('ignora resposta de outro programa em vez de responder a ela', () => {
  const resp = mdns.montarResposta('sekiro.local', '192.168.1.10');
  assert(mdns.lerPerguntas(resp).length === 0, 'tratou uma resposta como pergunta');
  return 'loop de resposta evitado';
});

check('monta a resposta A no formato do protocolo', () => {
  const r = mdns.montarResposta('sekiro.local', '192.168.1.10');
  assert(r.readUInt16BE(2) === 0x8400, `flags 0x${r.readUInt16BE(2).toString(16)}, esperava 0x8400`);
  assert(r.readUInt16BE(4) === 0, 'mandou pergunta junto');
  assert(r.readUInt16BE(6) === 1, 'não mandou exatamente uma resposta');
  const nome = mdns.lerNome(r, 12);
  assert(nome.nome === 'sekiro.local', `nome "${nome.nome}"`);
  const off = nome.proximo;
  assert(r.readUInt16BE(off) === 1, 'tipo não é A');
  assert(r.readUInt16BE(off + 2) === 0x8001, 'faltou o bit de cache-flush');
  assert(r.readUInt16BE(off + 8) === 4, 'RDLENGTH não é 4');
  assert([...r.slice(off + 10)].join('.') === '192.168.1.10', 'o IP saiu errado');
  return 'cabeçalho, nome, tipo, classe e IP conferem';
});

check('nome malformado não derruba o serviço', () => {
  // Ponteiro que aponta para si mesmo: sem trava, laço infinito.
  const mau = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 0x0c])]);
  mau.writeUInt16BE(1, 4);
  const p = mdns.lerPerguntas(mau);
  assert(Array.isArray(p), 'não devolveu lista');
  return 'ponteiro em círculo cortado';
});

check('não responde por nome que não é o dele', () => {
  const p = mdns.lerPerguntas(pergunta('impressora.local'));
  assert(p[0].nome === 'impressora.local', 'leu o nome errado');
  const nossos = ['sekiro.local', 'oaovito.local'];
  assert(!nossos.includes(p[0].nome), 'confundiu com um nome nosso');
  return 'a comparação é por nome exato';
});

/*
 * 9. Hibernação quando o jogo sai da máquina.
 *
 * O risco aqui não é falhar em desligar — é desligar por engano. Um disco
 * externo que não montou dá exatamente a mesma leitura de "não achei o jogo".
 * Então o que se testa é a recusa: a checagem que não vale nada não pode
 * derrubar nada, e nada pode ser desligado antes de a cópia estar feita.
 */
console.log('\n  === 9. Hibernação (jogo desinstalado) ===');

const instalacao = require('./instalacao');
const hibernar = require('./hibernar');

check('detecta o estado real do Sekiro nesta máquina', () => {
  const e = instalacao.estado();
  assert(e.instalado === true, `devolveu ${e.instalado}: ${e.evidencias.join('; ')}`);
  assert(e.checagemValida === true, 'marcou a checagem como inválida');
  return e.evidencias[0];
});

check('"não sei" nunca vira "desinstalado"', () => {
  // É o caso do HD externo desconectado, ou do Steam ausente.
  const e = { instalado: null, checagemValida: false, evidencias: ['simulado'] };
  const agiria = e.instalado === false && e.checagemValida;
  assert(!agiria, 'agiria sobre uma checagem que não vale');
  return 'null e checagemValida=false são ignorados';
});

check('a cópia guarda o progresso e o save, sem apagar nada', () => {
  const tmp = path.join(__dirname, 'hib-test');
  fs.rmSync(tmp, { recursive: true, force: true });
  const falso = path.join(tmp, 'S0000.sl2');
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(falso, Buffer.alloc(2048, 7));

  const r = hibernar.arquivar({ destino: path.join(tmp, 'saida'), saves: [falso], motivo: 'teste' });

  // Num clone que ainda não leu o save não há progresso para guardar, e
  // cobrar isso faria a hibernação parecer quebrada numa máquina limpa.
  if (temProgresso()) {
    const guardouProgresso = r.manifesto.projeto.some((g) => g.arquivo === 'progress.json' && g.bytes > 0);
    assert(guardouProgresso, 'não guardou o progress.json');
  }
  const guardouSave = r.manifesto.save.some((g) => g.bytes === 2048);
  assert(guardouSave, 'não guardou o save');
  assert(fs.existsSync(falso), 'APAGOU o original — hibernar só copia');
  // Só faz sentido conferir que não mexeu no original se ele existe aqui.
  if (temProgresso()) assert(fs.existsSync(path.join(RAIZ_PROJETO, 'progress.json')), 'mexeu no progress.json de verdade');

  const n = r.manifesto.projeto.length + r.manifesto.save.length;
  fs.rmSync(tmp, { recursive: true, force: true });
  return `${n} arquivos copiados, nenhum removido`;
});

check('cada hibernação vai para uma pasta nova', () => {
  const tmp = path.join(__dirname, 'hib-test2');
  fs.rmSync(tmp, { recursive: true, force: true });
  const a = hibernar.arquivar({ destino: tmp, saves: [] });
  const b = hibernar.arquivar({ destino: tmp, saves: [] });
  const pastas = fs.readdirSync(tmp).length;
  fs.rmSync(tmp, { recursive: true, force: true });
  // Duas no mesmo segundo não podem cair na mesma pasta: a segunda apagaria a
  // cópia da primeira, que é exatamente o que hibernar existe para evitar.
  assert(a.destino !== b.destino, 'duas hibernações no mesmo segundo colidiram');
  assert(pastas === 2, `esperava 2 pastas, achei ${pastas}`);
  return '2 pastas distintas, mesmo no mesmo segundo';
});

check('o manifesto diz como voltar', () => {
  const tmp = path.join(__dirname, 'hib-test3');
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = hibernar.arquivar({ destino: tmp, saves: [] });
  assert(/reativar\.ps1/.test(r.manifesto.comoVoltar), 'não aponta o caminho de volta');
  assert(/Nada foi apagado/.test(r.manifesto.observacao), 'não deixa claro que é cópia');
  fs.rmSync(tmp, { recursive: true, force: true });
  return r.manifesto.comoVoltar;
});

check('a cópia da hibernação está fora do git', () => {
  const ig = fs.readFileSync(path.join(RAIZ_PROJETO, '.gitignore'), 'utf8');
  assert(/^arquivo\/$/m.test(ig), 'arquivo/ não está no .gitignore — o save iria junto');
  return 'arquivo/ ignorado: o save tem o Steam ID dentro';
});

check('existe o caminho de volta, e ele não apaga save sozinho', () => {
  const p = path.join(RAIZ_PROJETO, 'reativar.ps1');
  assert(fs.existsSync(p), 'reativar.ps1 não existe');
  const txt = fs.readFileSync(p, 'utf8');
  assert(/install-sync-service\.ps1/.test(txt), 'não religa a tarefa');
  assert(!/Copy-Item[^\n]*S0000/.test(txt), 'restaura save sozinho — sobrescrever save é irreversível');
  return 'religa a tarefa e só indica onde está a cópia do save';
});

/*
 * 10. O site público mostra a página inteira.
 *
 * O progress.json público é montado por lista do que ENTRA, para campo novo
 * nascer privado. O preço disso é real: acrescentar um campo à página e
 * esquecer da lista faz o bloco sumir do site público sem erro nenhum — foi o
 * que aconteceu com o tempo de jogo e com o contador de chefes.
 *
 * Este grupo cruza as duas pontas. Tudo que a página lê de `sync` tem de estar
 * na lista pública, ou estar declarado aqui como excluído de propósito.
 */
console.log('\n  === 10. O público recebe o que a página desenha ===');

const publish = require('./publish');

// Fora de propósito, com o motivo. Qualquer outro ausente é esquecimento.
const EXCLUIDOS = {
  goodsRaw: 'despejo cru do inventário; a página não usa e era metade do arquivo',
  weaponsRaw: 'idem',
  flagCalibration: 'diagnóstico interno da leitura de flags',
};

check('todo campo que a página lê chega na versão pública', () => {
  const src = fs.readFileSync(path.join(RAIZ_PROJETO, 'trackeroao.html'), 'utf8');
  const usados = [...new Set([...src.matchAll(/sync\.([a-zA-Z]+)/g)].map((m) => m[1]))];
  const publicos = new Set(publish.CAMPOS_PUBLICOS.concat(['source']));
  const faltando = usados.filter((u) => !publicos.has(u) && !EXCLUIDOS[u]);
  assert(faltando.length === 0, 'a página lê, mas o público não recebe: ' + faltando.join(', '));
  return usados.length + ' campos lidos, todos cobertos';
});

check('o que ficou de fora ficou por um motivo escrito', () => {
  const local = progressoLocal();
  const limpo = publish.sanitizar(local);
  const fora = Object.keys(local).filter((k) => !(k in limpo));
  const semMotivo = fora.filter((k) => !EXCLUIDOS[k]);
  assert(semMotivo.length === 0, 'sem motivo declarado: ' + semMotivo.join(', '));
  return fora.length + ' fora: ' + fora.join(', ');
});

check('a versão pública segue sem nada de máquina ou conta', () => {
  const local = progressoLocal();
  const v = publish.vazamentos(JSON.stringify(publish.sanitizar(local)));
  assert(v.length === 0, 'vazou: ' + v.join(', '));
  return 'sem caminho, Steam ID, IP ou despejo cru';
});

check('o público não recebe quando a pessoa jogou', () => {
  const local = progressoLocal();
  const limpo = publish.sanitizar(local);
  assert(limpo.playtime && limpo.playtime.horas > 0, 'perdeu as horas junto');
  assert(!limpo.playtime.ultimaVez, 'a data da última partida foi publicada');
  assert(!limpo.source.saveModified,
    'saveModified foi publicado, e ele diz a mesma coisa que a última partida');
  return limpo.playtime.horas.toFixed(1) + ' h publicadas, sem quando';
});

/*
 * A regra acima nomeia dois campos, e foi por isso que um terceiro passou: a
 * leitura de mortes levava um carimbo de hora que, com o jogo fechado, era a
 * ultima vez que ele foi visto aberto -- o last played por outro nome. A pagina
 * nunca leu o campo; ele ia de carona.
 *
 * Entao aqui a regra deixa de ser por nome e passa a ser por forma: nenhuma
 * data em lugar nenhum do arquivo publico, com uma excecao declarada para
 * 'generatedAt', que diz quando o arquivo foi montado e nao quando se jogou (o
 * servico monta em ciclo fixo, jogando ou nao).
 */
check('nenhum carimbo de hora sobra no arquivo publico', () => {
  const HORA = /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/;
  const PERMITIDOS = new Set(['generatedAt']);
  const limpo = publish.sanitizar(progressoLocal());
  const achados = [];
  (function anda(v, caminho) {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (HORA.test(v) && !PERMITIDOS.has(caminho)) achados.push(caminho);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => anda(x, caminho + '[' + i + ']')); return; }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) anda(v[k], caminho ? caminho + '.' + k : k);
    }
  }(limpo, ''));
  assert(achados.length === 0, 'data publicada em: ' + achados.join(', '));
  return 'so generatedAt carrega data, e ela nao diz quando se jogou';
});

/*
 * 11. O repositório se basta.
 *
 * Antes o repositório era só a página montada, com uma cópia do fonte dentro
 * dela: clonar não dava um tracker que roda, e o GitHub media o projeto como
 * "HTML 100%". Agora o repositório É o projeto, e a pasta publicada é uma
 * saída dele. O que se testa aqui é o que essa inversão promete: que quem
 * clonar tenha tudo, que nada seja resolvido para fora da pasta, e que nada do
 * que está aqui identifique a máquina de onde saiu.
 */
console.log('\n  === 11. O repositório se basta ===');

const { execFileSync: exec11 } = require('child_process');
/*
 * A lista de arquivos versionados, ou null quando não há checkout.
 *
 * O instalador entrega o projeto a partir do zip que o GitHub publica, e zip
 * não traz `.git`. As conferências que dependem do git não têm o que medir
 * ali — e reprovar faria uma instalação perfeitamente boa terminar com sete
 * falhas na tela, assustando justamente quem acabou de instalar.
 */
const rastreados = (() => {
  try {
    if (!fs.existsSync(path.join(RAIZ_PROJETO, '.git'))) return null;
    return exec11('git', ['ls-files'], { cwd: RAIZ_PROJETO, encoding: 'utf8', windowsHide: true })
      .split('\n').filter(Boolean);
  } catch (e) { return null; }
})();

/** Sai pulando quando não há checkout git para inspecionar. */
function exigeGit() {
  if (!rastreados) pular('instalado a partir do zip; não há checkout git para conferir');
  return rastreados;
}

check('o projeto inteiro está versionado, não só a página', () => {
  exigeGit();
  const porExt = {};
  for (const a of rastreados) {
    const e = path.extname(a) || a;
    porExt[e] = (porExt[e] || 0) + 1;
  }
  for (const e of ['.js', '.ps1', '.html']) assert(porExt[e] > 0, 'nenhum ' + e + ' versionado');
  assert(rastreados.includes('package.json'), 'sem package.json');
  assert(rastreados.includes('sync/main.js'), 'sem o serviço');
  assert(rastreados.includes('trackeroao.html'), 'sem a página');
  return rastreados.length + ' arquivos: ' + Object.entries(porExt)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, n]) => n + e).join(', ');
});

check('quem clonar recebe as artes junto', () => {
  exigeGit();
  const artes = rastreados.filter((a) => a.startsWith('docs/icones/') && a.endsWith('.png'));
  assert(artes.length > 0, 'nenhuma arte versionada; a lista de chefes cairia no kanji');
  return artes.length + ' imagens no repositório';
});

check('nada é resolvido para fora da pasta clonada', () => {
  exigeGit();
  const foraDaPasta = [];
  for (const a of rastreados) {
    if (!/\.(ps1|js|bat|vbs)$/i.test(a)) continue;
    const t = fs.readFileSync(path.join(RAIZ_PROJETO, a), 'utf8');
    // Subir um nível a partir de sync/ é a raiz do projeto, e isso vale. O que
    // não vale é sair da raiz: era por aí que entrava o utilitário de terceiro
    // que escondia a janela, morando numa pasta irmã que não vinha no clone.
    if (/Split-Path \$PSScriptRoot -Parent/.test(t)) foraDaPasta.push(a + ': sobe acima da raiz');
    if (/\.\.[\\/]\.\.[\\/]/.test(t)) foraDaPasta.push(a + ': caminho para fora da raiz');
    /*
     * Um .exe de terceiro chamado por caminho é o caso que se quer impedir:
     * era por aí que entrava o utilitário que escondia a janela, morando numa
     * pasta irmã que não vinha no clone. O que NÃO é problema é chamar o que a
     * própria máquina fornece — o Node (que o instalador obtém via winget), o
     * compilador do .NET Framework e os utilitários do Windows. Esses existem
     * em qualquer máquina de destino, então não quebram o "clonar e funcionar".
     *
     * O `(?![A-Za-z])` no fim existe porque sem ele todo `/regex/.exec(...)`
     * do projeto casava com ".exe" e o teste acusava meia dúzia de arquivos
     * que não chamam executável nenhum.
     */
    const DA_MAQUINA = /^(node|csc|wscript|cscript|powershell|winget|explorer|schtasks|taskkill)$/i;
    const CAMINHO_EXE = /[\\/]([A-Za-z0-9_-]+)\.exe(?![A-Za-z])/g;
    for (const m of t.matchAll(CAMINHO_EXE)) {
      if (DA_MAQUINA.test(m[1])) continue;
      if (/System32/i.test(t)) continue;
      foraDaPasta.push(a + ": chama " + m[1] + ".exe por caminho");
    }
  }
  assert(foraDaPasta.length === 0, foraDaPasta.join(' | '));
  return 'nenhum caminho sai da raiz do projeto';
});

check('a janela é escondida sem binário de terceiro', () => {
  const vbs = path.join(RAIZ_PROJETO, 'sync', 'oculto.vbs');
  assert(fs.existsSync(vbs), 'sem o lançador oculto');
  const t = fs.readFileSync(vbs, 'utf8');
  assert(/\.Run .*, 0, False/.test(t), 'não pede janela oculta');
  const inst = fs.readFileSync(path.join(RAIZ_PROJETO, 'install-sync-service.ps1'), 'utf8');
  assert(/wscript/i.test(inst), 'o instalador não usa o wscript');
  return 'wscript.exe do próprio Windows, nada para baixar';
});

check('nada do que está versionado identifica esta máquina', () => {
  exigeGit();
  const sujos = [];
  for (const a of rastreados) {
    if (/\.(png|svg|bin|sl2|zip|exe|ico)$/i.test(a)) continue;
    let t = '';
    try { t = fs.readFileSync(path.join(RAIZ_PROJETO, a), 'utf8'); } catch (e) { continue; }
    // A pasta publicada é dado, e vale o detector de forma; o resto é código,
    // e vale o detector de valores concretos.
    const v = a.startsWith('docs/') ? publish.vazamentos(t) : publish.vazamentosNoCodigo(t);
    if (v.length) sujos.push(a + ': ' + v.join(', '));
  }
  assert(sujos.length === 0, sujos.join(' | '));
  return rastreados.length + ' arquivos, nenhum com pasta pessoal, Steam ID ou IP';
});

check('nada no projeto carrega o nome antigo', () => {
  exigeGit();
  // O projeto se chama trackeroao. "Progress — Sekiro" era o título da aba, e
  // "sekiro-progresso" era o nome do arquivo da página, do log e das chaves de
  // armazenamento. O nome do jogo continua valendo onde é o jogo que está
  // sendo descrito — nas listas, nos textos —, mas não como nome do projeto.
  // Os termos vão montados em pedaços: escritos por extenso, este arquivo se
  // acusaria na primeira execução, como já houve com o Steam ID de exemplo.
  const NOME_ANTIGO = 'sekiro' + '-progresso';
  const LOG_ANTIGO = 'sekiro' + '-sync';
  const TITULO_ANTIGO = 'Progress ' + '— Sekiro';
  const antigos = new RegExp(NOME_ANTIGO + '|' + LOG_ANTIGO, 'gi');
  // A página tem direito a três: a ponte de compatibilidade das chaves lê a
  // antiga, apaga a antiga, e explica por quê.
  const COTA = { 'trackeroao.html': 3 };

  const sujos = [];
  for (const a of rastreados) {
    if (/\.(png|svg|bin|sl2|zip|exe|ico)$/i.test(a)) continue;
    if (/^docs\//.test(a)) continue;   // saída publicada, conferida à parte
    if (a === 'sync/selftest.js') continue;   // é este arquivo, que fala deles
    if (antigos.test(a)) { sujos.push(a + ' (no nome do arquivo)'); continue; }
    let t = '';
    try { t = fs.readFileSync(path.join(RAIZ_PROJETO, a), 'utf8'); } catch (e) { continue; }
    if (t.includes(TITULO_ANTIGO)) sujos.push(a + ': título antigo');
    const citacoes = (t.match(antigos) || []).length;
    if (citacoes > (COTA[a] || 0)) sujos.push(a + ': ' + citacoes + ' citações do nome antigo');
  }
  assert(sujos.length === 0, sujos.join(' | '));
  const titulo = /<title>([^<]*)<\/title>/.exec(
    fs.readFileSync(path.join(RAIZ_PROJETO, 'trackeroao.html'), 'utf8'));
  assert(titulo && titulo[1].trim() === 'trackeroao', 'o título da aba é "' + (titulo && titulo[1]) + '"');
  return 'título "trackeroao", arquivo trackeroao.html, chaves trackeroao-*';
});

check('quem já usava a página não perde as preferências', () => {
  // Renomear chave de localStorage apaga em silêncio o tema e os alfinetes de
  // quem já estava usando. A leitura cai na chave antiga quando a nova não
  // existe, e é isso que faz o renome passar despercebido em vez de doer.
  const t = fs.readFileSync(path.join(RAIZ_PROJETO, 'trackeroao.html'), 'utf8');
  assert(/function guardado\(chave\)/.test(t), 'não há função de leitura');
  assert(/getItem\("trackeroao-" \+ chave\)/.test(t), 'não lê a chave nova');
  assert(/getItem\("sekiro-progresso-" \+ chave\)/.test(t), 'não tem a reserva da chave antiga');
  assert(/setItem\("trackeroao-" \+ chave/.test(t), 'não grava na chave nova');
  return 'lê a nova, cai na antiga, grava sempre na nova';
});

check('o estado de execução ficou fora do git', () => {
  exigeGit();
  const nunca = ['progress.json', 'deaths.json', 'bosskills.json', 'deaths-mem.json'];
  const vazados = nunca.filter((n) => rastreados.includes(n));
  assert(vazados.length === 0, 'versionado indevidamente: ' + vazados.join(', '));
  // E o publicado, que é a versão saneada, tem de estar.
  assert(rastreados.includes('docs/progress.json'), 'o progresso publicado não está versionado');
  return 'o cru fora, o saneado dentro';
});

check('a conferência do fonte sabe distinguir falar de um caminho e escrever o seu', () => {
  const os = require('os');
  // Falar do formato passa; escrever o caminho desta máquina, não. Sem essa
  // distinção o detector recusaria justamente o parser, que precisa dizer
  // onde o save mora.
  assert(publish.vazamentosNoCodigo('o save fica em AppData/Roaming/Sekiro/<steamid64>/S0000.sl2').length === 0,
    'recusou a descrição do formato');
  assert(publish.vazamentosNoCodigo('C:\\Users\\<usuario>\\AppData').length === 0,
    'recusou o marcador de usuário');
  assert(publish.vazamentosNoCodigo('const BASE_STEAMID64 = 76561197960265728n;').length === 0,
    'recusou a constante pública da Steam');
  // Montados em pedaços de propósito: escritos inteiros, estes dois exemplos
  // fariam o detector recusar este próprio arquivo na hora de copiar o fonte
  // para o site — o teste da regra tropeçando na regra.
  const caminhoFalso = 'C:\\Users\\' + 'ful' + 'ano\\AppData';
  const idFalso = '7656119' + '8000000001';
  assert(publish.vazamentosNoCodigo(caminhoFalso).length > 0,
    'deixou passar um caminho com nome de gente');
  assert(publish.vazamentosNoCodigo(idFalso).length > 0,
    'deixou passar um Steam ID de verdade');
  assert(publish.vazamentosNoCodigo(os.homedir()).length > 0,
    'deixou passar a pasta pessoal desta máquina');
  return 'seis casos, os três que passam e os três que não';
});

/*
 * 12. A assinatura do projeto.
 *
 * O trabalho sai com o nome do autor e de mais ninguém. Isso já escapou três
 * vezes por caminhos diferentes — um trailer no corpo do commit, que o GitHub
 * conta como co-autor e mostra na lista de contribuidores; um comentário solto
 * no meio do código; um arquivo de ferramenta com nome entregando de onde
 * veio. Conferir à mão não pegou nenhuma das três, então passa a ser teste.
 *
 * Os termos procurados são montados em pedaços de propósito. Escritos por
 * extenso, este arquivo acusaria a si mesmo na primeira execução — o teste da
 * regra tropeçando na regra, igual ao que houve com o Steam ID de exemplo.
 */
console.log('\n  === 12. A assinatura do projeto ===');

const MARCAS = ['cla' + 'ude', 'anthro' + 'pic', 'copi' + 'lot', 'chat' + 'gpt'];
const marcado = (texto) => {
  const baixo = String(texto).toLowerCase();
  return MARCAS.filter((m) => baixo.includes(m));
};

const IGNORAR = new Set(['.git', 'node_modules', 'snapshots', 'arquivo', 'icones']);

check('nenhum arquivo do projeto entrega de onde veio', () => {
  const sujos = [];
  const anda = (d) => {
    for (const n of fs.readdirSync(d)) {
      if (IGNORAR.has(n)) continue;
      const c = path.join(d, n);
      if (fs.statSync(c).isDirectory()) { anda(c); continue; }
      if (/\.(log|log\.\d+|png|svg|bin|sl2|txt)$/i.test(n)) continue;
      const achadosNome = marcado(n);
      if (achadosNome.length) { sujos.push(path.relative(RAIZ_PROJETO, c) + ' (no nome)'); continue; }
      let texto = '';
      try { texto = fs.readFileSync(c, 'utf8'); } catch (e) { continue; }
      const achados = marcado(texto);
      if (achados.length) sujos.push(path.relative(RAIZ_PROJETO, c));
    }
  };
  anda(RAIZ_PROJETO);
  assert(sujos.length === 0, 'entregam: ' + sujos.join(', '));
  return 'varreu o projeto inteiro, nome e conteúdo';
});

check('nenhuma mensagem de commit publicada entrega de onde veio', () => {
  const { execFileSync } = require('child_process');
  const site = RAIZ_PROJETO;
  if (!fs.existsSync(path.join(site, '.git'))) return 'sem repositório publicado aqui';
  const log = execFileSync('git', ['log', '--all', '--format=%H%n%s%n%b'],
    { cwd: site, encoding: 'utf8', windowsHide: true });
  const achados = marcado(log);
  assert(achados.length === 0, 'aparece no histórico de commits');
  const n = execFileSync('git', ['rev-list', '--count', 'HEAD'],
    { cwd: site, encoding: 'utf8', windowsHide: true }).trim();
  return n + ' commits, nenhum com trailer de co-autoria';
});

check('o histórico publicado tem um autor só', () => {
  const { execFileSync } = require('child_process');
  const site = RAIZ_PROJETO;
  if (!fs.existsSync(path.join(site, '.git'))) return 'sem repositório publicado aqui';
  const quem = execFileSync('git', ['log', '--all', '--format=%an <%ae>|%cn <%ce>'],
    { cwd: site, encoding: 'utf8', windowsHide: true })
    .split('\n').filter(Boolean);
  const distintos = [...new Set(quem.flatMap((l) => l.split('|')))];
  assert(distintos.length === 1, 'mais de um: ' + distintos.join(' / '));
  return distintos[0];
});

check('nem o nome de nenhuma referência entrega de onde veio', () => {
  // Esta é a brecha por onde escapou de verdade, e por isso vira teste.
  //
  // A conferência olhava arquivo, mensagem de commit e autor — e passava. O
  // que aparecia na lista de contribuidores do GitHub vinha de outro lugar:
  // três branches cujos próprios NOMES começavam com a marca, com commits
  // assinados por ela. Nome de referência não é conteúdo nem mensagem, então
  // nenhuma das conferências anteriores olhava para lá.
  const { execFileSync } = require('child_process');
  if (!fs.existsSync(path.join(RAIZ_PROJETO, '.git'))) return 'sem repositório aqui';
  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)'],
    { cwd: RAIZ_PROJETO, encoding: 'utf8', windowsHide: true })
    .split('\n').filter(Boolean);
  const sujas = refs.filter((r) => marcado(r).length);
  assert(sujas.length === 0, 'referências marcadas: ' + sujas.join(', '));
  return refs.length + ' referências, todas limpas';
});

function resumo() {
  console.log('');
  console.log(`  === Resultado: ${pass} ok, ${fail} falha(s) ===`);
  if (fail) {
    console.log('  Falhou: ' + failures.join(', '));
    console.log('  Se for só a parte do save, veja o README (seção "não achou o save").');
    process.exitCode = 1;
  } else {
    console.log('  Tudo certo.');
  }
  console.log('');
}

/*
 * 6. A página desenha o que o save diz.
 *
 * Os grupos acima provam a leitura do save; nenhum deles nota se a página
 * parou de mostrar o resultado. Este roda o <script> da própria página num DOM
 * de brinquedo, pelo mesmo caminho do navegador (fetch -> pollProgress ->
 * render), e confere as linhas contra o progress.json. É o grupo que pega
 * renome de chave na config, que não quebra nada e só apaga as marcações.
 *
 * É assíncrono, então o resumo saiu para depois dele.
 */
(async () => {
  console.log('\n  === 6. A página desenha o que o save diz ===');
  try {
    await require('./pagetest').rodar((cond, nome, detalhe) => {
      if (cond) {
        pass++;
        console.log(`   ok    ${nome}${detalhe ? '  -  ' + detalhe : ''}`);
      } else {
        fail++;
        failures.push(nome);
        console.log(`   FALHA ${nome}\n            ${detalhe}`);
      }
    });
  } catch (err) {
    fail++;
    failures.push('render da página');
    console.log(`   FALHA render da página\n            ${err.message}`);
  }
  resumo();
})();
