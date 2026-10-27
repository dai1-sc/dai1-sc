/* 通信がなくてもページを開けるようにするための仕組み（Service Worker）
   一度でも通信できる状態でページを開いた端末は、あとは通信なしでも開けます。
   通信できるときは常に最新のファイルを使い、できないときだけ端末に控えたものを使います。 */
const VER = "dodge-v1";
const FILES = ["./", "index.html", "referee.html", "hq.html", "style.css", "config.js", "common.js", "referee.js", "hq.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return; // スプレッドシートへの通信には触らない
  e.respondWith((async () => {
    const cache = await caches.open(VER);
    const net = fetch(r).then(res => { if (res.ok) cache.put(r, res.clone()); return res; });
    net.catch(() => {});
    try {
      // 3秒以内に応答がなければ（電波が弱いときなど）控えを使う
      return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 3000))]);
    } catch (err) {
      return (await cache.match(r, { ignoreSearch: true })) || net;
    }
  })());
});
