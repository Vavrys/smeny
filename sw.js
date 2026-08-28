// Směny — service worker: KILL SWITCH (v0.9.29)
//
// Proč: appka je interní nástroj na Cloudflare Pages a offline režim nepotřebuje.
// Původní SW držel shell cache-first, takže uživatelům (hlavně na mobilu)
// zamrzával starý build — ruční mazání cache nepomohlo, protože se z cache
// servíroval i samotný index.html, a tím pádem i kód, který by problém uměl
// opravit. Jediná spolehlivá cesta ven vede přes samotný service worker.
//
// Tenhle SW proto nic necachuje ani nezachytává fetch. Nainstaluje se okamžitě
// (skipWaiting), při aktivaci smaže VŠECHNY cache, odregistruje sám sebe
// a přenačte otevřená okna, aby si stáhla čerstvý build ze sítě.
//
// DŮLEŽITÉ: soubor musí zůstat nasazený. Prohlížeč u zaseknutých klientů
// stahuje sw.js při update checku — teprve tím se starý SW nahradí tímhle
// a odinstaluje se. Registrace v index.html je odstraněna, takže se nový SW
// nikdy znovu nenainstaluje (viz killServiceWorkers() v index.html).
const VERSION = '0.9.29-killswitch';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 1) Všechny cache pryč (nejen ty naše — bereme to komplet).
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));

    // 2) Převzít kontrolu nad otevřenými okny. Bez claim() by client.navigate()
    //    skončil TypeError — navigovat smí jen SW, který klienta řídí.
    await self.clients.claim();

    // 3) Odregistrovat se. Klienty to neodpojí okamžitě (controller drží
    //    do dalšího načtení), takže navigace v kroku 4 pořád projde.
    try { await self.registration.unregister(); } catch (e) { /* nevadí */ }

    // 4) Přenačíst otevřená okna — po reloadu už je nikdo neřídí a jedou ze sítě.
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(clients.map(c => {
      try { return c.navigate(c.url).catch(() => {}); } catch (e) { return Promise.resolve(); }
    }));

    console.log('[SW ' + VERSION + '] cache smazána, SW odregistrován, okna přenačtena');
  })());
});

// Záměrně BEZ fetch handleru: všechny requesty jdou přímo na síť / HTTP cache
// prohlížeče. Cokoliv jiného by znovu zavedlo problém, kvůli kterému to vzniklo.
