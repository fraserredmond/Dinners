// Dinners - app-shell cache. Network first, so a new version shows on the next open;
// the cache answers when the phone is offline. Bump CACHE_VERSION on each release.
// Only the app's own files are cached: answers from the Sheet are never stored here.
const CACHE_VERSION = "dinners-v2";
const SHELL = ["./", "./index.html", "./app.css", "./manifest.json", "./js/app.js", "./js/scale.js", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (evt) => {
	evt.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evt) => {
	evt.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evt) => {
	const req = evt.request;
	if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
	evt.respondWith(
		fetch(req).then((res) => {
			if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); }
			return res;
		}).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html")))
	);
});
