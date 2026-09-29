'use strict';
/*
 * sl2.js - locate and read Sekiro's S0000.sl2 save file. READ ONLY.
 *
 * Format (verified empirically against a real Sekiro save, not guessed):
 *   - The file is a plain BND4 archive. Sekiro does NOT encrypt its save,
 *     unlike Dark Souls 3 / Elden Ring, so no AES key is needed.
 *   - Header: "BND4" magic, entry count at 0x0C, header size at 0x10 (0x40),
 *     version string at 0x18, per-entry header size at 0x20 (0x20 = 32).
 *   - 12 entries named USER_DATA000 .. USER_DATA011.
 *       USER_DATA000..009  1 MiB each  - the ten character save slots
 *       USER_DATA010       384 KiB     - shared/global data
 *       USER_DATA011       1 MiB       - unused in the saves observed
 *   - Every entry's data begins with a 16-byte MD5 of the bytes that follow.
 *     That gives us a free integrity check: if the digest does not match we
 *     read the file mid-write (a torn read) and must retry rather than report
 *     garbage. This was confirmed on all 12 blocks of a live save.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CHECKSUM_LEN = 16;
const SLOT_COUNT = 10;

// ------------------------------------------------------------ save location
// Sekiro's Steam app id, used for the Proton compatdata path on Linux.
const STEAM_APP_ID = '814380';

function existingDir(p) {
  try {
    return fs.statSync(p).isDirectory() ? p : null;
  } catch (e) {
    return null;
  }
}

/** Candidate "Sekiro" roots that contain per-SteamID subdirectories. */
function sekiroRoots() {
  const roots = [];
  const push = (p) => {
    const d = p && existingDir(p);
    if (d && !roots.includes(d)) roots.push(d);
  };

  if (process.platform === 'win32') {
    push(path.join(process.env.APPDATA || '', 'Sekiro'));
  } else {
    // Steam Deck / Linux via Proton: the prefix mirrors the Windows layout.
    const home = os.homedir();
    const steamDirs = [
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, '.steam', 'steam'),
      path.join(home, '.steam', 'root'),
      path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    ];
    for (const steam of steamDirs) {
      push(
        path.join(
          steam, 'steamapps', 'compatdata', STEAM_APP_ID, 'pfx', 'drive_c',
          'users', 'steamuser', 'AppData', 'Roaming', 'Sekiro'
        )
      );
    }
    // A Wine prefix the user set up by hand.
    push(path.join(home, '.wine', 'drive_c', 'users', os.userInfo().username, 'AppData', 'Roaming', 'Sekiro'));
  }
  return roots;
}

/**
 * Find S0000.sl2. Returns the most recently modified match, so that a machine
 * with several Steam accounts picks the one actually being played.
 * Returns null when nothing is found.
 */
function findSavePath() {
  // Override explícito: útil para quem guarda o save fora do lugar padrão, e
  // para testar o comportamento do serviço quando o save some.
  if (process.env.SEKIRO_SAVE) {
    try {
      if (fs.statSync(process.env.SEKIRO_SAVE).isFile()) return process.env.SEKIRO_SAVE;
    } catch (e) {
      return null;
    }
    return null;
  }

  const found = [];
  for (const root of sekiroRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const candidate = path.join(root, ent.name, 'S0000.sl2');
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) found.push({ file: candidate, mtime: st.mtimeMs, steamId: ent.name });
      } catch (e) {
        /* not this one */
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].file;
}

/** Every save file we can see, newest first. Useful for diagnostics. */
function listSavePaths() {
  const out = [];
  for (const root of sekiroRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const candidate = path.join(root, ent.name, 'S0000.sl2');
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) out.push({ file: candidate, steamId: ent.name, mtime: st.mtimeMs, size: st.size });
      } catch (e) {
        /* skip */
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

// -------------------------------------------------------------- BND4 parsing
class Sl2Error extends Error {}

function parseBnd4(buf) {
  if (buf.length < 0x40) throw new Sl2Error('file is too small to be a BND4 archive');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'BND4') {
    throw new Sl2Error(`expected a BND4 archive, got magic ${JSON.stringify(magic)}`);
  }

  const entryCount = buf.readInt32LE(0x0c);
  const headerSize = Number(buf.readBigInt64LE(0x10));
  const version = buf.toString('ascii', 0x18, 0x20);
  const entryHeaderSize = Number(buf.readBigInt64LE(0x20));

  if (entryCount <= 0 || entryCount > 256) {
    throw new Sl2Error(`implausible entry count ${entryCount}`);
  }
  if (entryHeaderSize !== 0x20) {
    throw new Sl2Error(`unexpected entry header size 0x${entryHeaderSize.toString(16)}`);
  }

  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    const base = headerSize + i * entryHeaderSize;
    if (base + entryHeaderSize > buf.length) throw new Sl2Error('entry table runs past end of file');

    const size = Number(buf.readBigInt64LE(base + 0x08));
    const dataOffset = buf.readUInt32LE(base + 0x10);
    const nameOffset = buf.readInt32LE(base + 0x14);

    let name = '';
    for (let p = nameOffset; p + 1 < buf.length; p += 2) {
      const code = buf.readUInt16LE(p);
      if (code === 0) break;
      name += String.fromCharCode(code);
    }

    if (dataOffset + size > buf.length) {
      throw new Sl2Error(`entry ${name} claims bytes past end of file`);
    }
    if (size <= CHECKSUM_LEN) {
      throw new Sl2Error(`entry ${name} is too small to hold a checksum`);
    }

    entries.push({
      index: i,
      name,
      dataOffset,
      size,
      payloadOffset: dataOffset + CHECKSUM_LEN,
      payloadLength: size - CHECKSUM_LEN,
    });
  }
  return { version, entries };
}

