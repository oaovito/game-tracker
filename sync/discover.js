'use strict';
/*
 * discover.js - find out what a save byte means, by changing one thing in
 * game and diffing before/after.
 *
 * Two levels, because they answer different questions:
 *
 *   Semantic diff (items)  - "which item id changed quantity?". This is the
 *     one to use for beads, seeds and prosthetic materials. It reads the item
 *     table we already understand, so the answer is a clean one-liner like
 *     "goods 6000: 4 -> 5" instead of a wall of byte offsets.
 *
 *   Raw byte diff (flags)  - "which byte changed?". This is for the things we
 *     do NOT understand yet, mainly event flags for mini-bosses and idols.
 *     Boss defeats are usually a single bit flipping somewhere in a bitfield,
 *     so single-bit changes are listed first.
 *
 * Usage:
 *     node discover.js before          # snapshot, then go do the thing
 *     node discover.js after           # snapshot again and diff against it
 *     node discover.js snap <name>
 *     node discover.js diff <a> <b>
 *     node discover.js list
 */

const fs = require('fs');
const path = require('path');

const sl2 = require('./sl2');
const inventory = require('./inventory');
const parse = require('./parse');

const SNAP_DIR = path.join(__dirname, 'snapshots');
const MAX_LISTED = 80;

function ensureDir() {
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
}

function snapshot(name) {
  ensureDir();
  const config = parse.loadConfig();
  const state = parse.loadState();
  const file = sl2.findSavePath();
  if (!file) throw new Error('nenhum save encontrado');

  const save = sl2.readSave(file);
  const chosen = parse.chooseSlot(save, config, state);
  if (!chosen.entry) throw new Error('nenhum slot com dados');

  const payload = sl2.blockPayload(save.buf, chosen.entry);
  const binPath = path.join(SNAP_DIR, `${name}.bin`);
  const metaPath = path.join(SNAP_DIR, `${name}.json`);

  fs.writeFileSync(binPath, payload);
  const { items } = inventory.readItemTable(payload, config.itemTable);
  const goods = {};
  for (const [id, qty] of inventory.quantityMap(items, 'goods')) goods[id] = qty;

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      { name, takenAt: new Date().toISOString(), file, slot: chosen.index, goods },
      null,
      2
    )
  );
  return { name, slot: chosen.index, goodsCount: Object.keys(goods).length, binPath };
}

function loadSnapshot(name) {
  const binPath = path.join(SNAP_DIR, `${name}.bin`);
  const metaPath = path.join(SNAP_DIR, `${name}.json`);
  if (!fs.existsSync(binPath)) throw new Error(`snapshot "${name}" não existe`);
  return {
    meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')),
    payload: fs.readFileSync(binPath),
  };
}

/** id -> friendly label, built from everything we have already named. */
function labelIndex(config) {
  const map = new Map();
  map.set(config.goods.prayerBead.id, 'Prayer Bead');
  map.set(config.goods.gourdSeed.id, 'Gourd Seed');
  config.goods.prayerNecklaces.ids.forEach((id, i) => map.set(id, `Prayer Necklace #${i + 1}`));
  for (const m of config.materials) map.set(m.id, m.label);
  const bm = config.bossMemories;
  for (const b of bm.list) {
    map.set(bm.unusedBase + b.n, `Memory: ${b.label}`);
    map.set(bm.usedBase + b.n, `Memory (used): ${b.label}`);
  }
  return map;
}

function diffGoods(a, b, config) {
  const labels = labelIndex(config);
  const ids = new Set([...Object.keys(a.meta.goods), ...Object.keys(b.meta.goods)]);
  const rows = [];
  for (const idStr of ids) {
    const before = a.meta.goods[idStr];
    const after = b.meta.goods[idStr];
    if (before === after) continue;
    rows.push({
      id: Number(idStr),
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      label: labels.get(Number(idStr)) || null,
    });
  }
  rows.sort((x, y) => x.id - y.id);
  return rows;
}

