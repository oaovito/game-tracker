'use strict';
/**
 * A busca de jogos pelo nome, da tela "All games".
 *
 * Procura em tudo o que o aplicativo conhece: os jogos desta máquina e da
 * biblioteca da Steam (a lista de jogos.js), a base que vem com a release e o
 * catálogo geral da Steam guardado em cache. Nada aqui vai à rede nem guarda
 * dado novo; é só leitura do que já existe.
 *
 * A base tem perto de duzentos mil nomes. Ela entra na memória na primeira
 * busca e sai sozinha um minuto depois da última, para o serviço não carregar
 * esse peso enquanto ninguém procura.
 */
const fs = require('fs');
const path = require('path');

const CACHE_STEAM = path.join(__dirname, 'cache', 'catalogo-steam.json');
const SOLTAR_EM = 60 * 1000;

let indice = null;
let soltar = null;

/** Minúsculas, sem acento e sem pontuação, com um espaço entre as palavras. */
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ').trim();
}

/** Os appIds dos jogos populares (a lista do projeto e a da Steam em cache). */
function popularesIds() {
  const ids = new Set();
  try { for (const g of require('./populares.json').lista || []) if (g.appId) ids.add(String(g.appId)); } catch (e) { /* sem lista */ }
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'cache', 'populares-steam.json'), 'utf8'));
    for (const g of (Array.isArray(c) ? c : [])) if (g && g.appId) ids.add(String(g.appId));
  } catch (e) { /* sem cache */ }
  return ids;
}

function carregar() {
  if (indice) return indice;
  const nomes = {};
  try { Object.assign(nomes, (require('./gerar-catalogo').ler() || {}).jogos || {}); } catch (e) { /* sem base */ }
  try { Object.assign(nomes, JSON.parse(fs.readFileSync(CACHE_STEAM, 'utf8'))); } catch (e) { /* sem cache */ }
  indice = Object.keys(nomes).map((id) => [id, nomes[id], normalizar(nomes[id])]);
  return indice;
}

function agendarSoltura() {
  clearTimeout(soltar);
  soltar = setTimeout(() => { indice = null; }, SOLTAR_EM);
  if (soltar.unref) soltar.unref();
}

/** Quanto o nome combina com a busca; 0 é não combina. */
function nota(nome, q, palavras) {
  if (nome === q) return 100;
  if (nome.startsWith(q + ' ')) return 85;
  if (nome.startsWith(q)) return 70;
  if (!palavras.every((p) => nome.includes(p))) return 0;
  if ((' ' + nome).includes(' ' + q)) return 60;
  return 40;
}

/**
 * Até `limite` jogos: { chave, nome, appId, instalado, naSteam, vigiado,
 * leitura, conhecido }. Os conhecidos (desta máquina ou da biblioteca) vêm
 * antes, depois os populares, e dentro de cada nível o nome mais curto.
 */
function buscar(texto, limite) {
  const q = normalizar(texto);
  const max = Math.max(1, Math.min(limite || 60, 120));
  if (q.length < 2) return [];
  const palavras = q.split(' ');
  let lista = [];
  try { lista = ((require('./jogos').paraProgresso() || {}).lista) || []; } catch (e) { lista = []; }

  const achados = [];
  const vistos = new Set();
  for (const g of lista) {
    const n = nota(normalizar(g.nome), q, palavras);
    if (!n) continue;
    if (g.appId) vistos.add(String(g.appId));
    achados.push({ n: n + 10, tam: String(g.nome).length, jogo: Object.assign({}, g, { conhecido: true }) });
  }
  const pop = popularesIds();
  for (const [id, nome, norm] of carregar()) {
    if (vistos.has(id)) continue;
    let n = nota(norm, q, palavras);
    if (n && pop.has(id)) n += 15;
    if (!n) continue;
    achados.push({ n, tam: nome.length, jogo: {
      chave: 'steam-' + id, nome, appId: id, instalado: false, naSteam: false,
      vigiado: false, leitura: 'nenhuma', conhecido: false,
    } });
  }
  agendarSoltura();
  achados.sort((a, b) => b.n - a.n || a.tam - b.tam || a.jogo.nome.localeCompare(b.jogo.nome));
  return achados.slice(0, max).map((a) => a.jogo);
}

module.exports = { buscar, normalizar };
