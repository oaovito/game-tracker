'use strict';
/*
 * icones.js - baixa as artes de chefe do wiki para site/icones/<key>.png.
 *
 * A página usa a imagem quando ela existe e cai no emblema em kanji quando não
 * existe. Então este passo é opcional: apagar a pasta devolve o kanji, sem
 * mexer em mais nada.
 *
 * Aviso que fica registrado no próprio arquivo, porque some de uma conversa e
 * não some daqui: as artes são da FromSoftware, hospedadas pelo wiki. Usá-las
 * numa página pessoal é uma coisa; publicá-las num repositório público é
 * redistribuição, e o repositório é do usuário. Ele foi avisado e decidiu
 * seguir. Para tirar do que vai ao ar sem perder no local, basta pôr
 * `icones/` no .gitignore de site/.
 *
 * Alguns chefes compartilham arte de propósito: o Genichiro do prólogo, o da
 * torre e o Inner são o mesmo personagem, e o wiki tem uma imagem só.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DESTINO = path.join(__dirname, '..', 'docs', 'icones');
const BASE = 'https://static0.fextralifeimages.com/file/sekiroshadowsdietwice';

const MAPA = {
  genichiroPrologue: '1/14/Genichiro-ashina-boss-sekiro-wiki-guide-300px.png',
  gyoubu: 'b/b0/Gyoubu-oniwa-boss-sekiro-wiki-guide-300px.png',
  ladyButterfly: '9/93/Lady-butterflyr-boss-sekiro-wiki-guide-300px.png',
  genichiro2: '1/14/Genichiro-ashina-boss-sekiro-wiki-guide-300px.png',
  foldingMonkeys: 'f/fd/Folding-screen-monkeys-boss-sekiro-wiki-guide-300px.png',
  guardianApe: '2/2b/Guardian-ape-boss-sekiro-wiki-guide-300px.png',
  guardianApe2: '2/29/Headless-ape-boss-sekiro-wiki-guide-300px.png',
  corruptedMonkIll: 'e/e3/Corrupted-monk-boss-sekiro-wiki-guide-300px.png',
  greatShinobiOwl: 'c/cf/Great-shinobi-owl-boss-sekiro-wiki-guide-300px.png',
  owlFather: 'c/c6/Owl-father-boss-sekiro-wiki-guide-300px.png',
  trueCorruptedMonk: '6/69/Corrupted_monk.png',
  divineDragon: '7/73/Divine-dragon-boss-sekiro-wiki-guide-300px.png',
  demonOfHatred: 'd/da/Demon-of-hatred-boss-sekirow-wiki-guide-300px.png',
  isshinSwordSaint: '2/2d/Isshin-sword-saint-boss-sekiro-wiki-guide-300px.png',
  isshinAshina: 'f/f3/Ashina-isshin-boss-sekiro-wiki-guide-300px.png',
  innerGenichiro: '9/97/Genichiro-ashina-sekiro-shadows-die-twice-wiki-guide.png',
  innerFather: 'c/c6/Owl-father-boss-sekiro-wiki-guide-300px.png',
  innerIsshin: '2/2d/Isshin-sword-saint-boss-sekiro-wiki-guide-300px.png',
  // A arte dela não está na página de chefes: é a de personagem, retrato de
  // corpo inteiro. Por isso ela tem `enquadre` no config — sem aproximar, o
  // recorte quadrado pegaria o tronco em vez do rosto.
  emma: 2/2b/Emma-min.png,
};

function baixar(url, alvo) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(baixar(res.headers.location, alvo));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, status: res.statusCode }); }
      const pedacos = [];
      res.on('data', (c) => pedacos.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(pedacos);
        // Um HTML de erro devolvido com 200 não é imagem. O cabeçalho PNG é o
        // que separa os dois, e gravar lixo daria um ícone quebrado na página.
        const ehPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
        if (!ehPng) return resolve({ ok: false, status: 'não é PNG' });
        fs.writeFileSync(alvo, buf);
        resolve({ ok: true, bytes: buf.length });
      });
    }).on('error', (e) => resolve({ ok: false, status: e.message }));
  });
}

async function baixarTodos() {
  fs.mkdirSync(DESTINO, { recursive: true });
  const r = [];
  for (const [key, caminho] of Object.entries(MAPA)) {
    const alvo = path.join(DESTINO, key + '.png');
    const res = await baixar(`${BASE}/${caminho}`, alvo);
    r.push({ key, ...res });
  }
  return r;
}

module.exports = { baixarTodos, MAPA, DESTINO };

if (require.main === module) {
  baixarTodos().then((r) => {
    let total = 0;
    for (const x of r) {
      if (x.ok) { total += x.bytes; console.log(`  ok    ${x.key.padEnd(20)} ${(x.bytes / 1024).toFixed(0)} KB`); }
      else console.log(`  FALHA ${x.key.padEnd(20)} ${x.status}`);
    }
    console.log(`\n  ${r.filter((x) => x.ok).length}/${r.length} baixados, ${(total / 1024 / 1024).toFixed(1)} MB`);
    console.log('  Chefes sem arte no wiki caem no emblema em kanji.');
  });
}
