'use strict';
/*
 * qr.js - QR Code encoder, byte mode, versions 1..10, EC levels L/M.
 * Zero dependencies. Runs unchanged in Node and in a browser (used for testing).
 *
 * Only what we need: encode a short URL and render it as ANSI blocks in a
 * terminal. Implements the ISO/IEC 18004 pipeline: bit stream -> Reed-Solomon
 * blocks -> interleave -> module placement -> best-of-8 masking.
 */

// ---------------------------------------------------------------- GF(256)
// Generator polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), the QR standard field.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Reed-Solomon divisor polynomial of the given degree.
function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

// Remainder of data * x^degree divided by the divisor: the EC codewords.
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

// ------------------------------------------------- version capacity tables
// Indexed [version-1]. These are the only table-driven constants; every other
// capacity number is derived, so a mistake here surfaces as a decode failure.
const ECC_PER_BLOCK = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
};
const NUM_BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
};
const ECL_BITS = { L: 1, M: 0 };
const MAX_VERSION = 10;

function sizeForVersion(version) {
  return version * 4 + 17;
}

// Number of data+EC codewords the symbol holds, derived from the module count.
function totalCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    modules -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

function dataCodewords(version, ecl) {
  return (
    totalCodewords(version) -
    ECC_PER_BLOCK[ecl][version - 1] * NUM_BLOCKS[ecl][version - 1]
  );
}

function alignPositions(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = sizeForVersion(version) - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

// -------------------------------------------------------------- bit stream
class BitBuffer {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

function buildCodewords(bytes, version, ecl) {
  const bb = new BitBuffer();
  bb.push(0b0100, 4); // byte mode
  bb.push(bytes.length, version <= 9 ? 8 : 16); // character count
  for (const b of bytes) bb.push(b, 8);

  const capacityBits = dataCodewords(version, ecl) * 8;
  if (bb.length > capacityBits) return null;

  bb.push(0, Math.min(4, capacityBits - bb.length)); // terminator
  bb.push(0, (8 - (bb.length % 8)) % 8); // byte align

  const data = new Uint8Array(dataCodewords(version, ecl));
  for (let i = 0; i < bb.length; i++) {
    data[i >>> 3] |= bb.bits[i] << (7 - (i & 7));
  }
  // Alternating pad bytes, per spec.
  for (let i = Math.ceil(bb.length / 8), pad = 0xec; i < data.length; i++) {
    data[i] = pad;
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return data;
}

// Split into blocks, append EC codewords, interleave.
function interleave(data, version, ecl) {
  const numBlocks = NUM_BLOCKS[ecl][version - 1];
  const eccLen = ECC_PER_BLOCK[ecl][version - 1];
  const raw = totalCodewords(version);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);

  const blocks = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = Array.from(data.slice(k, k + datLen));
    k += datLen;
    const ecc = rsRemainder(Uint8Array.from(dat), divisor);
    if (i < numShort) dat.push(0); // placeholder keeps columns aligned
    blocks.push(dat.concat(Array.from(ecc)));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      // Skip the placeholder cell in short blocks.
      if (i !== shortLen - eccLen || j >= numShort) result.push(blocks[j][i]);
    }
  }
  return Uint8Array.from(result);
}

// ---------------------------------------------------------- module placement
function makeMatrix(version) {
  const size = sizeForVersion(version);
  const grid = [];
  const fixed = [];
  for (let i = 0; i < size; i++) {
    grid.push(new Array(size).fill(false));
    fixed.push(new Array(size).fill(false));
  }
  return { size, grid, fixed };
}

function setFn(m, x, y, dark) {
  if (x < 0 || y < 0 || x >= m.size || y >= m.size) return;
  m.grid[y][x] = dark;
  m.fixed[y][x] = true;
}

function drawFinder(m, cx, cy) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(m, cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlign(m, cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFn(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

// BCH remainder: append `genBits` check bits generated by `generator`.
function bchRemainder(data, generator, genBits) {
  let rem = data;
  for (let i = 0; i < genBits; i++) {
    rem = (rem << 1) ^ (((rem >>> (genBits - 1)) & 1) * generator);
  }
  return rem;
}

function drawFormat(m, ecl, mask) {
  const data = (ECL_BITS[ecl] << 3) | mask;
  const rem = bchRemainder(data, 0x537, 10);
  const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  const bitAt = (i) => ((bits >>> i) & 1) === 1;

  // Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) setFn(m, 8, i, bitAt(i));
  setFn(m, 8, 7, bitAt(6));
  setFn(m, 8, 8, bitAt(7));
  setFn(m, 7, 8, bitAt(8));
  for (let i = 9; i < 15; i++) setFn(m, 14 - i, 8, bitAt(i));

  // Copy 2, split between bottom-left and top-right.
  for (let i = 0; i < 8; i++) setFn(m, m.size - 1 - i, 8, bitAt(i));
  for (let i = 8; i < 15; i++) setFn(m, 8, m.size - 15 + i, bitAt(i));
  setFn(m, 8, m.size - 8, true); // permanently dark module
}

function drawVersion(m, version) {
  if (version < 7) return;
  const rem = bchRemainder(version, 0x1f25, 12);
  const bits = ((version << 12) | rem) & 0x3ffff;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFn(m, a, b, dark);
    setFn(m, b, a, dark);
  }
}

function drawFunctionPatterns(m, version, ecl) {
  // Timing patterns.
  for (let i = 0; i < m.size; i++) {
    setFn(m, 6, i, i % 2 === 0);
    setFn(m, i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, m.size - 4, 3);
  drawFinder(m, 3, m.size - 4);

  const pos = alignPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const skipCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === pos.length - 1) ||
        (i === pos.length - 1 && j === 0);
      if (!skipCorner) drawAlign(m, pos[i], pos[j]);
    }
  }
  drawFormat(m, ecl, 0); // placeholder, reserves the cells
  drawVersion(m, version);
}

