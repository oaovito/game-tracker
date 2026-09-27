'use strict';
/*
 * tempo.js - quantas horas de jogo.
 *
 * Isto NÃO sai do save. Procurei lá primeiro e o que aparece são dezenas de
 * inteiros numa faixa plausível, nenhum distinguível dos outros sem uma
 * diferença medida com o jogo aberto. O Steam, por outro lado, já guarda a
 * conta pronta e exata:
 *
 *     Steam/userdata/<conta>/config/localconfig.vdf
 *       "814380" { "Playtime" "4386"  "LastPlayed" "1790527827" }
 *
 * Playtime vem em minutos, LastPlayed em época unix.
 *
 * O arquivo é escrito pelo Steam quando o jogo fecha e quando ele sincroniza,
 * então durante uma sessão longa o número fica parado e só sobe no fim. É uma
 * limitação real e está dita na página: melhor um número exato atrasado do que
 * um número inventado em tempo real.
 */

const fs = require('fs');
const path = require('path');
const instalacao = require('./instalacao');

const APP_ID = '814380';
// SteamID64 = Steam3 + esta base. A pasta em userdata usa o Steam3.
const BASE_STEAMID64 = 76561197960265728n;

/** Deriva o id de conta (Steam3) a partir do caminho do save, que usa o ID64. */
function contaDoSave(caminhoSave) {
  if (!caminhoSave) return null;
  const m = /(\d{17})/.exec(caminhoSave.replace(/\\/g, '/'));
  if (!m) return null;
  try { return Number(BigInt(m[1]) - BASE_STEAMID64); } catch (e) { return null; }
}

/** Todas as contas que têm userdata, para o caso de o caminho do save não ajudar. */
function contasDisponiveis(steam) {
  try {
    return fs.readdirSync(path.join(steam, 'userdata'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
      .map((d) => Number(d.name));
  } catch (e) { return []; }
}

/**
 * Lê Playtime e LastPlayed do bloco do app.
 *
 * O arquivo tem o id do app em mais de um lugar — um deles é um blob binário de
 * licença, sem tempo nenhum. Por isso não basta achar o id: é preciso achar a
 * ocorrência que traz os campos de tempo logo depois.
 */
function lerLocalConfig(arquivo) {
  let txt;
  try { txt = fs.readFileSync(arquivo, 'utf8'); } catch (e) { return null; }
  const alvo = `"${APP_ID}"`;
  let i = -1;
  while ((i = txt.indexOf(alvo, i + 1)) !== -1) {
    const trecho = txt.slice(i, i + 400);
    const pt = /"Playtime"\s+"(\d+)"/.exec(trecho);
    if (!pt) continue;
    const lp = /"LastPlayed"\s+"(\d+)"/.exec(trecho);
    return {
      minutos: Number(pt[1]),
      ultimaVez: lp ? new Date(Number(lp[1]) * 1000).toISOString() : null,
    };
  }
  return null;
}

/** { minutos, horas, ultimaVez, fonte } ou null quando não dá para saber. */
function tempoDeJogo(opts) {
  const o = opts || {};
  const steam = o.steam || instalacao.steamPath();
  if (!steam) return null;

  const contas = [];
  const daSave = contaDoSave(o.save);
  if (daSave) contas.push(daSave);
  for (const c of contasDisponiveis(steam)) if (!contas.includes(c)) contas.push(c);

  for (const conta of contas) {
    const arquivo = path.join(steam, 'userdata', String(conta), 'config', 'localconfig.vdf');
    const r = lerLocalConfig(arquivo);
    if (r && r.minutos > 0) {
      return {
        minutos: r.minutos,
        horas: r.minutos / 60,
        ultimaVez: r.ultimaVez,
        fonte: 'steam',
      };
    }
  }
  return null;
}

module.exports = { tempoDeJogo, lerLocalConfig, contaDoSave, APP_ID };

if (require.main === module) {
  const sl2 = require('./sl2');
  const t = tempoDeJogo({ save: sl2.findSavePath() });
  if (!t) { console.log('  não consegui ler o tempo de jogo'); process.exitCode = 1; }
  else console.log(`  ${t.minutos} min = ${t.horas.toFixed(1)} h  (última vez: ${t.ultimaVez})`);
}
