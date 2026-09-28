'use strict';
/*
 * parse.js - turn a Sekiro save into the progress.json the tracker reads.
 *
 * Everything here is derived from the item table, which is the part of the
 * save we can read with confidence. Anything we cannot read is simply left
 * out of the file rather than guessed, so the page can fall back to whatever
 * the user typed in by hand.
 */

const fs = require('fs');
const path = require('path');

const sl2 = require('./sl2');
const inventory = require('./inventory');
const flags = require('./flags');
const deaths = require('./deaths');
const deathsmem = require('./deathsmem');
const tempo = require('./tempo');
const bosskills = require('./bosskills');
const achievements = require('./achievements');

const CONFIG_PATH = path.join(__dirname, 'offsets.json');
const STATE_PATH = path.join(__dirname, '.state.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    /* state is only an optimisation; never fail the run over it */
  }
}

/**
 * Decide which of the ten character slots to read.
 *
 * "auto" prefers the slot the game was last seen writing to - the watcher
 * records that in .state.json by noticing which block's checksum changed.
 * Before we have ever seen a save happen, fall back to the most-progressed
 * non-empty slot and say so, so a wrong guess is visible rather than silent.
 */
function chooseSlot(save, config, state) {
  const entries = sl2.slotEntries(save);
  const nonEmpty = sl2.nonEmptySlots(save);

  if (typeof config.slot === 'number') {
    return { entry: entries[config.slot], index: config.slot, how: 'configured' };
  }
  if (state.activeSlot !== undefined && state.activeSlot !== null) {
    const e = entries[state.activeSlot];
    if (e && !sl2.isSlotEmpty(save, e)) {
      return { entry: e, index: state.activeSlot, how: 'learned' };
    }
  }
  if (!nonEmpty.length) return { entry: null, index: null, how: 'none' };

  // Heuristic: the slot holding the most distinct items is the furthest along.
  let best = null;
  for (const entry of nonEmpty) {
    const payload = sl2.blockPayload(save.buf, entry);
    const { items } = inventory.readItemTable(payload, config.itemTable);
    if (!best || items.length > best.count) {
      best = { entry, count: items.length, index: entry.index };
    }
  }
  return { entry: best.entry, index: best.index, how: 'heuristic' };
}

function goodsQuantities(payload, config) {
  const { region, items, error } = inventory.readItemTable(payload, config.itemTable);
  // Prosthetic tools and combat arts are stored as 'weapon' records, not goods:
  // owning the record is what marks them unlocked, so only presence matters.
  const weapons = new Set();
  for (const it of items) if (it.category === 'weapon') weapons.add(it.paramId);
  return {
    region,
    error,
    goods: inventory.quantityMap(items, 'goods'),
    weapons,
    itemCount: items.length,
  };
}

/**
 * Mini-bosses, read from event flags.
 *
 * The boss Memories in the item table give us ground truth for the boss flags,
 * so we use those to verify (and if necessary re-find) the flag block before
 * trusting anything else it says.
 */
