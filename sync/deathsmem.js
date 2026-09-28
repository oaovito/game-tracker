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

module.exports = { marcar, confirmar, contagem, estado, carregar, ESTADO, FOTO };

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
