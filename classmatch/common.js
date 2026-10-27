"use strict";
/* 共通ロジック：データの読み書き・順位計算・トーナメント判定 */

const $ = (s, el = document) => el.querySelector(s);
const LEAGUES = CONFIG.LEAGUES;
const P = CONFIG.POINTS;
const sgn = n => (n > 0 ? "+" + n : n < 0 ? String(n) : "±0");
const leagueOf = c => LEAGUES.find(L => L.classes.includes(c));

/* ---------- データ保存（Googleスプレッドシート or テストモード） ---------- */
const API = {
  local: !CONFIG.API_URL,
  KEY: "dodge_local_v1",
  readLocal() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || { results: {}, overrides: {} }; }
    catch (e) { return { results: {}, overrides: {} }; }
  },
  async load() {
    if (this.local) return this.readLocal();
    const res = await fetch(CONFIG.API_URL + "?action=all&t=" + Date.now());
    if (!res.ok) throw new Error("読み込みに失敗しました");
    const d = await res.json();
    const results = {};
    (d.results || []).forEach(r => { results[r.id] = r; });
    return { results, overrides: d.overrides || {} };
  },
  async post(op) {
    if (this.local) {
      const d = this.readLocal();
      if (op.action === "save") d.results[op.record.id] = op.record;
      else if (op.action === "delete") delete d.results[op.id];
      else if (op.action === "override") {
        if (op.order.length) d.overrides[op.league] = op.order; else delete d.overrides[op.league];
      } else if (op.action === "reset") { d.results = {}; d.overrides = {}; }
      localStorage.setItem(this.KEY, JSON.stringify(d));
      return;
    }
    // text/plain で送る（Apps Script で CORS の事前確認が不要になる）
    const res = await fetch(CONFIG.API_URL, { method: "POST", body: JSON.stringify(op) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "保存に失敗しました");
  },
};

/* ---------- 試合の一覧（リーグ戦） ---------- */
const LEAGUE_MATCHES = {};
const ALL_LEAGUE_MATCHES = [];
(function () {
  const sched = CONFIG.SCHEDULE || [];
  const order = (a, b) => {
    const i = sched.findIndex(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
    return i < 0 ? 999 : i;
  };
  LEAGUES.forEach(L => {
    const n = L.classes.length, list = [];
    for (let i = 0; i < n; i++) {
      let a = L.classes[i], b = L.classes[(i + 1) % n];
      if (sched.some(p => p[0] === b && p[1] === a)) [a, b] = [b, a]; // 左右の向きは SCHEDULE に合わせる
      list.push({ id: `M${Math.min(a, b)}-${Math.max(a, b)}`, a, b, league: L.id, ord: order(a, b), kind: "league" });
    }
    LEAGUE_MATCHES[L.id] = list.slice().sort((x, y) => x.ord - y.ord);
    ALL_LEAGUE_MATCHES.push(...list);
  });
  ALL_LEAGUE_MATCHES.sort((x, y) => x.ord - y.ord || x.league - y.league);
  ALL_LEAGUE_MATCHES.forEach((m, i) => { m.no = i + 1; });
})();

/* ---------- 結果の扱い ---------- */
// 記録を「a が左側」の向きにそろえる
function orient(r, a) {
  if (r.a === a) return r;
  return { ...r, a: r.b, b: r.a, sa: r.sb, sb: r.sa, ia: r.ib, ib: r.ia };
}
const getRec = (m, results) => (results[m.id] ? orient(results[m.id], m.a) : null);
// "A"=左の勝ち "B"=右の勝ち "D"=引き分け（スコアで判定）
const outcome = r => (r.sa > r.sb ? "A" : r.sa < r.sb ? "B" : "D");
// トーナメントは引き分け不可：スコア→内野の残り人数の順で勝者を決める
function koWinner(r) {
  if (r.sa !== r.sb) return r.sa > r.sb ? r.a : r.b;
  if (r.ia !== r.ib) return r.ia > r.ib ? r.a : r.b;
  return null;
}

/* ---------- リーグ順位 ---------- */
function standings(L, results, overrides) {
  const ms = LEAGUE_MATCHES[L.id];
  const rows = L.classes.map(c => ({ c, p: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, diff: 0 }));
  const by = {};
  rows.forEach(r => { by[r.c] = r; });
  let done = 0;
  ms.forEach(m => {
    const r = getRec(m, results);
    if (!r) return;
    done++;
    const A = by[m.a], B = by[m.b], o = outcome(r);
    A.p++; B.p++;
    A.gf += r.ia; A.ga += r.ib; B.gf += r.ib; B.ga += r.ia;
    if (o === "A") { A.w++; B.l++; A.pts += P.win; B.pts += P.lose; }
    else if (o === "B") { B.w++; A.l++; B.pts += P.win; A.pts += P.lose; }
    else { A.d++; B.d++; A.pts += P.draw; B.pts += P.draw; }
  });
  rows.forEach(r => { r.diff = r.gf - r.ga; });

  const cmp = (x, y) => y.pts - x.pts || y.diff - x.diff || y.gf - x.gf;
  rows.sort(cmp);

  const ov = (overrides[L.id] || []).map(Number);
  const sorted = [];
  let undecided = false, i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && cmp(rows[i], rows[j]) === 0) j++;
    const g = rows.slice(i, j);
    let tie = false;
    if (g.length > 1) {
      let resolved = false;
      if (g.length === 2) { // 2組だけの同率は直接対決
        const m = ms.find(m => (m.a === g[0].c && m.b === g[1].c) || (m.a === g[1].c && m.b === g[0].c));
        const r = m && getRec(m, results);
        if (r && outcome(r) !== "D") {
          const winner = outcome(r) === "A" ? m.a : m.b;
          if (winner === g[1].c) g.reverse();
          resolved = true;
        }
      }
      if (!resolved) {
        if (g.every(x => ov.includes(x.c))) { // 本部が手動で決めた順位
          g.sort((x, y) => ov.indexOf(x.c) - ov.indexOf(y.c));
          g.forEach(x => { x.manual = true; });
        } else {
          tie = true;
          g.sort((x, y) => x.c - y.c);
        }
      }
    }
    g.forEach((x, k) => { x.pos = i + k + 1; x.tie = tie; x.rank = tie ? i + 1 : i + k + 1; });
    if (tie && i < CONFIG.ADVANCE) undecided = true; // 進出順位に関わる同率
    sorted.push(...g);
    i = j;
  }
  const complete = done === ms.length;
  return {
    league: L, rows: sorted, done, total: ms.length, complete, undecided,
    settled: complete && !undecided,
    tied: sorted.filter(r => r.tie && r.rank <= CONFIG.ADVANCE),
  };
}