function buildMiniBosses(payload, config, bosses, goods) {
  const cfg = config.eventFlags;
  if (!cfg || cfg.base === null || cfg.base === undefined) {
    return { list: [], calibration: { how: 'not-configured' } };
  }

  const expected = {};
  const byKey = new Map(bosses.map((b) => [b.key, b]));
  for (const bf of cfg.bossFlags.list) {
    const b = byKey.get(bf.key);
    // Só serve de referência quem já tem resposta sim/não: os chefes provados
    // por Memory. Os que dependem de flag (prólogo, Emma) ainda estão nulos
    // aqui, e usá-los calibraria a base contra ela mesma.
    if (b && typeof b.defeated === 'boolean') expected[bf.flag] = b.defeated;
  }

  const cal = flags.calibrate(payload, cfg, expected);
  if (cal.how === 'failed') {
    // Better to report nothing than to report a bit read from the wrong place.
    return { list: [], calibration: cal };
  }
  const effective = Object.assign({}, cfg, { base: cal.base });

  // Três situações. A maioria tem flag no bloco comum. O Shichimen do
  // Abandoned Dungeon não tem, mas larga um item exclusivo. Dois não têm nem
  // um nem outro: aí `detected` é false, e false não é a mesma coisa que vivo.
  const list = cfg.miniBosses.map((m) => {
    const base = { key: m.key, label: m.label, area: m.area, drop: m.drop || null, entity: m.entity };
    if (m.flag) {
      return Object.assign(base, {
        via: 'flag', flag: m.flag, detected: true,
        defeated: flags.read(payload, effective, m.flag) === true,
      });
    }
    if (m.goodsAnyOf) {
      return Object.assign(base, {
        via: 'item', ids: m.goodsAnyOf, detected: true, confidence: m.confidence || null,
        defeated: m.goodsAnyOf.some((id) => goods.has(id)),
      });
    }
    return Object.assign(base, { via: 'none', detected: false, defeated: false });
  });
  return { list, calibration: cal };
}

/**
 * Headless.
 *
 * Nenhum deles tem flag legível: as recompensas moram em blocos de área. Mas
 * cada um larga um Spiritfall exclusivo e permanente, então o inventário serve
 * de prova — o mesmo truque da Serpent Viscera para a Great Serpent.
 */
function buildHeadless(config, goods) {
  const cfg = config.headless;
  if (!cfg || !cfg.list) return [];
  return cfg.list.map((h) => ({
    key: h.key,
    label: h.label,
    area: h.area,
    drop: h.drop || null,
    entity: h.entity,
    ids: h.goodsAnyOf,
    via: 'item',
    detected: true,
    defeated: h.goodsAnyOf.some((id) => goods.has(id)),
    confidence: h.confidence,
  }));
}

/**
 * Sculptor's Idols.
 *
 * Cada área guarda suas flags num bloco próprio, e a base desses blocos ainda
 * não é conhecida — ao contrário do bloco comum, não dá para deduzir, porque
 * todos os ídolos ocupam as mesmas posições dentro do seu bloco e qualquer
 * base devolveria os mesmos bits. Enquanto a base for nula, devolvemos
 * `detected: false` em vez de dizer que o ídolo está apagado: não saber não é
 * a mesma coisa que não ter.
 */
function buildIdols(payload, config) {
  const cfg = config.idols;
  if (!cfg || !cfg.list) return { list: [], blocosCalibrados: 0, blocosTotal: 0 };

  const bases = cfg.blockBases || {};
  const blocos = Object.keys(bases);
  const calibrados = blocos.filter((b) => typeof bases[b] === 'number');

  const list = cfg.list.map((i) => {
    const base = bases[i.block];
    if (typeof base !== 'number') {
      return { key: i.key, label: i.label, area: i.area, flag: i.flag, detected: false, unlocked: false };
    }
    const efetivo = { base, zoneStride: cfg.zoneStride || 128 };
    return {
      key: i.key,
      label: i.label,
      area: i.area,
      flag: i.flag,
      detected: true,
      unlocked: flags.read(payload, efetivo, i.flag) === true,
    };
  });

  return { list, blocosCalibrados: calibrados.length, blocosTotal: blocos.length };
}

/** Owning the weapon record for an id means the tool/art is unlocked. */
function buildUnlocks(list, weapons) {
  return list.map((e) => ({
    key: e.key,
    label: e.label,
    id: e.id,
    unlocked: weapons.has(e.id),
    confidence: e.confidence,
  }));
}

/** Things proven by simply holding one of a set of goods. */
function buildGoodsUnlocks(config, goods) {
  const cfg = config.goodsUnlocks;
  if (!cfg || !cfg.list) return [];
  return cfg.list.map((e) => ({
    key: e.key,
    label: e.label,
    ids: e.anyOf,
    drop: e.drop || null,
    unlocked: e.anyOf.some((id) => goods.has(id)),
    confidence: e.confidence,
  }));
}

