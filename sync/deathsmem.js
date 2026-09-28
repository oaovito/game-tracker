'use strict';
/*
 * deathsmem.js - contagem de mortes lida da memória do jogo, em tempo real.
 *
 * Por que isto substitui o método antigo. A contagem anterior era deduzida do
 * save: uma morte só aparecia quando custava Sen, e o Unseen Aid anula essa
 * perda em parte das vezes — o número era um piso declarado, nunca o total. E
 * só atualizava quando o jogo gravava.
 *
 * Na memória o contador do próprio jogo existe e é exato. O que falta é saber
 * ONDE ele está, e isso nenhuma fonte pública documenta para o Sekiro. Então é
 * achado por diferença, do mesmo jeito que se achou a base das event flags —
 * mas agora em segundos, porque dá para tirar uma foto da memória a qualquer
 * momento, em vez de esperar o jogo gravar.
 *
 * O procedimento é:
 *
 *   npm run deaths mark        tira a foto
 *   (morra no jogo)
 *   npm run deaths confirm 1   compara e guarda os candidatos
 *   (repita com outro número)  o cruzamento decide
 *
 * Duas rodadas com números diferentes bastam: um contador de quadros ou de
 * saves não sobe pelo mesmo tanto nas duas.
 *
 * Nada aqui escreve no jogo. O handle é aberto sem PROCESS_VM_WRITE.
 */

const fs = require('fs');
const path = require('path');
const memoria = require('./memoria');

const ESTADO = path.join(__dirname, '..', 'deaths-mem.json');
const FOTO = path.join(__dirname, 'snapshots', 'mem-mortes.bin');

function carregar() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch (e) { return null; }
}

function gravar(e) {
  const tmp = ESTADO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(e, null, 1));
  fs.renameSync(tmp, ESTADO);
}

/** Tira a foto da região estática do módulo do jogo. */
function marcar() {
  const c = memoria.conectar();
  if (!c.ok) return { ok: false, erro: c.erro || 'jogo fechado' };
  fs.mkdirSync(path.dirname(FOTO), { recursive: true });
  const r = memoria.executar([{
    tipo: 'snapshot', nome: 'f', arquivo: FOTO, inicio: c.base, tamanho: c.tamanho,
  }], { timeout: 120000 });
  if (!r.ok) return { ok: false, erro: r.erro };
  const e = carregar() || {};
  e.base = c.base;
  e.tamanho = c.tamanho;
  e.fotoEm = new Date().toISOString();
  gravar(e);
  return { ok: true, bytes: c.tamanho, base: c.base };
}

/**
 * Compara com a foto e mantém só quem subiu exatamente `mortes`.
 * O cruzamento com a rodada anterior é o que decide.
 */
function confirmar(mortes) {
  const e = carregar();
  if (!e || !e.base) return { ok: false, erro: 'tire a foto primeiro: npm run deaths mark' };
  const c = memoria.conectar();
  if (!c.ok) return { ok: false, erro: c.erro || 'jogo fechado' };
  if (c.base !== e.base) {
    // O jogo foi reiniciado e o módulo carregou noutro lugar: a foto não vale.
    return { ok: false, erro: 'o jogo reiniciou desde a foto; tire outra' };
  }
  const r = memoria.executar([{
    tipo: 'diff', nome: 'd', arquivo: FOTO, inicio: e.base, tamanho: e.tamanho, delta: mortes,
  }], { timeout: 180000 });
  if (!r.ok || !r.res || !r.res.d) return { ok: false, erro: r.erro || 'diff falhou' };

  const achados = (r.res.d.offsets || []).map(Number);
  const antes = e.candidatos;
  let candidatos;
  if (Array.isArray(antes) && antes.length) {
    const s = new Set(achados);
    candidatos = antes.filter((o) => s.has(o));
  } else {
    candidatos = achados;
  }

  e.candidatos = candidatos;
  e.ultimaRodada = { mortes, brutos: r.res.d.total, em: new Date().toISOString() };
  if (candidatos.length === 1 && Array.isArray(antes)) {
    e.offset = candidatos[0];
    e.resolvidoEm = new Date().toISOString();
  }
  gravar(e);
  return {
    ok: true,
    brutos: r.res.d.total,
    candidatos: candidatos.length,
    offset: e.offset || null,
    cruzou: Array.isArray(antes) && antes.length > 0,
  };
}

/**
 * Confirma sem que ninguém precise ter contado as mortes.
 *
 * O `confirmar` acima exige o número exato, e isso obriga quem está jogando a
 * contar — o que é fácil de errar e, errado, elimina justamente o offset certo.
 * Aqui a memória é varrida uma vez só e os deslocamentos são separados em
 * baldes por quanto subiram. O contador de mortes está no balde `d`, onde `d`
 * é quantas vezes se morreu; não se sabe qual é, mas sabe-se que ele existe.
 *
 * Duas rodadas resolvem. Para cada par de baldes (um de cada rodada), cruzam-se
 * os deslocamentos; o offset verdadeiro aparece em exatamente um par, porque
 * qualquer outro contador que tenha subido junto numa rodada dificilmente sobe
 * na proporção certa na outra. Quando o cruzamento deixa um só, está achado.
 *
 * O teto de 20 existe porque acima disso não é morte: é contador de quadro, de
 * tique de relógio, de partícula. Morrer mais de vinte vezes entre duas fotos
 * é possível, e nesse caso o balde certo fica de fora e a rodada não resolve —
 * o que o código diz, em vez de inventar um offset.
 */