function drawCodewords(m, codewords) {
  let i = 0;
  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < m.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? m.size - 1 - vert : vert;
        if (!m.fixed[y][x] && i < codewords.length * 8) {
          m.grid[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error('bad mask');
  }
}

function applyMask(m, mask) {
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.fixed[y][x] && maskBit(mask, x, y)) m.grid[y][x] = !m.grid[y][x];
    }
  }
}

// The four standard penalty rules; lower is a more scannable symbol.
function penalty(m) {
  const size = m.size;
  let score = 0;

  const runScore = (run) => (run >= 5 ? 3 + (run - 5) : 0);
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m.grid[y][x] === m.grid[y][x - 1]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m.grid[y][x] === m.grid[y - 1][x]) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m.grid[y][x];
      if (c === m.grid[y][x + 1] && c === m.grid[y + 1][x] && c === m.grid[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  // 1:1:3:1:1 finder-like patterns with 4 modules of quiet space on one side.
  const pat = [true, false, true, true, true, false, true];
  const hasPattern = (get, i, n) => {
    for (let k = 0; k < 7; k++) if (get(i + k) !== pat[k]) return false;
    let quietBefore = true;
    let quietAfter = true;
    for (let k = 1; k <= 4; k++) {
      if (i - k >= 0 && get(i - k)) quietBefore = false;
      if (i + 6 + k < n && get(i + 6 + k)) quietAfter = false;
    }
    return quietBefore || quietAfter;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 7 <= size; x++) {
      if (hasPattern((i) => m.grid[y][i], x, size)) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y + 7 <= size; y++) {
      if (hasPattern((i) => m.grid[i][x], y, size)) score += 40;
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m.grid[y][x]) dark++;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

// --------------------------------------------------------------- public API
/** Encode `text`; returns { size, grid, version, mask, ecl }. grid[y][x] true = dark. */
function encode(text, ecl) {
  const level = ecl || 'L';
  const bytes =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(text)
      : Uint8Array.from(Buffer.from(text, 'utf8'));

  let version = 0;
  let data = null;
  for (let v = 1; v <= MAX_VERSION; v++) {
    data = buildCodewords(bytes, v, level);
    if (data) {
      version = v;
      break;
    }
  }
  if (!version) {
    throw new Error('text too long for QR version <= ' + MAX_VERSION + ' (' + bytes.length + ' bytes)');
  }

  const codewords = interleave(data, version, level);
  const m = makeMatrix(version);
  drawFunctionPatterns(m, version, level);
  drawCodewords(m, codewords);

  // Pick the lowest-penalty mask.
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(m, mask);
    drawFormat(m, level, mask);
    const score = penalty(m);
    if (best === null || score < best.score) {
      best = { mask, score, grid: m.grid.map((row) => row.slice()) };
    }
    applyMask(m, mask); // XOR is its own inverse
  }
  return { size: m.size, grid: best.grid, version, mask: best.mask, ecl: level };
}

/**
 * Render as ANSI background blocks. Uses explicit black/white backgrounds so the
 * symbol scans correctly whatever colour scheme the terminal uses, and includes
 * a quiet zone.
 */
function toAnsi(qr, quiet) {
  const q = quiet === undefined ? 2 : quiet;
  const LIGHT = '\x1b[47m  \x1b[0m';
  const DARK = '\x1b[40m  \x1b[0m';
  const width = qr.size + q * 2;
  const blank = LIGHT.repeat(width);
  const lines = [];
  for (let i = 0; i < q; i++) lines.push(blank);
  for (let y = 0; y < qr.size; y++) {
    let line = LIGHT.repeat(q);
    for (let x = 0; x < qr.size; x++) line += qr.grid[y][x] ? DARK : LIGHT;
    line += LIGHT.repeat(q);
    lines.push(line);
  }
  for (let i = 0; i < q; i++) lines.push(blank);
  return lines.join('\n');
}

/** Plain-ASCII fallback for terminals without colour support. */
function toAscii(qr, quiet) {
  const q = quiet === undefined ? 2 : quiet;
  const width = qr.size + q * 2;
  const lines = [];
  for (let i = 0; i < q; i++) lines.push('  '.repeat(width));
  for (let y = 0; y < qr.size; y++) {
    let line = '  '.repeat(q);
    for (let x = 0; x < qr.size; x++) line += qr.grid[y][x] ? '##' : '  ';
    lines.push(line + '  '.repeat(q));
  }
  for (let i = 0; i < q; i++) lines.push('  '.repeat(width));
  return lines.join('\n');
}

const api = { encode, toAnsi, toAscii };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SekiroQR = api;
