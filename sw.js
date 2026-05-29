/* ═══════════════════════════════════════════════════════════════
   LADY FRESA POS · Service Worker
   ─────────────────────────────────────────────────────────────
   Estrategia:
     · App shell (HTML/CSS/JS): cache-first con revalidación en
       background. Si está en cache, sirve inmediato; si hay
       conexión, busca actualización para la próxima visita.
     · Imágenes locales (/img/, /uploads/): cache-first.
     · Supabase API y Realtime: network-only (NUNCA cachear).
     · Fuentes Google: cache-first long-lived.

   Bump SW_VERSION cuando quieras forzar refresh global.
═══════════════════════════════════════════════════════════════ */
const SW_VERSION = 'v2026.05.29.1';
const STATIC_CACHE = `lf-static-${SW_VERSION}`;
const IMG_CACHE = `lf-img-${SW_VERSION}`;
const FONT_CACHE = `lf-font-v1`;

// Recursos que se precachean al instalar.
// Mantener corto: el resto se cachea on-demand.
const PRECACHE = [
  './',
  './index.html',
  './tokens.css',
  './supabase-sync.js',
  './limpiar-cache.html',
];

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // addAll falla si falta uno; usamos add individual para tolerancia
      Promise.all(PRECACHE.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[SW] No se pudo precachear', url, err);
        })
      ))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('lf-') && k !== STATIC_CACHE && k !== IMG_CACHE && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET. POST/PATCH/PUT siempre pasan a la red.
  if (req.method !== 'GET') return;

  // ─── Supabase API & Realtime: NUNCA cachear ───
  if (
    url.hostname.endsWith('.supabase.co') ||
    url.hostname.endsWith('.supabase.in') ||
    url.protocol === 'wss:' ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/realtime/')
  ) {
    return; // dejar pasar a la red
  }

  // ─── Fuentes Google: cache-first, long-lived ───
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // ─── jsdelivr (supabase-js): cache-first ───
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // ─── Imágenes locales: stale-while-revalidate ───
  // (antes era cache-first puro: una foto cacheada nunca se
  //  actualizaba. Ahora sirve la cacheada al instante PERO revalida
  //  en background, así una foto reemplazada se actualiza sola.)
  if (req.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i)) {
    event.respondWith(staleWhileRevalidateImage(req));
    return;
  }

  // ─── App shell (HTML/CSS/JS local): stale-while-revalidate ───
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }
});

// ── STRATEGIES ────────────────────────────────────────────────

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function staleWhileRevalidateImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);

  // Revalidación en background: actualiza la cache para la próxima vez.
  const networkFetch = fetch(req).then((res) => {
    if (res && res.ok) {
      cache.put(req, res.clone());
      trimCache(IMG_CACHE, 80);
    }
    return res;
  }).catch(() => null);

  // Si hay cacheada, la servimos instantánea (y revalida atrás).
  if (cached) return cached;

  // Si no, esperamos a la red.
  const net = await networkFetch;
  if (net) return net;

  // Offline y sin cache: SVG transparente como fallback.
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    { headers: { 'Content-Type': 'image/svg+xml' } }
  );
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const networkFetch = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  // Si hay cached, lo devolvemos inmediato y dejamos la revalidación de fondo.
  // Si no, esperamos a la red.
  return cached || (await networkFetch) || new Response('', { status: 504 });
}

// Recorta un cache a las N entradas más recientes
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // Borrar las más viejas (orden de inserción)
    for (let i = 0; i < keys.length - maxEntries; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ── MENSAJES desde la app ────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('lf-')).map((k) => caches.delete(k)))
    );
  }
});
