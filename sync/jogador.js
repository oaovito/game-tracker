'use strict';
/*
 * jogador.js - de quem é este progresso.
 *
 * A assinatura do cabeçalho era a palavra "oaovito", escrita à mão no HTML.
 * Isso funciona numa máquina só e mente em qualquer outra: instalado no PC de
 * outra pessoa, o tracker anunciava o progresso dela com o nome de quem
 * escreveu a página.
 *
 * O nome certo é o apelido do Steam (PersonaName), que é o nome público da
 * conta - o mesmo que aparece na lista de amigos e no perfil. Ele mora em:
 *
 *     Steam/config/loginusers.vdf
 *       "76561198xxxxxxxxx" { "AccountName" "..." "PersonaName" "fulano" }
 *
 * Duas coisas que este módulo NÃO faz, de propósito:
 *
 *   - não lê `AccountName`. Esse é o nome de login da conta, e o projeto
 *     publica o que lê. Apelido é público por natureza; nome de login não é,
 *     e não há motivo nenhum para ele entrar no processo.
 *   - não inventa um nome quando não há Steam. Devolve null, e o cabeçalho
 *     some inteiro - ver o comentário da assinatura na página. Um "player"
 *     genérico seria pior que a ausência: ocuparia o mesmo espaço dizendo
 *     nada.
 *
 * Quando há mais de uma conta no arquivo, quem decide é o SteamID64 do save
 * que está sendo lido. Pegar a primeira daria o apelido de outra pessoa numa
 * máquina de família.
 */

const fs = require('fs');
const path = require('path');
const instalacao = require('./instalacao');

/**
 * Todos os blocos de conta do loginusers.vdf: { id64, persona }.
 *
 * O formato é VDF e a estrutura é rasa - id da conta, e dentro dele os campos.
 * Interpretar o formato inteiro seria trabalho para nada: basta casar o id
 * seguido do PersonaName que vem logo depois, dentro do mesmo bloco.
 */
function contasDoArquivo(texto) {
  const fora = [];
  const re = /"(7656119\d{10})"\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(texto))) {
    const persona = /"PersonaName"\s+"([^"]*)"/.exec(m[2]);
    if (persona && persona[1].trim()) fora.push({ id64: m[1], persona: persona[1].trim() });
  }
  return fora;
}

/** O SteamID64 que aparece no caminho do save: é a pasta em que ele mora. */
function id64DoSave(caminhoSave) {
  if (!caminhoSave) return null;
  const m = /(7656119\d{10})/.exec(String(caminhoSave).replace(/\\/g, '/'));
  return m ? m[1] : null;
}

/**
 * { nick, fonte } ou null.
 *
 * `fonte` existe para a página poder dizer a verdade sobre o que está
 * mostrando, e para o teste poder cobrar que ela não invente.
 */
/*
 * O nome escolhido na própria página, gravado em jogador.json.
 *
 * É o caminho sem Steam: numa máquina sem ela, a pessoa dá o nome uma vez e
 * o cabeçalho passa a tê-lo. Com a Steam presente, o escolhido continua
 * mandando -- é uma decisão de quem usa -- e o apelido da Steam vai junto só
 * como conferência.
 */
const ESCOLHIDO = path.join(__dirname, '..', 'jogador.json');

function escolhido(arq) {
  try {
    const j = JSON.parse(fs.readFileSync(arq || ESCOLHIDO, 'utf8'));
    const nick = limpar(j.nick);
    return nick || null;
  } catch (e) { return null; }
}

/** Nome de cabeçalho: uma linha, sem controle, até 32 caracteres. */
function limpar(nick) {
  return String(nick || '').replace(/[\u0000-\u001f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/** Grava (ou apaga, com nome vazio) o nome escolhido. */
function escolher(nick, arq) {
  const n = limpar(nick);
  const alvo = arq || ESCOLHIDO;
  if (!n) { try { fs.unlinkSync(alvo); } catch (e) { /* já não havia */ } return null; }
  fs.writeFileSync(alvo, JSON.stringify({ nick: n }, null, 2) + '\n');
  return n;
}

function quem(opts) {
  const o = opts || {};
  const meu = escolhido(o.arquivo);
  const daSteam = doSteam(o);
  if (meu) return { nick: meu, fonte: 'escolhido', steam: daSteam ? daSteam.nick : null };
  return daSteam;
}

function doSteam(opts) {
  const o = opts || {};
  const steam = o.steam || instalacao.steamPath();
  if (!steam) return null;

  let texto;
  try { texto = fs.readFileSync(path.join(steam, 'config', 'loginusers.vdf'), 'utf8'); } catch (e) { return null; }

  const contas = contasDoArquivo(texto);
  if (!contas.length) return null;

  const alvo = id64DoSave(o.save);
  const escolhida = (alvo && contas.find((c) => c.id64 === alvo)) || (contas.length === 1 ? contas[0] : null);
  if (!escolhida) return null;

  return { nick: escolhida.persona, fonte: 'steam' };
}

module.exports = { quem, escolher, escolhido, limpar, contasDoArquivo, id64DoSave, ESCOLHIDO };

if (require.main === module) {
  const sl2 = require('./sl2');
  const r = quem({ save: sl2.findSavePath() });
  if (!r) console.log('  sem Steam identificado: o cabeçalho fica só com o título');
  else console.log(`  ${r.nick}  (${r.fonte})`);
}