function buildEssentials(goods, config) {
  const prog = config.progression;
  const beadId = config.goods.prayerBead.id;
  const seedId = config.goods.gourdSeed.id;

  const held = goods.get(beadId) || 0;
  let necklaces = 0;
  for (const id of config.goods.prayerNecklaces.ids) {
    if (goods.has(id)) necklaces++;
  }

  const materials = config.materials.map((m) => ({
    key: m.key,
    label: m.label,
    id: m.id,
    qty: goods.get(m.id) || 0,
    confidence: m.confidence,
  }));

  return {
    prayerBeads: {
      held,
      necklaces,
      beadsPerNecklace: prog.beadsPerNecklace,
      // Beads already spent on necklaces are gone from the inventory, so the
      // number actually collected is what is held plus what was converted.
      collected: necklaces * prog.beadsPerNecklace + held,
      totalInGame: prog.totalPrayerBeads,
      totalNecklaces: prog.totalNecklaces,
      confidence: config.goods.prayerBead.confidence,
    },
    gourdSeeds: {
      // Seeds are consumed when Emma upgrades the gourd, so `held` is only the
      // ones not yet handed in — it is not a progress figure. The gourd's charge
      // count is, and so are the nine pickup flags; `collected` is filled in by
      // buildProgress from those flags.
      held: goods.get(seedId) || 0,
      charges: goods.get(config.goods.healingGourd.id) || 0,
      startingCharges: prog.startingGourdCharges,
      collected: null,
      totalInGame: prog.maxGourdSeeds,
      maxCharges: prog.maxGourdCharges,
      confidence: config.goods.gourdSeed.confidence,
    },
    materials,
  };
}

function buildBosses(goods, config) {
  const { unusedBase, usedBase, list, confidence } = config.bossMemories;
  return list.map((b) => {
    // Prólogo e Emma não deixam Memory. Ficam com `defeated: null` aqui e são
    // resolvidos por flag depois da calibração, em resolveFlagOnlyBosses.
    if (b.flagOnly) {
      return {
        key: b.key, label: b.label, area: b.area || null, drop: null,
        emblema: b.emblema || null, emblemaPorque: b.emblemaPorque || null, enquadre: b.enquadre || null,
      enquadre: b.enquadre || null,
        defeated: null, memory: null, via: 'flag', flag: b.flag,
        note: b.note || null, confidence: 'high',
      };
    }
    const hasUnused = goods.has(unusedBase + b.n);
    const hasUsed = goods.has(usedBase + b.n);
    return {
      key: b.key,
      label: b.label,
      area: b.area || null,
      drop: b.drop || null,
      emblema: b.emblema || null,
      emblemaPorque: b.emblemaPorque || null,
      enquadre: b.enquadre || null,
      defeated: hasUnused || hasUsed,
      memory: hasUsed ? 'used' : hasUnused ? 'held' : null,
      via: 'memory',
      confidence,
    };
  });
}

/**
 * Itens cuja obtenção tem flag própria no bloco comum: as 40 Prayer Beads e as
 * 9 Gourd Seeds.
 *
 * Isto substitui uma conta indireta que existia antes. As contas eram deduzidas
 * da aritmética dos colares (colares × 4 + as soltas na bolsa), o que dava o
 * total certo mas não dizia quais; e as sementes eram lidas pela quantidade do
 * item, que zera assim que a semente é entregue à Emma — por isso apareciam
 * como 0/9 com o jogo quase terminado. A flag não some depois de usada.
 */
function buildFlagItems(payload, cfg, calibration, itens) {
  if (!itens || !itens.list || !calibration || calibration.how === 'failed' ||
      typeof calibration.base !== 'number') {
    return null;
  }
  const effective = Object.assign({}, cfg, { base: calibration.base });
  return itens.list.map((x) => ({
    key: x.key,
    label: x.label,
    area: x.area,
    from: x.from,
    where: x.where || null,
    flag: x.flag,
    collected: flags.read(payload, effective, x.flag) === true,
  }));
}

