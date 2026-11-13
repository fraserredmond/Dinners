// Dinners - app-shell cache. Network first, so a new version shows on the next open;
// the cache answers when the phone is offline. Bump CACHE_VERSION on each release.
// Only the app's own files are cached here. (The app keeps its own copies of the Sheet's answers,
// and its photos in the "dinners-photos" cache, which this leaves alone.)
const CACHE_VERSION = "dinners-v15";
const SLOW_MS = 3000; // on a weak signal, the stored copy after this long (the network still updates it)
const SHELL = ["./", "./index.html", "./app.css", "./manifest.json", "./js/app.js", "./js/scale.js", "./js/shop.js", "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (evt) => {
	evt.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evt) => {
	// clear old versions of this app's files only: other apps on this address keep their caches,
	// and the photos the app stores (dinners-photos) stay
	evt.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => /^dinners-v\d+$/.test(k) && k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evt) => {
	const req = evt.request;
	if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
	const stored = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined));
	evt.respondWith(new Promise((resolve) => {
		let answered = false;
		const answer = (res) => { if (!answered && res) { answered = true; resolve(res); } };
		// a weak signal: after SLOW_MS use the stored copy, if there is one
		const slow = setTimeout(() => { stored().then(answer); }, SLOW_MS);
		fetch(req).then((res) => {
			clearTimeout(slow);
			if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); }
			answer(res);
		}).catch(() => {
			clearTimeout(slow);
			caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html")).then((hit) => { answer(hit || Response.error()); });
		});
	}));
});
