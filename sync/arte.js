'use strict';
/*
 * arte.js - o banner de cada jogo, na maior resolução que houver.
 *
 * A tela de jogos mostra cada título pela arte dele, e arte pequena esticada
 * fica borrada numa tela grande. Então cada peça sai como uma LISTA de
 * endereços, da maior para a menor, e a página fica com o primeiro que
 * carregar:
 *
 *   heroi - a arte larga, sem texto, que a Steam usa no topo da biblioteca:
 *           3840x1240 (library_hero_2x), depois 1920x620 (library_hero);
 *   capa  - o pôster em pé: 1200x1800 (library_600x900_2x), depois 600x900;
 *   logo  - o logotipo recortado, com fundo transparente: logo_2x, depois logo;
 *   faixa - a cápsula larga, para miniaturas: 616x353, depois o header 460x215.
 *
 * Jogo que não está na Steam (Valorant, Fortnite, Minecraft...) não tem esses
 * arquivos. Para eles, populares.json guarda o site oficial em `arte.site`, e
 * a arte é a imagem de divulgação que o próprio site declara (og:image), que
 * costuma ser a peça grande da campanha. Jogo achado no disco sem appId passa
 * por uma busca exata de nome na loja da Steam antes de desistir.
 *
 * Nada aqui é essencial: sem rede e sem Steam, a página desenha um pôster
 * tipográfico com o nome do jogo. O que foi resolvido fica em
 * sync/cache/arte.json por 30 dias.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE = path.join(__dirname, 'cache', 'arte.json');
const VALIDADE = 30 * 24 * 60 * 60 * 1000;

/* Dois servidores da Steam: o atual e o antigo, que ainda guarda arte que o
   atual às vezes não tem. */
const CDN = [
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/',
];

/** As quatro listas de uma arte da Steam, da maior resolução para a menor. */
function daSteam(appId) {
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) return null;
  const em = (arquivos) => {
    const r = [];
    for (const a of arquivos) for (const c of CDN) r.push(c + id + '/' + a);
    return r;
  };
  return {
    heroi: em(['library_hero_2x.jpg', 'library_hero.jpg']),
    capa: em(['library_600x900_2x.jpg', 'library_600x900.jpg']),
    logo: em(['logo_2x.png', 'logo.png']),
    faixa: em(['capsule_616x353.jpg', 'header.jpg']),
  };
}

/** A imagem de divulgação que uma página declara (og:image ou twitter:image). */
function imagemDaPagina(html, base) {
  const txt = String(html || '');
  const achar = (prop) => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i');
    const tag = re.exec(txt);
    if (!tag) return null;
    const c = /content=["']([^"']+)["']/i.exec(tag[0]);
    return c ? c[1].replace(/&amp;/g, '&') : null;
  };
  const url = achar('og:image:secure_url') || achar('og:image') || achar('twitter:image');
  if (!url) return null;
  try { return new URL(url, base).href; } catch (e) { return null; }
}

function pedirTexto(url, saltos) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) trackeroao', accept: 'text/html,application/json' },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (saltos || 0) < 4) {
        res.resume();
        resolve(pedirTexto(new URL(res.headers.location, url).href, (saltos || 0) + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (corpo.length < 2e6) corpo += c; });
      res.on('end', () => resolve(corpo));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

function lerCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return {}; }
}
function gravarCache(c) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(c));
  } catch (e) { /* cache é conveniência */ }
}

/**
 * Completa `arte` em cada jogo da lista, no lugar.
 *
 * `opts.semRede` usa só o cache; `opts.pedir` troca o acesso à rede (testes);
 * `opts.normalizar` compara nomes na busca da loja.
 */
async function resolver(jogos, opts) {
  const o = opts || {};
  const pedir = o.pedir || pedirTexto;
  const norm = o.normalizar || ((s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const cache = o.cache || lerCache();
  const agora = Date.now();
  let mudou = false;

  for (const j of jogos) {
    const appId = j.appId || (j.arteFonte && j.arteFonte.steam) || null;
    if (appId) { j.arte = daSteam(appId); continue; }

    const chave = 'n:' + norm(j.nome);
    const guardado = cache[chave];
    if (guardado && (o.semRede || agora - guardado.em < VALIDADE)) {
      j.arte = guardado.arte;
      continue;
    }
    if (o.semRede) { j.arte = null; continue; }

    let arte = null;
    const site = j.arteFonte && j.arteFonte.site;
    if (site) {
      try {
        const img = imagemDaPagina(await pedir(site), site);
        if (img) arte = { heroi: [img], capa: [], logo: [], faixa: [img] };
      } catch (e) { /* segue para a busca */ }
    }
    if (!arte) {
      try {
        const r = JSON.parse(await pedir('https://store.steampowered.com/api/storesearch/?cc=us&l=english&term=' +
          encodeURIComponent(j.nome)));
        const achado = ((r && r.items) || []).find((it) => norm(it.name) === norm(j.nome));
        if (achado) arte = daSteam(achado.id);
      } catch (e) { /* sem arte, sem problema */ }
    }
    j.arte = arte;
    cache[chave] = { em: agora, arte };
    mudou = true;
  }
  if (mudou && !o.cache) gravarCache(cache);
  return jogos;
}

/*
 * O logotipo de um jogo da Steam, recortado e de fundo transparente, para o
 * menu da bandeja. Baixado uma vez e guardado em sync/cache/logos; sem rede,
 * vale o que já houver. Devolve o caminho do .png, ou null.
 */
const LOGOS = path.join(__dirname, 'cache', 'logos');
function baixar(url, max) {
  return new Promise((ok) => {
    const r = https.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); ok(null); return; }
      const partes = [];
      let total = 0;
      res.on('data', (d) => { total += d.length; if (total > max) { r.destroy(); ok(null); } else partes.push(d); });
      res.on('end', () => ok(total <= max ? Buffer.concat(partes) : null));
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => ok(null));
  });
}
async function logoDoJogo(appId) {
  const id = String(appId || '').replace(/\D/g, '');
  if (!id) return null;
  const arq = path.join(LOGOS, id + '.png');
  if (fs.existsSync(arq)) return fs.statSync(arq).size ? arq : null;
  for (const url of daSteam(id).logo.reverse()) {
    const png = await baixar(url, 2 * 1024 * 1024);
    // Só um PNG de verdade: a assinatura dos oito primeiros bytes.
    if (png && png.length > 8 && png.readUInt32BE(0) === 0x89504e47) {
      fs.mkdirSync(LOGOS, { recursive: true });
      fs.writeFileSync(arq, png);
      return arq;
    }
  }
  return null;
}

module.exports = { daSteam, imagemDaPagina, resolver, logoDoJogo, CACHE };