/**
 * Contagem de mortes.
 *
 * Nenhuma fonte documenta um campo de mortes no save do Sekiro, então não há
 * offset para reaproveitar. Em vez de pedir ao usuário que conte as próprias
 * mortes, o módulo deaths.js observa cada gravação do save e deduz o offset das
 * restrições estruturais - ver o comentário de cabeçalho de lá. Aqui só juntamos
 * a observação com a leitura.
 *
 * `observar` é chamado antes de `paraProgresso` para que a gravação atual já
 * conte como evidência.
 */
function buildDeaths(payload, config, goods, weapons, slot, opts) {
  let estado = deaths.load();
  // Só o processo residente observa, e isso não é detalhe: a busca compara o
  // save com a leitura ANTERIOR do mesmo processo. Uma execução avulsa teria uma
  // base velha, o intervalo poderia conter duas mortes, e a regra "sobe 0 ou 1"
  // eliminaria justamente o contador verdadeiro. Quem só lê, só lê.
  if (opts && opts.observe === true) {
    try {
      estado = deaths.observar({
        payload, goods, weapons, slot,
        senOffset: config.deathCount && config.deathCount.senOffset,
      });
    } catch (e) {
      // A busca é um extra: se ela falhar, o resto do progresso não pode cair.
      estado = deaths.load();
    }
  }
  // A memória do jogo manda, quando está calibrada e o jogo aberto: o número
  // é o do próprio jogo, exato e em tempo real. O save é reserva.
  //
  // O `catch` aqui é estreito de propósito. Antes ele envolvia também a
  // construção do objeto, e `confidence: high` estava escrito sem aspas — um
  // ReferenceError que o próprio catch engolia. O resultado era o pior tipo de
  // defeito: a leitura da memória funcionava, devolvia o número certo, e a
  // página mostrava a contagem do save como se a calibração nunca tivesse
  // acontecido. Nada falhava; só estava errado. Agora só a chamada que pode
  // legitimamente falhar — o jogo fechado — fica protegida.
  let m = null;
  try {
    m = deathsmem.contagem();
  } catch (e) { /* jogo fechado, ou ainda sem calibração */ }
  if (m) {
    // `escopo` viaja junto porque muda o que o número significa. "jornada" é a
    // contagem que o save carrega, desde que aquele arquivo começou; "sessao"
    // é a reserva, e conta só desde que o jogo abriu. Publicar os dois casos
    // com a mesma cara faria o segundo parecer o primeiro.
    return {
      known: true,
      count: m.mortes,
      confidence: m.escopo === 'jornada' ? 'high' : 'likely',
      how: 'memoria',
      escopo: m.escopo || 'jornada',
      em: m.em,
    };
  }
  return deaths.paraProgresso(estado);
}

/** Preenche os chefes sem Memory, agora que a base de flags está confirmada. */
function resolveFlagOnlyBosses(bosses, payload, config, calibration) {
  if (!calibration || calibration.how === 'failed' || typeof calibration.base !== 'number') {
    return;
  }
  const effective = Object.assign({}, config.eventFlags, { base: calibration.base });
  for (const b of bosses) {
    if (b.defeated !== null || !b.flag) continue;
    b.defeated = flags.read(payload, effective, b.flag) === true;
    b.detected = true;
  }
}

