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
 * MAS a Steam não é obrigatória. Instalado numa máquina sem ela, ou com o
 * jogo vindo de outro lugar, o tempo continua existindo: o próprio save
 * guarda o tempo interno de jogo, em segundos, no bloco de stats do slot
 * (`slotFields.igtSegundos`). Esse offset não estava publicado em lugar
 * nenhum e foi achado aqui, varrendo o slot atrás do valor que a leitura de
 * memória já dava — ver a nota no offsets.json.
 *
 * Os dois números medem coisas diferentes e por isso não se somam nem se
 * substituem em silêncio:
 *
 *   steam : relógio de parede, conta menu, pausa e carregamento
 *   jogo  : tempo interno, só o que o jogo conta como jogado
 *
 * Quando as duas existem, a da Steam manda (é a que o usuário reconhece do
 * perfil dele) e a do jogo vira conferência: se a interna passar da de
 * relógio, alguma das duas leituras está errada, porque o relógio é sempre o
 * maior dos dois. É essa checagem que prova que o caminho sem Steam funciona,
 * usando a Steam como gabarito enquanto ela está por perto.
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

/**
 * Tempo interno lido do save, em segundos.
 *
 * Recebe o payload do slot já escolhido, porque quem sabe qual slot está
 * ativo é o parse — e ler o slot errado daria o tempo de outro personagem,
 * que foi exatamente como o offset se confirmou.
 */
function doSave(payload, config) {
  const campo = config && config.slotFields && config.slotFields.igtSegundos;
  if (!campo || !payload) return null;
  const off = campo.offset;
  if (!(off >= 0) || off + 4 > payload.length) return null;
  const seg = payload.readUInt32LE(off);
  // Um save recém-criado tem tempo baixo mas real; o que não é real é lixo de
  // ponteiro, que aparece como número absurdo. 10 mil horas é mais que o
  // recorde de qualquer pessoa e bem abaixo de qualquer valor acidental.
  if (!(seg > 0) || seg > 10000 * 3600) return null;
  return seg;
}

/** { minutos, horas, ultimaVez, fonte, conferencia } ou null quando não dá para saber. */
function tempoDeJogo(opts) {
  const o = opts || {};
  const doJogo = (typeof o.internoSegundos === "number" && o.internoSegundos > 0)
    ? o.internoSegundos : null;
  const semSteam = () => (doJogo === null ? null : {
    minutos: Math.round(doJogo / 60),
    horas: doJogo / 3600,
    ultimaVez: null,
    fonte: "jogo",
    internoSegundos: doJogo,
  });

  const steam = o.steam || instalacao.steamPath();
  if (!steam) return semSteam();
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
        internoSegundos: doJogo,
        // A conferência do parágrafo do cabeçalho: relógio de parede tem de ser
        // maior que tempo interno. Falso aqui é sinal de leitura errada, não de
        // jogo estranho.
        conferencia: doJogo === null ? null : {
          relogioSegundos: r.minutos * 60,
          jogoSegundos: doJogo,
          coerente: doJogo <= r.minutos * 60,
        },
      };
    }
  }
  return semSteam();
}

module.exports = { tempoDeJogo, lerLocalConfig, contaDoSave, doSave, APP_ID };

if (require.main === module) {
  const sl2 = require('./sl2');
  const t = tempoDeJogo({ save: sl2.findSavePath() });
  if (!t) { console.log('  não consegui ler o tempo de jogo'); process.exitCode = 1; }
  else console.log(`  ${t.minutos} min = ${t.horas.toFixed(1)} h  (última vez: ${t.ultimaVez})`);
}
