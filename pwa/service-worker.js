// Cache uniquement le shell de l'app (HTML/CSS/JS) pour un chargement rapide
// et l'installation hors-ligne. Les appels aux APIs (Binance, CoinGecko,
// alternative.me) ne sont jamais mis en cache: on veut toujours les donnees
// les plus fraiches.
const CACHE_NAME = "signaltrade-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/config.js",
  "./js/formatting.js",
  "./js/indicators.js",
  "./js/patterns.js",
  "./js/signalEngine.js",
  "./js/supertrend.js",
  "./js/trendRegime.js",
  "./js/supportResistance.js",
  "./js/signalDisplay.js",
  "./js/variations.js",
  "./js/powerLaw.js",
  "./js/dataFetcher.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // laisse passer les appels API sans cache

  // Reseau d'abord: sert toujours la version la plus fraiche du shell quand
  // le telephone est en ligne, le cache n'est qu'un repli hors-ligne.
  // cache: "no-store" pour eviter que le cache HTTP du navigateur ne serve
  // une reponse perimee sans revalidation (heuristique de fraicheur).
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