/** Read the save and produce the progress object. Throws on unreadable saves. */
function buildProgress(options) {
  const opts = options || {};
  const config = opts.config || loadConfig();
  const state = opts.state || loadState();
  const file = opts.file || sl2.findSavePath();

  if (!file) {
    return {
      generatedAt: new Date().toISOString(),
      ok: false,
      error: 'no-save-found',
      message:
        'No S0000.sl2 found. See the README for the paths searched.',
    };
  }

  // The watcher has usually just read and validated the file; reuse that
  // rather than re-reading 11 MB and recomputing twelve digests.
  const save = opts.save || sl2.readSave(file);
  const chosen = chooseSlot(save, config, state);
  if (!chosen.entry) {
    return {
      generatedAt: new Date().toISOString(),
      ok: false,
      error: 'no-character',
      message: 'The save exists but no character slot has data.',
      source: { file },
    };
  }

  const payload = sl2.blockPayload(save.buf, chosen.entry);
  const { goods, weapons, region, error, itemCount } = goodsQuantities(payload, config);

  const goodsRaw = {};
  for (const [id, qty] of goods) goodsRaw[id] = qty;

  const bosses = buildBosses(goods, config);
  const mini = buildMiniBosses(payload, config, bosses, goods);
  resolveFlagOnlyBosses(bosses, payload, config, mini.calibration);
  const idols = buildIdols(payload, config);
  const beadList = buildFlagItems(payload, config.eventFlags, mini.calibration, config.prayerBeadFlags);
  const seedList = buildFlagItems(payload, config.eventFlags, mini.calibration, config.gourdSeedFlags);

  const essentials = buildEssentials(goods, config);
  // As sementes entregues à Emma não estão mais na bolsa; as flags sabem.
  if (seedList) essentials.gourdSeeds.collected = seedList.filter((s) => s.collected).length;

  let saveModified = null;
  try {
    saveModified = fs.statSync(file).mtime.toISOString();
  } catch (e) {
    /* not important */
  }

  return {
    generatedAt: new Date().toISOString(),
    ok: !error,
    source: {
      file,
      slot: chosen.index,
      slotSelection: chosen.how,
      nonEmptySlots: sl2.nonEmptySlots(save).map((e) => e.index),
      saveModified,
      itemTable: region ? { start: region.start, end: region.end, how: region.confidence } : null,
      itemsRead: itemCount,
    },
    essentials,
    deaths: buildDeaths(payload, config, goods, weapons, chosen.index, opts),
    // Tempo de jogo vem do Steam, não do save: ver o cabeçalho de tempo.js.
    playtime: (() => { try { return tempo.tempoDeJogo({ save: file }); } catch (e) { return null; } })(),
    // Conquistas do Steam, lidas do cache local: sem chave de API, sem depender
    // de o perfil ser público.
    achievements: (() => {
      try {
        return achievements.conquistas({ conta: tempo.contaDoSave(file) });
      } catch (e) { return null; }
    })(),
    bossKills: (() => {
      try {
        // Só o processo residente acumula: uma execução avulsa veria a mesma
        // transição de novo e contaria uma morte que não houve.
        const st = (opts && opts.observe === true) ? bosskills.atualizar(bosses) : bosskills.carregar();
        return bosskills.paraProgresso(bosses, st);
      } catch (e) { return null; }
    })(),
    prayerBeadList: beadList,
    gourdSeedList: seedList,
    bosses,
    tools: buildUnlocks(config.prostheticTools.list, weapons),
    arts: buildUnlocks(config.combatArts.list, weapons),
    miniBosses: mini.list,
    headless: buildHeadless(config, goods),
    idols: idols.list,
    idolCalibration: { blocos: idols.blocosCalibrados, total: idols.blocosTotal },
    goodsUnlocks: buildGoodsUnlocks(config, goods),
    flagCalibration: mini.calibration,
    goodsRaw,
    weaponsRaw: [...weapons].sort((a, b) => a - b),
    notes: error ? [error] : [],
  };
}

/**
 * Uma leitura que falhou não pode apagar o progresso já conhecido.
 *
 * O save pode ficar indisponível por motivos banais e temporários - Steam
 * Cloud mexendo no arquivo, o serviço subindo antes do perfil estar pronto,
 * uma leitura partida que esgotou as tentativas. Sobrescrever o progress.json
 * com um objeto de erro nesses casos apagaria tudo que já tínhamos, e como a
 * página não tem entrada manual, o usuário ficaria sem nada.
 *
 * Então, quando a leitura falha e existe um resultado bom no disco, mantemos o
 * bom e apenas marcamos que está velho.
 */
