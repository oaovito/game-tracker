'use strict';
/*
 * inventory.js - read the item table out of a Sekiro save slot.
 *
 * Structure (derived empirically from a real save, then cross-checked against
 * the FromSoftware item-id convention):
 *
 *   The slot contains an array of 16-byte records on a 16-byte lattice:
 *       +0x00  uint32  item id, or 0xFFFFFFFF for an empty cell
 *       +0x04  uint32  quantity held
 *       +0x08  uint32  acquisition order / bookkeeping
 *       +0x0C  uint32  chain link to the next record (0xB0000000 | id)
 *
 *   The top nibble of the id is the FromSoftware item category:
 *       0x0  weapon        0x1  protector/prosthetic
 *       0x2  accessory     0x4  goods (consumables, materials, upgrade items)
 *   The remaining 28 bits are the param id, e.g. 0x40000DB6 -> goods 3510.
 *
 * We locate the table structurally rather than by a fixed offset: we find the
 * longest run of empty cells spaced exactly 16 bytes apart, which is a very
 * strong signature and does not move if a game patch shifts the layout. A
 * hardcoded window can be supplied in offsets.json to override this.
 */

const EMPTY = 0xffffffff;
const RECORD_SIZE = 16;

const CATEGORY = {
  0x0: 'weapon',
  0x1: 'protector',
  0x2: 'accessory',
  0x4: 'goods',
};

/**
 * Locate the item table by looking for the longest stride-16 run of empty
 * cells. Returns { start, end, confidence } in payload-relative bytes, or null.
 */
function detectItemTable(payload) {
  const hits = [];
  for (let o = 0; o + 4 <= payload.length; o += RECORD_SIZE) {
    if (payload.readUInt32LE(o) === EMPTY) hits.push(o);
  }
  if (hits.length < 64) return null;

  let best = null;
  let runStart = 0;
  for (let i = 1; i <= hits.length; i++) {
    const broken = i === hits.length || hits[i] - hits[i - 1] !== RECORD_SIZE;
    if (broken) {
      const len = i - runStart;
      if (!best || len > best.len) best = { len, from: hits[runStart], to: hits[i - 1] };
      runStart = i;
    }
  }
  if (!best || best.len < 64) return null;

  // Grow outwards while cells still look like table records, so that occupied
  // rows on either side of the empty run are included.
  let start = best.from;
  let end = best.to + RECORD_SIZE;
  while (start - RECORD_SIZE >= 0 && looksLikeRecord(payload, start - RECORD_SIZE)) {
    start -= RECORD_SIZE;
  }
  while (end + RECORD_SIZE <= payload.length && looksLikeRecord(payload, end)) {
    end += RECORD_SIZE;
  }
  return { start, end, confidence: 'detected', emptyRun: best.len };
}

function looksLikeRecord(payload, o) {
  if (o + RECORD_SIZE > payload.length) return false;
  const id = payload.readUInt32LE(o);
  if (id === EMPTY) return true;
  if (id === 0) return false;
  const cat = id >>> 28;
  if (!(cat in CATEGORY)) return false;
  const qty = payload.readUInt32LE(o + 4);
  return qty <= 9999;
}

/**
 * Read every occupied record in the table.
 * Returns { region, items: [{category, id, paramId, quantity, offset}] }.
 */
function readItemTable(payload, window) {
  const region = window && window.start !== undefined && window.start !== null
    ? { start: window.start, end: window.end, confidence: 'configured' }
    : detectItemTable(payload);

  if (!region) {
    return { region: null, items: [], error: 'item table not found in this slot' };
  }

  const items = [];
  const seen = new Map();
  for (let o = region.start; o + RECORD_SIZE <= Math.min(region.end, payload.length); o += RECORD_SIZE) {
    const id = payload.readUInt32LE(o);
    if (id === EMPTY || id === 0) continue;
    const cat = id >>> 28;
    if (!(cat in CATEGORY)) continue;
    const quantity = payload.readUInt32LE(o + 4);
    if (quantity > 9999) continue;

    const paramId = id & 0x0fffffff;
    const key = CATEGORY[cat] + ':' + paramId;
    // The table is a hash map with chaining; the same id can appear in more
    // than one cell. Keep the highest quantity seen for a given id.
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (quantity > prev.quantity) {
        prev.quantity = quantity;
        prev.offset = o;
      }
      continue;
    }
    const rec = { category: CATEGORY[cat], id, paramId, quantity, offset: o };
    seen.set(key, rec);
    items.push(rec);
  }
  return { region, items };
}

/** paramId -> quantity, for one category (default: goods). */
function quantityMap(items, category) {
  const cat = category || 'goods';
  const out = new Map();
  for (const it of items) {
    if (it.category !== cat) continue;
    out.set(it.paramId, it.quantity);
  }
  return out;
}

module.exports = {
  EMPTY,
  RECORD_SIZE,
  CATEGORY,
  detectItemTable,
  readItemTable,
  quantityMap,
};
