'use strict';

/**
 * A base de jogos que vai em cada release (sync/catalogo-jogos.json.gz).
 *
 * É com ela que a varredura reconhece um jogo pelo nome da pasta, pelo
 * registro do Windows ou pela Epic, em qualquer disco e fora de qualquer
 * loja. Ela sai com a instalação para que a varredura não dependa da rede
 * nem de um serviço de terceiros no computador de quem usa: a rede, quando
 * há, só acrescenta o que saiu depois da release.
 *
 * Roda na integração contínua, antes de cada release, e a cada quinze dias
 * numa release só dela (ver .github/workflows/catalogo.yml).
 *
 *   node sync/gerar-catalogo.js            grava a base
 *   node sync/gerar-catalogo.js --conferir  só diz quantos jogos a rede traria
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ARQUIVO = path.join(__dirname, 'catalogo-jogos.json.gz');
// Menos que isso é uma fonte quebrada, e não um catálogo: a base anterior fica.
const MINIMO = 20000;

function pedir(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'trackeroao' }, timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(pedir(new URL(res.headers.location, url).toString()));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(url + ': HTTP ' + res.statusCode)); return; }
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(url + ': tempo esgotado')));
    req.on('error', reject);
  });
}

/*
 * As fontes, uma de reserva da outra, todas públicas e sem chave. A lista de
 * apps da Steam traz todo título com página na loja; a lista mantida em
 * jsnli/steamappidlist é a mesma lista já filtrada para jogos.
 */
const FONTES = [
  {
    nome: 'Steam (ISteamApps/GetAppList)',
    url: 'https://api.steampowered.com/ISteamApps/GetAppList/v2/',
    ler: (r) => ((r.applist || {}).apps || []),
  },
  {
    nome: 'jsnli/steamappidlist (jogos)',
    url: 'https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json',
    ler: (r) => (Array.isArray(r) ? r : []),
  },
];

async function coletar() {
  const { NAO_JOGO } = require('./biblioteca');
  const erros = [];
  for (const f of FONTES) {
    try {
      const mapa = {};
      for (const a of f.ler(await pedir(f.url))) {
        const nome = a && String(a.name || '').trim();
        if (!a || !a.appid || !nome || NAO_JOGO.test(nome)) continue;
        mapa[String(a.appid)] = nome;
      }
      const n = Object.keys(mapa).length;
      if (n >= MINIMO) return { fonte: f.nome, jogos: mapa };
      erros.push(`${f.nome}: só ${n} nomes`);
    } catch (e) {
      erros.push(`${f.nome}: ${e.message}`);
    }
  }
  throw new Error('nenhuma fonte respondeu com um catálogo: ' + erros.join('; '));
}

/** A base que veio com esta instalação: { geradoEm, fonte, jogos }, ou null. */
function ler() {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(ARQUIVO)).toString('utf8')); } catch (e) { return null; }
}

async function gerar() {
  const { fonte, jogos } = await coletar();
  // Ordem estável por appId: a mesma lista gera o mesmo arquivo, e o diff de
  // uma release para a outra mostra só o que entrou e saiu.
  const ordenado = {};
  for (const id of Object.keys(jogos).sort((a, b) => Number(a) - Number(b))) ordenado[id] = jogos[id];
  const antes = ler();
  const mesmo = antes && JSON.stringify(antes.jogos) === JSON.stringify(ordenado);
  if (mesmo) return { mudou: false, total: Object.keys(ordenado).length, fonte };
  const dados = { geradoEm: new Date().toISOString().slice(0, 10), fonte, jogos: ordenado };
  fs.writeFileSync(ARQUIVO, zlib.gzipSync(Buffer.from(JSON.stringify(dados)), { level: 9 }));
  return { mudou: true, total: Object.keys(ordenado).length, fonte };
}

module.exports = { ler, gerar, coletar, ARQUIVO };

if (require.main === module) {
  const conferir = process.argv.includes('--conferir');
  (conferir ? coletar().then((r) => ({ total: Object.keys(r.jogos).length, fonte: r.fonte, mudou: false })) : gerar())
    .then((r) => console.log(`${r.total} jogos, de ${r.fonte}${conferir ? '' : r.mudou ? '; base gravada' : '; base igual à anterior'}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