function inExcluded(offset, excluded) {
  for (const r of excluded) if (offset >= r.start && offset < r.end) return true;
  return false;
}

function diffBytes(a, b, config) {
  const excluded = config.excludeFromDiff || [];
  const len = Math.min(a.payload.length, b.payload.length);
  const changes = [];
  let skipped = 0;

  for (let i = 0; i < len; i++) {
    if (a.payload[i] === b.payload[i]) continue;
    if (inExcluded(i, excluded)) {
      skipped++;
      continue;
    }
    changes.push({ offset: i, before: a.payload[i], after: b.payload[i] });
  }

  // Group into contiguous runs so a 4-byte counter reads as one change.
  const runs = [];
  for (const c of changes) {
    const last = runs[runs.length - 1];
    if (last && c.offset === last.end) {
      last.end = c.offset + 1;
      last.bytes.push(c);
    } else {
      runs.push({ start: c.offset, end: c.offset + 1, bytes: [c] });
    }
  }

  for (const run of runs) {
    run.singleBit =
      run.bytes.length === 1 && popcount(run.bytes[0].before ^ run.bytes[0].after) === 1;
    run.bitsSet =
      run.bytes.length === 1 &&
      (run.bytes[0].after & ~run.bytes[0].before & 0xff) !== 0 &&
      (run.bytes[0].before & ~run.bytes[0].after & 0xff) === 0;
  }
  return { runs, changedBytes: changes.length, skipped };
}