/** The 16-byte digest stored with a block, and the digest of its actual bytes. */
function blockChecksums(buf, entry) {
  const stored = buf.subarray(entry.dataOffset, entry.dataOffset + CHECKSUM_LEN);
  const payload = buf.subarray(entry.payloadOffset, entry.payloadOffset + entry.payloadLength);
  const computed = crypto.createHash('md5').update(payload).digest();
  return { stored, computed, ok: stored.equals(computed) };
}

function blockPayload(buf, entry) {
  return buf.subarray(entry.payloadOffset, entry.payloadOffset + entry.payloadLength);
}

/**
 * Read and validate the save.
 *
 * `retries` covers the case where the game is writing the file as we read it:
 * the MD5 of at least one block will not match, and a moment later it will.
 * We never write to the save, and we open it in a way that tolerates the game
 * holding its own handle open.
 */
function readSave(file, options) {
  const opts = options || {};
  const retries = opts.retries === undefined ? 6 : opts.retries;
  const delayMs = opts.delayMs === undefined ? 250 : opts.delayMs;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) sleepSync(delayMs);
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch (e) {
      lastError = e;
      continue;
    }
    let parsed;
    try {
      parsed = parseBnd4(buf);
    } catch (e) {
      lastError = e;
      continue;
    }

    const bad = [];
    for (const entry of parsed.entries) {
      if (!blockChecksums(buf, entry).ok) bad.push(entry.name);
    }
    if (bad.length === 0) {
      return { file, buf, version: parsed.version, entries: parsed.entries };
    }
    lastError = new Sl2Error(
      `checksum mismatch in ${bad.length} block(s) (${bad.slice(0, 3).join(', ')}) - likely a torn read while the game was saving`
    );
  }
  throw lastError || new Sl2Error('could not read save');
}

// Blocking sleep; the watcher is single-purpose and this keeps retry logic flat.
function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, ms);
}

/** Character slot entries only, in slot order. */
function slotEntries(save) {
  return save.entries
    .filter((e) => /^USER_DATA0*(\d+)$/.test(e.name))
    .filter((e) => {
      const n = parseInt(e.name.replace('USER_DATA', ''), 10);
      return n < SLOT_COUNT;
    })
    .sort((a, b) => a.index - b.index);
}

function globalEntry(save) {
  return save.entries.find((e) => e.name === 'USER_DATA010') || null;
}

/** A slot with only zero bytes has never been written to. */
function isSlotEmpty(save, entry) {
  const payload = blockPayload(save.buf, entry);
  for (let i = 0; i < payload.length; i++) if (payload[i] !== 0) return false;
  return true;
}

function nonEmptySlots(save) {
  return slotEntries(save).filter((e) => !isSlotEmpty(save, e));
}

/*
 * O que o progresso diz quando nao ha save. Sem o nome do arquivo de proposito:
 * a conferencia do publish.js trata qualquer "S0000.sl2" nos dados como sinal
 * de um caminho real, e esta frase vai para o arquivo publico. Com o nome, a
 * propria mensagem era acusada de vazamento e derrubava a instalacao numa
 * maquina sem o save.
 */
const MENSAGEM_SEM_SAVE = 'No Sekiro save found. See the README for the paths searched.';

module.exports = {
  MENSAGEM_SEM_SAVE,
  CHECKSUM_LEN,
  SLOT_COUNT,
  STEAM_APP_ID,
  Sl2Error,
  findSavePath,
  listSavePaths,
  sekiroRoots,
  parseBnd4,
  readSave,
  blockPayload,
  blockChecksums,
  slotEntries,
  globalEntry,
  isSlotEmpty,
  nonEmptySlots,
  sleepSync,
};
