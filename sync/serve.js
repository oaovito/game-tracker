'use strict';
/*
 * serve.js - tiny static file server for the tracker page.
 *
 * Binds 0.0.0.0 so a phone on the same Wi-Fi can open it, prints the LAN URL,
 * and draws a QR code in the terminal so the address does not have to be typed
 * by hand.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Endereços IPv4 pelos quais outra máquina da rede consegue nos alcançar.
 *
 * Exclui 169.254.0.0/16 (APIPA): o Windows dá esse endereço a todo adaptador
 * sem DHCP - Bluetooth, Ethernet desconectada, adaptadores virtuais de Wi-Fi
 * Direct. Um PC comum tem vários. Eles nunca servem para chegar aqui, e na
 * janela entre o logon e o Wi-Fi associar são os ÚNICOS que existem, então sem
 * este filtro o serviço anunciaria e gravaria um QR com um endereço morto.
 */
function isApipa(ip) {
  return ip.startsWith('169.254.');
}

function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      const family = typeof net.family === 'string' ? net.family : `IPv${net.family}`;
      if (family !== 'IPv4' || net.internal) continue;
      if (isApipa(net.address)) continue;
      out.push({ name, address: net.address, private: isPrivate(net.address) });
    }
  }
  out.sort((a, b) => Number(b.private) - Number(a.private));
  return out;
}

function isPrivate(ip) {
  const p = ip.split('.').map(Number);
  if (p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  return false;
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const target = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  // Never serve outside the directory we were pointed at.
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) return null;
  return target;
}

function createServer(options) {
  const root = options.root;
  const indexFile = options.indexFile || 'trackeroao.html';

  return http.createServer((req, res) => {
    // Tirar a query ANTES de decidir se é a raiz: com "/?algo" a comparação
    // com "/" falhava e a página virava 404.
    let urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/' + indexFile;

    let file = safeJoin(root, urlPath);
    if (!file) {
      res.writeHead(403).end('forbidden');
      return;
    }

    // As artes dos chefes moram em site/icones/, que é a raiz do que vai para
    // o Pages. A página pede "icones/<chave>.png" relativo a si mesma, e aqui
    // ela é servida da raiz do projeto — então, sem esta ponte, na rede local
    // todo chefe caía no kanji de reserva enquanto no site público aparecia a
    // ilustração. Duas páginas iguais mostrando coisas diferentes.
    if (/^\/icones\//.test(urlPath) && !fs.existsSync(file)) {
      const noSite = safeJoin(path.join(root, 'docs'), urlPath);
      if (noSite && fs.existsSync(noSite)) file = noSite;
    }

    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // progress.json simply may not exist yet; say so in a way the page
        // can handle rather than looking like a server error.
        if (path.basename(file) === 'progress.json') {
          res.writeHead(404, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: 'not-generated-yet' }));
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };
      // The page polls progress.json; it must never be served from cache.
      headers['cache-control'] = ext === '.json' ? 'no-store' : 'no-cache';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    });
  });
}

/**
 * Start listening on every interface and print how to reach it.
 * Resolves with { server, port, urls }.
 */
/**
 * Sobe uma escuta extra numa porta, sem deixar a falha derrubar nada.
 *
 * Serve para a porta 80: com ela o link fica sem `:8777`, que é a diferença
 * entre um endereço que dá para ditar e um que não dá. Mas 80 é porta
 * concorrida - IIS, Docker, outro servidor - e não ter conseguido não é
 * problema nenhum, porque a porta principal continua valendo.
 */
function listenExtra(options) {
  const server = createServer({ root: options.root, indexFile: options.indexFile });
  return new Promise((resolve) => {
    const desistir = (err) => resolve({ ok: false, port: options.port, error: err && err.message });
    server.once('error', desistir);
    try {
      server.listen(options.port, '0.0.0.0', () => resolve({ ok: true, port: options.port, server }));
    } catch (err) {
      desistir(err);
    }
  });
}

function start(options) {
  const root = options.root;
  const port = options.port || 8777;
  const indexFile = options.indexFile || 'trackeroao.html';
  const server = createServer({ root, indexFile });

  // Rodando como serviço, o processo sobe antes do Wi-Fi associar: não existe
  // IP de LAN ainda, e anunciar isso como "sem rede" seria mentira. Nesse caso
  // quem chama assume o anúncio, quando o endereço aparecer.
  const quiet = options.quiet === true;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const addrs = localAddresses();
      const lanIp = addrs.length ? addrs[0].address : null;
      const lanUrl = lanIp ? `http://${lanIp}:${port}/${indexFile}` : null;
      const localUrl = `http://localhost:${port}/${indexFile}`;

      if (quiet) {
        console.log(`  [http] escutando em 0.0.0.0:${port}`);
        resolve({ server, port, urls: { local: localUrl, lan: lanUrl } });
        return;
      }

      console.log('');
      console.log('  Servidor no ar (escutando em 0.0.0.0, toda a rede local)');
      console.log(`     nesta máquina : ${localUrl}`);
      if (lanUrl) {
        console.log(`     pelo celular  : ${lanUrl}`);
      }
      for (const a of addrs.slice(1)) {
        console.log(`     (outra placa) : http://${a.address}:${port}/${indexFile}  [${a.name}]`);
      }

      if (lanUrl) {
        console.log('');
        console.log(`  na rede local: ${lanUrl}`);
      } else {
        console.log('');
        console.log('  Nenhum IP de rede local encontrado - só dá para abrir nesta máquina.');
      }
      console.log('');
      console.log('  O celular precisa estar no mesmo Wi-Fi. Se não abrir, libere a porta');
      console.log(`  ${port} no Firewall do Windows para redes privadas.`);
      console.log('');

      resolve({ server, port, urls: { local: localUrl, lan: lanUrl } });
    });
  });
}

/**
 * O endereço desta máquina na rede local, ou null enquanto não houver IP.
 *
 * Morava no gerador de QR, que saiu do projeto: a página é acessada pelo link
 * público, e um QR que ninguém aponta a câmera para é 536 linhas de código
 * para manter à toa. A função em si continua útil — o serviço avisa no log
 * quando o IP muda — então desceu para cá, que é onde o servidor já sabe
 * quais são os endereços.
 */
function lanUrl(porta, indice) {
  const addrs = localAddresses();
  if (!addrs.length) return null;
  const p = porta || Number(process.env.PORT || 8777);
  return `http://${addrs[0].address}:${p}/${indice || 'trackeroao.html'}`;
}

module.exports = { start, listenExtra, createServer, localAddresses, lanUrl, isPrivate, isApipa };

// ----------------------------------------------------------------------- CLI
if (require.main === module) {
  const port = Number(process.env.PORT || 8777);
  start({ root: path.join(__dirname, '..'), port }).catch((err) => {
    console.error('Não consegui subir o servidor:', err.message);
    process.exit(1);
  });
}