function preserveGood(outFile, progress) {
  if (progress.ok) return progress;

  let anterior = null;
  try {
    anterior = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    anterior = null;
  }
  if (!anterior || !anterior.ok) return progress;

  return Object.assign({}, anterior, {
    stale: {
      desde: new Date().toISOString(),
      error: progress.error,
      message: progress.message,
      // O que está sendo mostrado é a última leitura boa, desta data:
      leituraDe: anterior.generatedAt,
    },
  });
}

// ------------------------------------------------------------------ histórico
const HISTORY_MAX = 80;

/** Listas de booleanos (chefes, mini-chefes, próteses, artes, itens). */
const LISTAS = [
  { campo: 'bosses', marca: 'defeated', tipo: 'boss', verbo: 'defeated' },
  { campo: 'miniBosses', marca: 'defeated', tipo: 'mini-boss', verbo: 'defeated' },
  { campo: 'headless', marca: 'defeated', tipo: 'headless', verbo: 'defeated' },
  { campo: 'prayerBeadList', marca: 'collected', tipo: 'prayer-bead', verbo: 'collected' },
  { campo: 'gourdSeedList', marca: 'collected', tipo: 'gourd-seed', verbo: 'collected' },
  { campo: 'tools', marca: 'unlocked', tipo: 'prosthetic', verbo: 'unlocked' },
  { campo: 'arts', marca: 'unlocked', tipo: 'art', verbo: 'learned' },
  { campo: 'goodsUnlocks', marca: 'unlocked', tipo: 'item', verbo: 'obtained' },
];

function contadores(p) {
  const e = (p && p.essentials) || {};
  const out = {};
  if (e.prayerBeads) {
    out['Prayer Beads'] = e.prayerBeads.collected;
    out['Prayer Necklaces'] = e.prayerBeads.necklaces;
  }
  if (e.gourdSeeds) out['Gourd Seeds'] = e.gourdSeeds.held;
  for (const m of e.materials || []) out[m.label] = m.qty;
  return out;
}

/**
 * O que mudou entre duas leituras boas. Serve para a página conseguir dizer
 * "isto aqui é novo desde a última vez que você olhou".
 */
function diffProgress(antes, depois) {
  if (!antes || !antes.ok || !depois || !depois.ok) return [];
  const quando = depois.generatedAt;
  const mudancas = [];

  for (const l of LISTAS) {
    const mapaAntes = new Map(((antes[l.campo] || [])).map((x) => [x.key, x]));
    for (const item of depois[l.campo] || []) {
      const velho = mapaAntes.get(item.key);
      if (!velho) continue; // entrada nova na config, não é progresso do jogo
      if (!velho[l.marca] && item[l.marca]) {
        mudancas.push({ at: quando, tipo: l.tipo, chave: item.key, label: item.label, texto: l.verbo });
      } else if (velho[l.marca] && !item[l.marca]) {
        // Pode acontecer se o save for restaurado para um ponto anterior.
        mudancas.push({ at: quando, tipo: l.tipo, chave: item.key, label: item.label, texto: 'back to pending' });
      }
    }
  }

  const cAntes = contadores(antes);
  const cDepois = contadores(depois);
  for (const nome of Object.keys(cDepois)) {
    const a = cAntes[nome];
    const b = cDepois[nome];
    if (typeof a !== 'number' || typeof b !== 'number' || a === b) continue;
    mudancas.push({
      at: quando,
      tipo: 'counter',
      chave: nome,
      label: nome,
      texto: `${a} → ${b}`,
      subiu: b > a,
    });
  }
  return mudancas;
}

/**
 * Produz o objeto final que vai para o disco: preserva a última leitura boa se
 * esta falhou, e carrega o histórico de mudanças adiante.
 */