function popcount(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

function bin(n) {
  return n.toString(2).padStart(8, '0');
}

function printDiff(aName, bName) {
  const config = parse.loadConfig();
  const a = loadSnapshot(aName);
  const b = loadSnapshot(bName);

  console.log('');
  console.log(`  Comparando "${aName}" (${a.meta.takenAt}) -> "${bName}" (${b.meta.takenAt})`);
  if (a.meta.slot !== b.meta.slot) {
    console.log(`  ATENÇÃO: slots diferentes (${a.meta.slot} vs ${b.meta.slot}) - o diff não vale.`);
  }

  console.log('');
  console.log('  === ITENS (o que mudou de quantidade) ===');
  const goodsRows = diffGoods(a, b, config);
  if (!goodsRows.length) {
    console.log('     nenhum item mudou');
  } else {
    for (const r of goodsRows) {
      const from = r.before === null ? '(não tinha)' : r.before;
      const to = r.after === null ? '(sumiu)' : r.after;
      const known = r.label ? `  <- ${r.label}` : '   <- NÃO MAPEADO: adicione em offsets.json';
      console.log(`     goods ${String(r.id).padEnd(7)} ${String(from).padStart(11)} -> ${String(to).padEnd(11)}${known}`);
    }
  }

  console.log('');
  console.log('  === BYTES CRUS (candidatos a flag de evento) ===');
  const { runs, changedBytes, skipped } = diffBytes(a, b, config);
  console.log(`     ${changedBytes} byte(s) mudaram em ${runs.length} trecho(s)` +
    (skipped ? `; ${skipped} ignorados na região comprimida` : ''));

  const singleBits = runs.filter((r) => r.singleBit);
  if (singleBits.length) {
    console.log('');
    console.log(`     -- ${singleBits.length} mudança(s) de UM BIT (o formato típico de flag de chefe) --`);
    for (const r of singleBits.slice(0, MAX_LISTED)) {
      const by = r.bytes[0];
      const bit = Math.log2(by.before ^ by.after) | 0;
      const dir = by.after > by.before ? 'ligou' : 'desligou';
      console.log(
        `        payload 0x${r.start.toString(16).padStart(6, '0')}  bit ${bit} ${dir}   ` +
          `${bin(by.before)} -> ${bin(by.after)}`
      );
    }
    if (singleBits.length > MAX_LISTED) {
      console.log(`        ... e mais ${singleBits.length - MAX_LISTED} (não listados)`);
    }
  }

  const others = runs.filter((r) => !r.singleBit);
  if (others.length) {
    console.log('');
    console.log(`     -- outros ${others.length} trecho(s) --`);
    for (const r of others.slice(0, MAX_LISTED)) {
      const size = r.end - r.start;
      let extra = '';
      if (size >= 1 && size <= 8) {
        const before = a.payload.subarray(r.start, r.end).toString('hex');
        const after = b.payload.subarray(r.start, r.end).toString('hex');
        extra = `  ${before} -> ${after}`;
        if (size === 4) {
          extra += `   (u32 ${a.payload.readUInt32LE(r.start)} -> ${b.payload.readUInt32LE(r.start)})`;
        }
      }
      console.log(`        payload 0x${r.start.toString(16).padStart(6, '0')}  ${size} byte(s)${extra}`);
    }
    if (others.length > MAX_LISTED) {
      console.log(`        ... e mais ${others.length - MAX_LISTED} (não listados)`);
    }
  }

  console.log('');
  console.log('  Dica: se você fez UMA coisa só entre os dois snapshots e aparece');
  console.log('  uma única mudança de um bit, esse é o offset da flag. Anote em');
  console.log('  offsets.json -> eventFlags.flags, por exemplo:');
  console.log('      "oniwaChainedOgre": { "offset": 123456, "bit": 3, "confidence": "confirmed" }');
  console.log('');
}


/**
 * Calibra a base do bloco de flags de uma área a partir de um Ídolo novo.
 *
 * Descansar num Ídolo inédito liga exatamente uma flag. Como sabemos a
 * posição relativa dessa flag dentro do bloco (zona, word, bit), o offset em
 * que o bit acendeu revela a base do bloco:
 *     base = offset - zona*128 - word*4
 * Só aceitamos quando um único bit acendeu e ele casa com exatamente um
 * ídolo ainda não calibrado - do contrário não dá para saber qual foi.
 */
function calibrarIdolo(aName, bName) {
  const config = parse.loadConfig();
  const cfg = config.idols;
  if (!cfg || !cfg.list) throw new Error('offsets.json nao tem a secao "idols"');

  const a = loadSnapshot(aName);
  const b = loadSnapshot(bName);
  if (a.meta.slot !== b.meta.slot) throw new Error('os dois snapshots sao de slots diferentes');

  const { runs } = diffBytes(a, b, config);
  const acesos = [];
  for (const r of runs) {
    if (!r.singleBit) continue;
    const by = r.bytes[0];
    if (by.after <= by.before) continue; // so nos interessa bit que LIGOU
    acesos.push({ offset: r.start, bit: Math.log2(by.after ^ by.before) | 0 });
  }

  console.log("");
  console.log(`  ${acesos.length} bit(s) acenderam entre "${aName}" e "${bName}"`);
  if (!acesos.length) {
    console.log("  Nenhum bit novo. Voce descansou num Idolo que ja tinha usado?");
    return;
  }

  // Um bit dentro de uma word de 32 bits: o offset do byte nos da a word.
  const candidatos = [];
  for (const ac of acesos) {
    const wordOff = ac.offset - (ac.offset % 4);
    const bitNaWord = (ac.offset % 4) * 8 + ac.bit;
    for (const idol of cfg.list) {
      const zona = Math.floor(idol.flag / 1000) % 10;
      const word = Math.floor((idol.flag % 1000) / 32);
      const bit = 31 - ((idol.flag % 1000) % 32);
      if (bit !== bitNaWord) continue;
      const base = wordOff - zona * (cfg.zoneStride || 128) - word * 4;
      if (base < 0) continue;
      candidatos.push({ idol, base, offset: ac.offset });
    }
  }

  const porBloco = {};
  for (const c of candidatos) {
    const k = c.idol.block;
    if (!porBloco[k]) porBloco[k] = new Set();
    porBloco[k].add(c.base);
  }

  console.log("");
  console.log("  Interpretacoes possiveis:");
  for (const c of candidatos.slice(0, 40)) {
    console.log(`     se foi "${c.idol.label}" (${c.idol.area}) -> base do bloco ${c.idol.block} = ${c.base} (0x${c.base.toString(16)})`);
  }
  if (candidatos.length > 40) console.log(`     ... e mais ${candidatos.length - 40}`);

  console.log("");
  if (acesos.length === 1 && candidatos.length === 1) {
    const c = candidatos[0];
    cfg.blockBases[c.idol.block] = c.base;
    fs.writeFileSync(parse.CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
    console.log(`  GRAVADO: blockBases.${c.idol.block} = ${c.base}`);
    console.log("  Rode \"npm run sync\" para a pagina passar a marcar essa regiao.");
  } else {
    console.log("  Ambiguo demais para gravar sozinho. Descubra qual Idolo foi e");
    console.log("  escreva a base correspondente em offsets.json -> idols.blockBases.");
  }
}
// ----------------------------------------------------------------------- CLI
/**
 * Procura a contagem de mortes no bloco de stats do jogador.
 *
 * Sekiro não mostra mortes em lugar nenhum, e a comunidade que mapeou este
 * bloco (SteamID, HP, Guard, Attack Power, Sen, Emblems) nunca documentou um
 * contador — é por isso que as ferramentas de contagem existentes leem a tela
 * ou a memória do processo em vez do save. Então aqui não há offset para
 * reaproveitar: só dá para achar por diferença.
 *
 * O método: dois snapshots com um número conhecido de mortes entre eles. Um
 * offset só é candidato se subiu exatamente esse número. Rodar duas vezes com
 * números diferentes de mortes elimina quase tudo, porque um contador de saves
 * ou de inimigos mortos não sobe pelo mesmo tanto nas duas vezes.
 *
 * Se nenhum candidato sobreviver, a conclusão é útil: o save não guarda isso.
 */
function acharMortes(aName, bName, mortes, config) {
  const a = loadSnapshot(aName);
  const b = loadSnapshot(bName);
  if (a.meta.slot !== b.meta.slot) {
    throw new Error(`os snapshots são de slots diferentes (${a.meta.slot} e ${b.meta.slot})`);
  }

  const cfg = (config && config.deathCount) || {};
  const de = typeof cfg.scanFrom === 'number' ? cfg.scanFrom : 0;
  const ate = typeof cfg.scanTo === 'number' ? cfg.scanTo : Math.min(a.payload.length, b.payload.length);

  const candidatos = [];
  let mudaram = 0;
  for (let o = de; o + 4 <= ate; o += 4) {
    const va = a.payload.readUInt32LE(o);
    const vb = b.payload.readUInt32LE(o);
    if (va !== vb) mudaram++;
    if (vb - va === mortes) candidatos.push({ offset: o, de: va, para: vb });
  }

  console.log(`\n  ${aName} -> ${bName}, com ${mortes} morte(s) declarada(s)`);
  console.log(`  janela varrida: 0x${de.toString(16)}..0x${ate.toString(16)}  (${(ate - de) / 4} palavras de 32 bits)`);
  console.log(`  palavras que mudaram: ${mudaram}`);
  console.log(`  subiram exatamente ${mortes}: ${candidatos.length}\n`);

  if (!candidatos.length) {
    console.log('  Nenhum candidato. Ou o save não guarda a contagem de mortes,');
    console.log('  ou o número de mortes declarado não foi o que aconteceu, ou o');
    console.log('  jogo ainda não tinha salvo. Confira e repita.');
    return { candidatos: [] };
  }

  for (const c of candidatos) {
    console.log(`    0x${c.offset.toString(16).padStart(6, '0')}   ${c.de} -> ${c.para}`);
  }

  // Interseção com uma rodada anterior, se existir: é o que realmente decide.
  const anterior = path.join(SNAP_DIR, 'mortes-candidatos.json');
  let antes = null;
  try { antes = JSON.parse(fs.readFileSync(anterior, 'utf8')); } catch (e) { antes = null; }
  if (antes && Array.isArray(antes.offsets) && antes.offsets.length) {
    const comuns = candidatos.filter((c) => antes.offsets.includes(c.offset));
    console.log(`\n  cruzando com a rodada anterior (${antes.mortes} morte(s), ${antes.offsets.length} candidatos):`);
    if (!comuns.length) {
      console.log('    nenhum offset sobreviveu às duas rodadas.');
    } else if (comuns.length === 1) {
      console.log(`    >>> sobrou um só: 0x${comuns[0].offset.toString(16)} = ${comuns[0].para} mortes`);
      console.log('    Grave no offsets.json em deathCount.offset e pronto.');
    } else {
      console.log(`    ${comuns.length} sobreviveram; rode mais uma vez com outro número de mortes:`);
      for (const c of comuns) console.log(`      0x${c.offset.toString(16)} = ${c.para}`);
    }
  } else {
    console.log('\n  Rode de novo com um número DIFERENTE de mortes para cruzar e decidir.');
  }

  fs.writeFileSync(anterior, JSON.stringify({
    mortes, em: new Date().toISOString(), offsets: candidatos.map((c) => c.offset),
  }, null, 2));
  return { candidatos };
}

function main() {
  const [cmd, argA, argB] = process.argv.slice(2);

  try {
    if (!cmd || cmd === 'help' || cmd === '--help') {
      console.log(`
  Descoberta por diff - descubra o que cada byte do save significa.

    node discover.js before         tira o snapshot "before"
    node discover.js after          tira "after" e já compara com "before"
    node discover.js snap <nome>    tira um snapshot com nome livre
    node discover.js diff <a> <b>   compara dois snapshots
    node discover.js list           lista os snapshots
    node discover.js idol           calibra a base de um bloco de Ídolo

  Contagem de mortes: NÃO precisa fazer nada. O serviço acha o offset sozinho
  observando as gravações do save (sync/deaths.js). Os comandos abaixo existem
  só para conferir na mão, caso a busca automática termine sem candidato:
    node discover.js deaths mark            marca o ponto de partida
    node discover.js deaths confirm <n>     n = quantas vezes você morreu desde o mark

  Para os Ídolos:
    1) node discover.js before
    2) descanse num Ídolo que voce AINDA NAO usou
    3) node discover.js snap after
    4) node discover.js idol

  Como usar na prática:
    1) node discover.js before
    2) no jogo: pegue UM item (ou mate UM chefe) e deixe o jogo salvar
       (passar por um Ídolo força o autosave)
    3) node discover.js after
`);
      return;
    }

    if (cmd === 'list') {
      ensureDir();
      const names = fs
        .readdirSync(SNAP_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
      if (!names.length) console.log('  (nenhum snapshot)');
      for (const n of names) {
        const meta = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, `${n}.json`), 'utf8'));
        console.log(`  ${n.padEnd(20)} slot ${meta.slot}  ${meta.takenAt}`);
      }
      return;
    }

    if (cmd === 'diff') {
      printDiff(argA || 'before', argB || 'after');
      return;
    }

    if (cmd === 'idol') {
      calibrarIdolo(argA || 'before', argB || 'after');
      return;
    }

    if (cmd === 'snap' || cmd === 'before' || cmd === 'after') {
      const name = cmd === 'snap' ? argA : cmd;
      if (!name) throw new Error('faltou o nome do snapshot');
      const r = snapshot(name);
      console.log(`  snapshot "${r.name}" salvo (slot ${r.slot}, ${r.goodsCount} itens)`);
      if (cmd === 'after' && fs.existsSync(path.join(SNAP_DIR, 'before.json'))) {
        printDiff('before', 'after');
      } else if (cmd === 'before') {
        console.log('  agora vá fazer UMA coisa no jogo, espere salvar, e rode:');
        console.log('      node discover.js after');
      }
      return;
    }

    throw new Error(`comando desconhecido: ${cmd}`);
  } catch (err) {
    console.error('  erro:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { snapshot, loadSnapshot, diffGoods, diffBytes, printDiff, calibrarIdolo };
