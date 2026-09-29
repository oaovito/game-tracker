'use strict';
/*
 * alma.js - recorta o fantasma do bloco de mortes a partir da captura do jogo.
 *
 * Por que isto existe em vez de um desenho.
 *
 * O vulto que sobe no bloco de mortes foi desenhado a mao cinco vezes e as
 * cinco falharam, cada uma por um motivo diferente e instrutivo: bulbo com
 * cauda lia como espermatozoide; a versao seguinte tinha rosto, mas rosto de
 * ninguem; a terceira era um chibi de Shinobi morto, legivel e generico; a
 * quarta era o Idolo do Escultor, referencia certa mas pedra parada, sem nada
 * que se possa animar. A quinta acertou a referencia -- o Samurai Spirit, o
 * fantasma que o jogo poe em Mibu Village e no Fountainhead Palace -- e mesmo
 * assim saiu comica: cabeca redonda sobre corpo conico, em traco claro, le
 * como boneco de neve.
 *
 * A licao e sobre o metodo, nao sobre a mao: proporcao humana nao sobrevive a
 * ser simplificada em 21 por 50 pixels. O que sobra de uma pessoa reduzida a
 * poucas linhas e um brinquedo. Entao o vulto deixou de ser desenhado e passou
 * a ser extraido da propria captura, onde as proporcoes ja sao as certas
 * porque sao as do jogo.
 *
 * Como a extracao funciona.
 *
 * O jogo desenha o espirito como luz branca sobre cenario escuro, entao
 * separar um do outro e um problema de brilho e nao de cor. Cada pixel vira
 * alfa proporcional a sua luminancia entre um piso e um teto calculados sobre
 * o pixel mais claro da imagem -- assim a conta se ajusta sozinha se a fonte
 * mudar, em vez de depender de numeros fixos que so valem para um arquivo.
 *
 * O alfa passa por uma curva suave (smoothstep) antes de ser gravado. Sem ela
 * o cinza do cenario virava nevoa em volta da figura; com ela o meio e
 * empurrado para baixo e so o que e claro de verdade sobrevive. A borda fica
 * macia em vez de recortada, que e o que faz parecer fantasma e nao adesivo.
 *
 * A cor nao e a da captura: e o azul-osso do bloco de mortes, para o vulto
 * pertencer a pagina em vez de ser um retalho de outra imagem.
 *
 * Por que precisa de navegador.
 *
 * Decodificar e recodificar PNG a mao seriam algumas centenas de linhas, e o
 * projeto nao tem dependencia nenhuma -- nao vai ganhar uma por causa disto. O
 * canvas do navegador ja faz as duas coisas, e o navegador esta em qualquer
 * maquina. Entao este modulo escreve uma pagina, abre no navegador padrao, e
 * a pagina devolve o PNG pronto para esta porta.
 *
 * O resultado fica versionado em docs/icones/alma.png. Quem clonar recebe o
 * arquivo e nao precisa rodar nada disto; isto so se roda de novo se a fonte
 * mudar ou se o tratamento for ajustado.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const DESTINO = path.join(__dirname, '..', 'docs', 'icones', 'alma.png');
const FONTE = 'https://static0.fextralifeimages.com/file/sekiroshadowsdietwice/9/96/Samurai_spirit2.png';
const PORTA = 8791;

/** Altura do recorte final. Guardar grande deixa a pagina escolher o tamanho. */
const ALTURA = 200;

function baixar(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(baixar(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const p = [];
      res.on('data', (c) => p.push(c));
      res.on('end', () => resolve(Buffer.concat(p)));
    }).on('error', reject);
  });
}

const PAGINA = `<!doctype html>
<meta charset="utf-8">
<title>recorte</title>
<body style="background:#111;color:#ddd;font:13px system-ui">
<p id="estado">processando…</p>
<script>
const ALTURA = ${ALTURA};
const img = new Image();
img.onload = () => {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  // Piso e teto relativos ao pixel mais claro: a conta se ajusta a fonte.
  let maior = 0;
  for (let i = 0; i < px.length; i += 4) maior = Math.max(maior, lum(i));
  const PISO = maior * 0.42, TETO = maior * 0.88;

  for (let i = 0; i < px.length; i += 4) {
    let a = (lum(i) - PISO) / (TETO - PISO);
    a = Math.max(0, Math.min(1, a));
    a = a * a * (3 - 2 * a);           // smoothstep: mata a névoa do cenário
    px[i] = 226 + 29 * a;              // azul-osso do bloco de mortes
    px[i + 1] = 240 + 15 * a;
    px[i + 2] = 251;
    px[i + 3] = Math.round(a * 255);
  }
  g.putImageData(d, 0, 0);

  // Corta na caixa do que sobrou.
  const d2 = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d2[(y * c.width + x) * 4 + 3] > 26) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const lar = x1 - x0 + 1, alt = y1 - y0 + 1;
  const m = document.createElement('canvas');
  const escala = ALTURA / alt;
  m.width = Math.round(lar * escala); m.height = ALTURA;
  const gm = m.getContext('2d');
  gm.imageSmoothingQuality = 'high';
  gm.drawImage(c, x0, y0, lar, alt, 0, 0, m.width, m.height);

  fetch('/guardar', { method: 'POST', body: m.toDataURL('image/png').split(',')[1] })
    .then((r) => r.text())
    .then((t) => { document.getElementById('estado').textContent =
      t + ' — ' + m.width + 'x' + m.height + '. Pode fechar esta aba.'; });
};
img.src = '/fonte.png';
</script>`;

async function recortar() {
  const fonte = await baixar(FONTE);

  return new Promise((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      if (req.url === '/fonte.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(fonte);
      }
      if (req.method === 'POST' && req.url === '/guardar') {
        let corpo = '';
        req.on('data', (c) => { corpo += c; });
        return req.on('end', () => {
          const png = Buffer.from(corpo, 'base64');
          // Um HTML de erro devolvido por engano nao e imagem. O cabecalho PNG
          // e o que separa os dois, e gravar lixo daria um vulto quebrado.
          if (!(png.length > 8 && png[0] === 0x89 && png[1] === 0x50)) {
            res.writeHead(400); res.end('nao e PNG');
            servidor.close();
            return reject(new Error('o navegador devolveu algo que nao e PNG'));
          }
          fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
          fs.writeFileSync(DESTINO, png);
          res.writeHead(200); res.end('gravado');
          servidor.close();
          resolve({ bytes: png.length, destino: DESTINO });
        });
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGINA);
    });

    servidor.listen(PORTA, '127.0.0.1', () => {
      const url = 'http://127.0.0.1:' + PORTA + '/';
      console.log('  abrindo ' + url + ' para o navegador fazer o recorte');
      // `start` do cmd abre no navegador padrao sem depender de qual seja. O
      // primeiro argumento vazio e o titulo da janela, que o `start` exige
      // quando o alvo vem entre aspas.
      execFile('cmd', ['/c', 'start', '', url], () => {});
    });

    setTimeout(() => {
      servidor.close();
      reject(new Error('o navegador nao respondeu em 60s'));
    }, 60000).unref();
  });
}

module.exports = { recortar, DESTINO, FONTE };

if (require.main === module) {
  recortar()
    .then((r) => console.log(`  ok: ${r.destino} (${(r.bytes / 1024).toFixed(1)} KB)`))
    .catch((e) => { console.log('  FALHA: ' + e.message); process.exitCode = 1; });
}