const TETO_MORTES = 20;

function varrer() {
  const e = carregar();
  if (!e || !e.base) return { ok: false, erro: 'tire a foto primeiro: npm run deaths mark' };
  const c = memoria.conectar();
  if (!c.ok) return { ok: false, erro: c.erro || 'jogo fechado' };
  if (c.base !== e.base) return { ok: false, erro: 'o jogo reiniciou desde a foto; tire outra' };

  const r = memoria.executar([{
    tipo: 'varredura', nome: 'v', arquivo: FOTO,
    inicio: e.base, tamanho: e.tamanho, maxDelta: TETO_MORTES,
  }], { timeout: 240000 });
  if (!r.ok || !r.res || !r.res.v) return { ok: false, erro: r.erro || 'varredura falhou' };

  const baldes = {};
  for (const [d, offs] of Object.entries(r.res.v.baldes || {})) {
    baldes[d] = (offs || []).map(Number);
  }

  const rodadas = Array.isArray(e.rodadas) ? e.rodadas : [];
  rodadas.push({ baldes, em: new Date().toISOString() });
  e.rodadas = rodadas.slice(-3);          // três bastam; guardar mais é peso à toa
  e.fotoEm = null;                        // a foto foi consumida por esta rodada

  // Cruza a última rodada com cada anterior, balde a balde.
  let achado = null;
  const pares = [];
  for (let i = 0; i < e.rodadas.length - 1; i++) {
    const antiga = e.rodadas[i].baldes;
    for (const [da, offsA] of Object.entries(antiga)) {
      const setA = new Set(offsA);
      for (const [db, offsB] of Object.entries(baldes)) {
        const comum = offsB.filter((o) => setA.has(o));
        if (!comum.length) continue;
        pares.push({ da: Number(da), db: Number(db), n: comum.length, offsets: comum });
        if (comum.length === 1) achado = { offset: comum[0], da: Number(da), db: Number(db) };
      }
    }
  }

  // Havendo mais de um par com um só deslocamento, não dá para escolher entre
  // eles sem chutar — e chutar aqui grava um offset errado como se fosse certo.
  const unicos = pares.filter((p) => p.n === 1);
  if (unicos.length === 1) {
    e.offset = unicos[0].offsets[0];
    e.resolvidoEm = new Date().toISOString();
    achado = { offset: e.offset, da: unicos[0].da, db: unicos[0].db };
  } else {
    achado = null;
  }

  e.candidatos = achado ? [achado.offset] : [];
  e.ultimaRodada = {
    baldes: Object.keys(baldes).length,
    total: Object.values(baldes).reduce((a, b) => a + b.length, 0),
    em: new Date().toISOString(),
  };
  gravar(e);

  return {
    ok: true,
    rodadas: e.rodadas.length,
    baldes: Object.keys(baldes).length,
    total: e.ultimaRodada.total,
    pares: pares.length,
    unicos: unicos.length,
    offset: achado ? achado.offset : null,
    mortes: achado ? { rodada1: achado.da, rodada2: achado.db } : null,
  };
}

/** A contagem agora, se já houver offset e o jogo estiver aberto. */
function contagem() {
  const e = carregar();
  if (!e || typeof e.offset !== 'number') return null;
  const c = memoria.conectar();
  if (!c.ok) return null;
  const b = memoria.ler(c.base + e.offset, 4);
  if (!b) return null;
  const n = b.readUInt32LE(0);
  if (n > 100000) return null;                     // valor absurdo: offset errado
  return { mortes: n, fonte: 'memoria', offset: e.offset, em: new Date().toISOString() };
}

function estado() {
  const e = carregar();
  if (!e) return { calibrado: false, candidatos: 0 };
  return {
    calibrado: typeof e.offset === 'number',
    offset: e.offset || null,
    candidatos: (e.candidatos || []).length,
    ultimaRodada: e.ultimaRodada || null,
  };
}

module.exports = { marcar, confirmar, varrer, contagem, estado, carregar, ESTADO, FOTO, TETO_MORTES };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'mark') {
    const r = marcar();
    console.log(r.ok
      ? `  foto de ${(r.bytes / 1048576).toFixed(1)} MB tirada.\n  Agora morra no jogo e rode: npm run deaths confirm <quantas vezes>`
      : `  ${r.erro}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === 'confirm') {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1) { console.log('  use: deaths confirm <quantas mortes>'); process.exitCode = 1; }
    else {
      const r = confirmar(n);
      if (!r.ok) { console.log('  ' + r.erro); process.exitCode = 1; }
      else if (r.offset !== null) console.log(`  resolvido: offset 0x${r.offset.toString(16)} — o contador está no ar`);
      else if (r.cruzou) console.log(`  ${r.candidatos} candidatos depois do cruzamento; rode outra rodada com número diferente`);
      else console.log(`  ${r.candidatos} candidatos (de ${r.brutos}). Tire outra foto e repita com número diferente.`);
    }
  } else {
    const e = estado();
    console.log(`  calibrado: ${e.calibrado ? 'sim, offset 0x' + e.offset.toString(16) : 'não'}  |  candidatos: ${e.candidatos}`);
    const c = contagem();
    if (c) console.log(`  mortes agora: ${c.mortes}`);
  }
}
