'use strict';
/*
 * qrfile.js - grava o QR da URL da LAN como SVG, para abrir/escanear fora do
 * terminal. Sem dependências: usa o mesmo encoder do servidor.
 *
 *   node sync/qrfile.js [saida.svg] [url]
 */

const fs = require('fs');
const path = require('path');

const qr = require('./qr');
const serve = require('./serve');

const PORT = Number(process.env.PORT || 8777);
const INDEX = 'sekiro-progresso.html';

function lanUrl() {
  const addrs = serve.localAddresses();
  if (!addrs.length) return null;
  return `http://${addrs[0].address}:${PORT}/${INDEX}`;
}

function toSvg(matrix, url, scale, quiet) {
  const s = scale || 10;
  const q = quiet === undefined ? 4 : quiet;
  const n = matrix.size;
  const dim = (n + q * 2) * s;
  const caption = 36;

  const rects = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix.grid[y][x]) {
        rects.push(`<rect x="${(x + q) * s}" y="${(y + q) * s}" width="${s}" height="${s}"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim + caption}" viewBox="0 0 ${dim} ${dim + caption}">
  <rect width="${dim}" height="${dim + caption}" fill="#ffffff"/>
  <g fill="#000000">
${rects.join('\n')}
  </g>
  <text x="${dim / 2}" y="${dim + 23}" font-family="monospace" font-size="15" text-anchor="middle" fill="#000000">${url.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
</svg>
`;
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'qr-acesso.svg');
  const url = process.argv[3] || lanUrl();
  if (!url) {
    console.error('Nenhum IP de rede local encontrado.');
    process.exit(1);
  }
  const m = qr.encode(url, 'L');
  fs.writeFileSync(out, toSvg(m, url));
  console.log(`URL   : ${url}`);
  console.log(`QR    : versão ${m.version}, ${m.size}x${m.size}, máscara ${m.mask}`);
  console.log(`salvo : ${out}`);
}

module.exports = { toSvg, lanUrl };
