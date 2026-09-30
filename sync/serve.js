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
  '.webmanifest': 'application/manifest+json',
  '.apk': 'application/vnd.android.package-archive',
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
  // Chamado quando alguem desta maquina abre a aplicacao pelo atalho. Fica
  // como parametro para o serve.js continuar sendo so um servidor de
  // arquivos: quem sabe o que "abrir" significa e o processo residente.
  const aoAbrir = typeof options.aoAbrir === 'function' ? options.aoAbrir : null;
  const aoVarrer = typeof options.aoVarrer === 'function' ? options.aoVarrer : null;
  const aoAtualizar = typeof options.aoAtualizar === 'function' ? options.aoAtualizar : null;
  const aoEncerrar = typeof options.aoEncerrar === 'function' ? options.aoEncerrar : null;

  return http.createServer((req, res) => {
    // Tirar a query ANTES de decidir se é a raiz: com "/?algo" a comparação
    // com "/" falhava e a página virava 404.
    let urlPath = (req.url || '/').split('?')[0];

    /*
     * A escolha de quais jogos vigiar é a única coisa que a página escreve.
     *
     * O projeto inteiro é somente leitura, e esta é a exceção declarada: não é
     * progresso, é preferência de quem instalou — e o pedido é que ela seja
     * feita dentro da aplicação, não editando arquivo.
     *
     * Só aceita de quem está NESTA máquina. O servidor responde para a rede
     * local inteira, e o celular na mesma casa não tem por que reconfigurar o
     * PC de alguém. Ler a página, sim; mudar como ela se comporta, não. Quem
     * chega pelo GitHub Pages nem alcança daqui, porque lá não há servidor.
     */
    /*
     * O atalho da area de trabalho bate aqui antes de abrir o navegador.
     *
     * E o que faz a aplicacao "abrir" no sentido do pedido: a chama acende na
     * bandeja. Sem esta rota o atalho abriria so uma aba, e a bandeja ficaria
     * sendo sinal exclusivo do jogo -- mas o pedido diz que pelo atalho ela
     * abre livremente tambem.
     *
     * So de quem esta nesta maquina, pela mesma razao da rota de selecao: o
     * celular le a pagina, nao comanda o computador.
     */
    if (urlPath === '/abrir') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina) { res.writeHead(403).end('forbidden'); return; }
      if (aoAbrir) { try { aoAbrir(); } catch (e) { /* abrir nao pode derrubar o servidor */ } }
      res.writeHead(204).end();
      return;
    }

    // "Procurar de novo" na tela de jogos: marca a varredura para a próxima
    // folga entre rodadas, sem rodar nada aqui dentro. Só da própria máquina.
    if (urlPath === '/varrer') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina || req.method !== 'POST') { res.writeHead(403).end('forbidden'); return; }
      if (aoVarrer) { try { aoVarrer(); } catch (e) { /* não derruba o servidor */ } }
      res.writeHead(202).end();
      return;
    }

    /*
     * O idioma escolhido no globo da página. Guardado aqui, e não só no
     * navegador, para a bandeja e a janela do Windows falarem a mesma língua.
     * Vazio (null) volta a seguir o idioma do sistema. GET vale de qualquer
     * lugar; mudar, só da própria máquina.
     */
    if (urlPath === '/idioma') {
      const idioma = require('./idioma');
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ idioma: idioma.ler() }));
        return;
      }
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina || req.method !== 'POST') { res.writeHead(403).end('forbidden'); return; }
      let corpo = '';
      req.on('data', (c) => { corpo += c; if (corpo.length > 256) req.destroy(); });
      req.on('end', () => {
        try {
          const escolhido = idioma.gravar(JSON.parse(corpo).idioma);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ idioma: escolhido }));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"erro":"pedido malformado"}');
        }
      });
      return;
    }

    // "Forçar atualização", no menu da bandeja: confere a release agora, sem
    // esperar a próxima rodada. Só da própria máquina.
    if (urlPath === '/atualizar') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina || req.method !== 'POST') { res.writeHead(403).end('forbidden'); return; }
      /*
       * Responde o que achou: já na última versão ({atual: true}), ou com a
       * versão nova a caminho ({atual: false}), que o serviço aplica na
       * próxima folga e se reinicia. A bandeja só avisa no primeiro caso.
       */
      require('./atualizar').situacao().then((s) => {
        if (!s.atual && aoAtualizar) { try { aoAtualizar(); } catch (e) { /* não derruba o servidor */ } }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(s));
      }, (e) => {
        res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ erro: e.message }));
      });
      return;
    }

    // "Fechar", no menu da bandeja: encerra o serviço de verdade, e ele não
    // volta sozinho (nem no logon) até a pessoa abrir o Trackeroao à mão.
    if (urlPath === '/encerrar') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina || req.method !== 'POST') { res.writeHead(403).end('forbidden'); return; }
      res.writeHead(202).end();
      if (aoEncerrar) setTimeout(() => { try { aoEncerrar(); } catch (e) { /* sai de qualquer jeito */ } }, 200);
      return;
    }

    // O nome do cabeçalho, escolhido na página: o caminho sem Steam.
    if (urlPath === '/jogador') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina || req.method !== 'POST') { res.writeHead(403).end('forbidden'); return; }
      let corpo = '';
      req.on('data', (c) => { corpo += c; if (corpo.length > 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const jogador = require('./jogador');
          jogador.escolher(JSON.parse(corpo).nick);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jogador.quem()));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"erro":"pedido malformado"}');
        }
      });
      return;
    }

    if (urlPath === '/selecao') {
      const daMaquina = /^(::1|::ffff:127\.|127\.)/.test(req.socket.remoteAddress || '');
      if (!daMaquina) {
        res.writeHead(403, { 'content-type': 'application/json' })
           .end('{"erro":"a escolha só pode ser feita no próprio computador"}');
        return;
      }
      const jogos = require('./jogos');
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
           .end(JSON.stringify(jogos.paraProgresso()));
        return;
      }
      if (req.method === 'POST') {
        let corpo = '';
        req.on('data', (c) => {
          corpo += c;
          // Um corpo grande aqui só pode ser engano ou abuso: a lista tem o
          // tamanho do catálogo, que cabe em algumas centenas de bytes.
          if (corpo.length > 65536) { req.destroy(); }
        });
        req.on('end', () => {
          try {
            const pedido = JSON.parse(corpo);
            jogos.selecionar(pedido.jogos);
            res.writeHead(200, { 'content-type': 'application/json' })
               .end(JSON.stringify(jogos.paraProgresso()));
          } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' })
               .end('{"erro":"pedido malformado"}');
          }
        });
        return;
      }
      res.writeHead(405).end('method not allowed');
      return;
    }
    if (urlPath === '/' || urlPath === '') urlPath = '/' + indexFile;

    /*
     * O aplicativo de Android. Ele chega dentro do instalador, em
     * <instalacao>/app, e o celular o baixa daqui, pela rede de casa: sem loja
     * e sem link na internet. O resto de app/ (a janela do Windows) nao e
     * servido; os icones da pagina em app/ continuam vindo de docs/app.
     */
    if (urlPath === '/android.apk') urlPath = '/app/trackeroao.apk';

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
    // O mesmo vale para o que faz a página virar aplicativo no celular.
    const daJanela = /^\/app\//.test(urlPath) && urlPath !== '/app/trackeroao.apk';
    if (/^\/(icones\/|app\/|sw\.js$|manifest\.webmanifest$)/.test(urlPath) && (daJanela || !fs.existsSync(file))) {
      const noSite = safeJoin(path.join(root, 'docs'), urlPath);
      if (noSite && fs.existsSync(noSite)) file = noSite;
      else if (daJanela) file = path.join(root, 'docs', '.nada');
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
  const server = createServer({ root: options.root, indexFile: options.indexFile, aoAbrir: options.aoAbrir, aoVarrer: options.aoVarrer, aoAtualizar: options.aoAtualizar, aoEncerrar: options.aoEncerrar });
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
  const server = createServer({ root, indexFile, aoAbrir: options.aoAbrir, aoVarrer: options.aoVarrer, aoAtualizar: options.aoAtualizar, aoEncerrar: options.aoEncerrar });

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