/* ---------- 決勝トーナメント ---------- */
function bracket(sts, results) {
  const [L1, L2] = LEAGUES, [s1, s2] = sts;
  const pick = (st, k) => (st.settled ? st.rows[k - 1].c : null);   // 確定
  const prov = (st, k) => (st.done > 0 ? st.rows[k - 1].c : null);  // 暫定
  const mk = (id, name, aSrc, bSrc, a, b, pa, pb) => {
    const raw = results[id];
    let rec = null, stale = false;
    if (raw) {
      if (a && b && ((raw.a === a && raw.b === b) || (raw.a === b && raw.b === a))) rec = orient(raw, a);
      else stale = true; // リーグ戦の修正で対戦カードが変わった
    }
    const winner = rec ? koWinner(rec) : null;
    return {
      id, name, title: name, sub: "決勝トーナメント", aSrc, bSrc, a, b, pa, pb, rec, stale,
      winner, loser: winner ? (winner === a ? b : a) : null, ready: !!(a && b), ko: true,
    };
  };
  const sf1 = mk("SF1", "準決勝A", `${L1.name}1位`, `${L2.name}2位`, pick(s1, 1), pick(s2, 2), prov(s1, 1), prov(s2, 2));
  const sf2 = mk("SF2", "準決勝B", `${L2.name}1位`, `${L1.name}2位`, pick(s2, 1), pick(s1, 2), prov(s2, 1), prov(s1, 2));
  const tp = mk("TP", "3位決定戦", "準決勝A敗者", "準決勝B敗者", sf1.loser, sf2.loser);
  const fin = mk("F", "決勝", "準決勝A勝者", "準決勝B勝者", sf1.winner, sf2.winner);
  return [sf1, sf2, tp, fin];
}

if (typeof module !== "undefined") {
  module.exports = { standings, bracket, getRec, outcome, koWinner, LEAGUE_MATCHES, ALL_LEAGUE_MATCHES };
}
