/* 通信がなくてもページを開けるようにするための仕組み（Service Worker）
   一度でも通信できる状態でページを開いた端末は、あとは通信なしでも開けます。
   通信できるときは必ず最新のファイルを取りに行き（ブラウザの古い控えは使わない）、できないときだけ端末に控えたものを使います。 */
const VER = "dodge-v2";
const FILES = ["./", "index.html", "referee.html", "hq.html", "style.css", "config.js", "common.js", "referee.js", "hq.js"];

// 控えの名前は「?以降」を除いた形にそろえる（config.js?t=... が増え続けないように）
const keyOf = url => { const u = new URL(url, location.href); return new Request(u.origin + u.pathname); };

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VER)
      .then(c => Promise.all(FILES.map(f =>
        fetch(new Request(f, { cache: "reload" })).then(res => { if (res.ok) return c.put(keyOf(res.url || f), res); })
      )))
      .then(() => self.skipWaiting())
  );
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
    const key = keyOf(r.url);
    // cache:"no-cache" … ブラウザの控え（Cache-Control の期間）を使わず、毎回サーバーに確認する
    const net = fetch(r, { cache: "no-cache" }).then(res => { if (res.ok) cache.put(key, res.clone()); return res; });
    net.catch(() => {});
    try {
      // 3秒以内に応答がなければ（電波が弱いときなど）端末に控えたものを使う
      return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 3000))]);
    } catch (err) {
      return (await cache.match(key)) || net;
    }
  })());
});
