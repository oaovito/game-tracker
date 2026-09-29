/*
 * sw.js - o que faz o link de progresso abrir como aplicativo no celular.
 *
 * Instalado pela tela inicial (Safari: Compartilhar > Adicionar à Tela de
 * Início; Chrome: Instalar app), o trackeroao abre em tela cheia, com ícone
 * próprio. Este service worker só garante uma coisa: sem rede, a última
 * leitura continua abrindo, em vez de uma tela de erro.
 *
 * Rede primeiro, sempre. O progresso muda enquanto se joga, e servir do cache
 * quando há rede mostraria um número velho como se fosse atual. O cache é só
 * o que sobra quando a rede falta.
 */
const CACHE = 'trackeroao-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((r) => r || caches.match('./', { ignoreSearch: true })))
  );
});