function finalizeProgress(outFile, progress) {
  let anterior = null;
  try {
    anterior = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    anterior = null;
  }

  const final = preserveGood(outFile, progress);
  const historico = (anterior && anterior.history) || [];

  // Só compara leitura boa com leitura boa; um preserveGood devolve o anterior
  // inteiro, e aí não há mudança real a registrar.
  const novas = final.stale ? [] : diffProgress(anterior, final);
  final.history = historico.concat(novas).slice(-HISTORY_MAX);
  return final;
}

function writeProgress(outFile, progress) {
  const tmp = outFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(progress, null, 2));
  fs.renameSync(tmp, outFile); // atomic-ish: the page never sees a half file
  return outFile;
}

// ------------------------------------------------------------------- summary
function formatSummary(p) {
  if (!p.ok && p.error) return `  ! ${p.message}`;
  const e = p.essentials;
  const lines = [];
  lines.push(`  save   : ${p.source.file}`);
  lines.push(`  slot   : ${p.source.slot} (${p.source.slotSelection})  itens lidos: ${p.source.itemsRead}`);
  lines.push(
    `  contas : ${e.prayerBeads.collected}/${e.prayerBeads.totalInGame} coletadas ` +
      `(${e.prayerBeads.held} na bolsa, ${e.prayerBeads.necklaces}/${e.prayerBeads.totalNecklaces} colares)`
  );
  lines.push(`  cabaça : ${e.gourdSeeds.held} semente(s) na bolsa (de ${e.gourdSeeds.totalInGame} no jogo)`);
  const mats = e.materials.filter((m) => m.qty > 0).map((m) => `${m.key}=${m.qty}`);
  lines.push(`  mater. : ${mats.length ? mats.join('  ') : '(nenhum)'}`);
  const dead = p.bosses.filter((b) => b.defeated);
  lines.push(`  chefes : ${dead.length}/${p.bosses.length} com memória`);
  for (const b of dead) lines.push(`             - ${b.label}`);
  const tools = p.tools.filter((t) => t.unlocked);
  lines.push(`  prótese: ${tools.length}/${p.tools.length}  ${tools.map((t) => t.label).join(', ') || '(nenhuma)'}`);
  const arts = p.arts.filter((a) => a.unlocked);
  lines.push(`  artes  : ${arts.length}/${p.arts.length}  ${arts.map((a) => a.label).join(', ') || '(nenhuma)'}`);
  const idl = p.idols || [];
  const calIdol = p.idolCalibration || {};
  if (idl.length) {
    const det = idl.filter(function (i) { return i.detected; });
    const on = det.filter(function (i) { return i.unlocked; }).length;
    const sufixo = calIdol.blocos === calIdol.total
      ? ' (todos os blocos calibrados)'
      : ' - ' + calIdol.blocos + '/' + calIdol.total + ' blocos calibrados; rode "npm run discover idol"';
    lines.push('  ídolos : ' + on + '/' + idl.length + sufixo);
  }
  const all = p.miniBosses || [];
  const mb = all.filter((m) => m.defeated);
  const cal = p.flagCalibration || {};
  lines.push(`  mini   : ${mb.length}/${all.length} por event flag (base ${cal.how}, ${cal.checked || 0} conferências)`);
  for (const m of mb) lines.push(`             - ${m.label} [${m.area}]`);
  return lines.join('\n');
}

module.exports = {
  CONFIG_PATH,
  STATE_PATH,
  loadConfig,
  loadState,
  saveState,
  chooseSlot,
  buildIdols,
  buildProgress,
  preserveGood,
  diffProgress,
  finalizeProgress,
  writeProgress,
  formatSummary,
};

// ----------------------------------------------------------------------- CLI
if (require.main === module) {
  const out = path.join(__dirname, '..', 'progress.json');
  try {
    const progress = finalizeProgress(out, buildProgress({}));
    writeProgress(out, progress);
    console.log('Progresso lido:');
    console.log(formatSummary(progress));
    console.log(`\n  -> escrito em ${out}`);
  } catch (err) {
    console.error('Falha ao ler o save:', err.message);
    process.exitCode = 1;
  }
}
