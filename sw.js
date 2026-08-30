/* ============================================================================
   sw.js — Service Worker do Letterbooks.

   Duas estrategias, porque as duas coisas tem naturezas diferentes:

   1. O app em si (HTML, CSS, JS, icones) usa cache-first. Ele quase nunca muda,
      entao abrir offline tem que ser instantaneo. A troca de versao do CACHE
      abaixo e o que publica uma atualizacao.

   2. O acervo da Open Library (busca, fichas e capas) usa rede-primeiro com
      cache de reserva. Assim os dados chegam sempre frescos quando ha conexao,
      mas os livros que voce ja abriu continuam acessiveis no aviao.

   O seu diario nao passa por aqui: ele vive no localStorage e ja e offline.
   ========================================================================== */
var CACHE = 'letterbooks-v3';
var CACHE_REDE = 'letterbooks-acervo-v1';

var ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/api.js',
  './js/dados.js',
  './js/app.js',
  './icons/icone-192.png',
  './icons/icone-512.png',
  './icons/icone-180.png',
  './icons/favicon-32.png',
  './fontes/inter-latin.woff2',
  './fontes/inter-latin-ext.woff2'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ARQUIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.map(function (n) {
        if (n !== CACHE && n !== CACHE_REDE) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  if (ev.request.method !== 'GET') return;

  var url = new URL(ev.request.url);
  var externo = url.origin !== self.location.origin;

  /* Acervo: tenta a rede, guarda o que veio, e cai no cache se estiver offline. */
  if (externo) {
    ev.respondWith(
      fetch(ev.request).then(function (resposta) {
        if (resposta && resposta.status === 200) {
          var copia = resposta.clone();
          caches.open(CACHE_REDE).then(function (c) { c.put(ev.request, copia); });
        }
        return resposta;
      }).catch(function () {
        return caches.match(ev.request);
      })
    );
    return;
  }

  /* App: cache primeiro, com atualizacao silenciosa em segundo plano. */
  ev.respondWith(
    caches.match(ev.request).then(function (guardado) {
      var daRede = fetch(ev.request).then(function (resposta) {
        if (resposta && resposta.status === 200) {
          var copia = resposta.clone();
          caches.open(CACHE).then(function (c) { c.put(ev.request, copia); });
        }
        return resposta;
      }).catch(function () { return guardado; });
      return guardado || daRede;
    })
  );
});
