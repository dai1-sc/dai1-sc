"use strict";
/* 審判用：試合を選んで、ゲームごとの内野の残り人数を入力する */

let DATA = { results: {}, overrides: {} }, STS = [], KO = [];
let SEL = null, form = null, busy = false, shown = 2;

document.getElementById("t").textContent = CONFIG.TITLE;
if (API.local) {
  $("#banner").innerHTML = '<div class="banner">テストモードです。結果はこの端末のブラウザ内にだけ保存されます（config.js の API_URL が未設定）。</div>';
}

function recompute() {
  STS = LEAGUES.map(L => standings(L, DATA.results, DATA.overrides));
  KO = bracket(STS, DATA.results);
}
function matches() {
  const lg = ALL_LEAGUE_MATCHES.map(m => ({
    id: m.id, a: m.a, b: m.b, title: `第${m.no}試合`, sub: leagueOf(m.a).name,
    ready: true, ko: false, rec: getRec(m, DATA.results),
  }));
  return [...lg, ...KO];
}
const find = id => matches().find(m => m.id === id);

async function refresh() {
  DATA = await API.load();
  recompute();
  renderChips();
}

function chip(m) {
  const teams = m.a && m.b ? `${m.a}組 − ${m.b}組` : "対戦カード未定";
  const state = m.rec ? `入力済 ${m.rec.sa}対${m.rec.sb}` : m.ready ? "未入力" : "リーグ終了後";
  return `<button type="button" class="chip${m.id === SEL ? " on" : ""}${m.rec ? " done" : ""}" data-id="${m.id}"${m.ready ? "" : " disabled"}>
    <b>${m.title}</b><span>${teams}</span><i>${state}</i></button>`;
}
function renderChips() {
  const ms = matches();
  $("#chips").innerHTML =
    `<h2 class="group">リーグ戦</h2><div class="chips">${ms.filter(m => !m.ko).map(chip).join("")}</div>` +
    `<h2 class="group">決勝トーナメント</h2><div class="chips">${ms.filter(m => m.ko).map(chip).join("")}</div>`;
}

function select(id) {
  const m = find(id);
  if (!m || !m.ready) return;
  SEL = id;
  const gs = m.rec && m.rec.games.length ? m.rec.games.map(g => [g[0], g[1]]) : [];
  while (gs.length < CONFIG.GAMES.min) gs.push([null, null]);
  form = { games: gs };
  history.replaceState(null, "", "?m=" + id);
  renderChips();
  renderForm();
  $("#form").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* コートの図：左右に対戦する2クラス */
function courtSVG(A, B) {
  return `<svg class="court" viewBox="0 0 800 380" role="img" aria-label="${A}と${B}のコート">
    <rect width="800" height="380" fill="var(--floor)"/>
    <rect x="60" y="50" width="340" height="280" fill="var(--sideA)"/>
    <rect x="400" y="50" width="340" height="280" fill="var(--sideB)"/>
    <g stroke="#fff" stroke-width="5" fill="none"><rect x="60" y="50" width="680" height="280"/><line x1="400" y1="50" x2="400" y2="330"/></g>
    <g fill="#8a7a55" font-size="20" text-anchor="middle">
      <text x="230" y="30">外野</text><text x="570" y="30">外野</text>
      <text x="230" y="362">外野</text><text x="570" y="362">外野</text>
    </g>
    <g text-anchor="middle" fill="var(--ink)">
      <text x="230" y="150" font-size="22" fill="#4a5a66">内野</text>
      <text x="570" y="150" font-size="22" fill="#6b4a3f">内野</text>
      <text x="230" y="250" font-size="96" font-weight="700">${A}</text>
      <text x="570" y="250" font-size="96" font-weight="700">${B}</text>
    </g>
  </svg>`;
}

function gameRow(i, A, B) {
  const st = s => {
    const v = form.games[i][s === "a" ? 0 : 1];
    return `<div class="stepper"><button type="button" data-i="${i}" data-s="${s}" data-d="-1" aria-label="1減らす">−</button>
    <input type="number" inputmode="numeric" min="0" max="99" placeholder="0" id="g${i}${s}" data-i="${i}" data-s="${s}" value="${v === null ? "" : v}">
    <button type="button" data-i="${i}" data-s="${s}" data-d="1" aria-label="1増やす">＋</button></div>`;
  };
  return `<section class="field"><h3>第${i + 1}ゲーム<small>終了時に内野に残っていた人数</small></h3>
    <div class="pair"><div class="side"><span class="who">${A}</span>${st("a")}</div><span class="vs">対</span>
    <div class="side"><span class="who">${B}</span>${st("b")}</div></div>
    <div class="gres" id="gr${i}"></div></section>`;
}

function renderForm() {
  const m = find(SEL), box = $("#form");
  if (!m) { box.innerHTML = '<p class="hint">上の一覧から試合を選んでください。</p>'; return; }
  const A = m.a + "組", B = m.b + "組";
  box.innerHTML = `
    <div class="matchhead"><b>${m.title}</b><span>${m.sub}</span></div>
    ${courtSVG(A, B)}
    <p class="rule">${m.ko ? "決着がつくまで" : `${CONFIG.GAMES.min}ゲーム行い、勝ちゲーム数が並んだら次のゲームを行います。`}各ゲームが終わるたびに、内野に残っていた人数を入力してください。</p>
    <div id="games"></div>
    <div id="sum" class="sum"></div>
    <div id="msg" class="msg" role="status"></div>
    <div class="actions">
      <button type="button" id="save" class="primary">${m.rec ? "修正を保存" : "結果を保存"}</button>
      ${m.rec ? '<button type="button" id="del" class="link">この結果を取り消す</button>' : ""}
    </div>`;
  renderGames();
}

// ゲーム入力欄を作り直す（ゲーム数が増減したときだけ）。入力中の欄はフォーカスを戻す
function renderGames() {
  const m = find(SEL);
  if (!m) return;
  const A = m.a + "組", B = m.b + "組";
  shown = gameCount(form.games, m.ko);
  while (form.games.length < shown) form.games.push([null, null]);
  const act = document.activeElement && document.activeElement.id;
  $("#games").innerHTML = Array.from({ length: shown }, (_, i) => gameRow(i, A, B)).join("");
  if (act && act[0] === "g") { const el = document.getElementById(act); if (el) el.focus(); }
  updateSum();
}

function check(m) {
  const n = gameCount(form.games, m.ko), gs = form.games.slice(0, n);
  for (let i = 0; i < n; i++) {
    const g = gs[i];
    if (!gameDone(g)) return { err: `第${i + 1}ゲームの内野に残っていた人数を、両方入力してください` };
    if (g.some(x => x < 0 || x > 99)) return { err: "人数は0〜99で入力してください" };
  }
  const t = tally(gs);
  if (m.ko && t.sa === t.sb) return { err: "勝ちゲーム数が同じです。決着がつくまでゲームを行って入力してください" };
  return { games: gs, ...t, win: t.sa > t.sb ? m.a : t.sa < t.sb ? m.b : 0 };
}

function updateSum() {
  const m = find(SEL), el = $("#sum");
  if (!m || !el) return;
  form.games.slice(0, shown).forEach((g, i) => {
    const r = $("#gr" + i);
    if (!r) return;
    const d = gameDone(g) ? g[0] - g[1] : null;
    r.textContent = d === null ? "" : d > 0 ? `${m.a}組の勝ち（内野差 ${d}）` : d < 0 ? `${m.b}組の勝ち（内野差 ${-d}）` : "引き分け（内野差 0）";
  });
  const c = check(m);
  el.className = "sum";
  if (c.err) { el.textContent = c.err; return; }
  if (!c.win) { el.innerHTML = `引き分け　（得失点差 ±0）`; return; }
  const left = c.win === m.a;
  const diffs = side => c.games.filter(g => (side === "a" ? g[0] > g[1] : g[1] > g[0])).map(g => Math.abs(g[0] - g[1]));
  const mine = diffs(left ? "a" : "b"), other = diffs(left ? "b" : "a");
  const pts = mine.reduce((x, y) => x + y, 0), loser = left ? m.b : m.a;
  el.innerHTML = `${c.win}組の勝ち　${mine.length}勝${other.length}敗　（得失点差 ${c.win}組 +${pts}）` +
    `<small>${c.win}組が勝ったゲームの内野差：${mine.join("＋")} ＝ ${pts}` +
    (other.length ? `　／　${loser}組が勝ったゲームの内野差（${other.join("、")}）は数えません` : "") + "</small>";
}

function afterChange() {
  const m = find(SEL);
  if (m && gameCount(form.games, m.ko) !== shown) renderGames(); else updateSum();
}

function toast(t) {
  const el = $("#toast");
  el.textContent = t; el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), 2400);
}

$("#chips").addEventListener("click", e => {
  const b = e.target.closest(".chip");
  if (b && !b.disabled) select(b.dataset.id);
});

$("#form").addEventListener("click", async e => {
  const step = e.target.closest(".stepper button");
  if (step) {
    const i = Number(step.dataset.i), k = step.dataset.s === "a" ? 0 : 1, d = Number(step.dataset.d);
    const cur = Number.isInteger(form.games[i][k]) ? form.games[i][k] : 0;
    form.games[i][k] = Math.max(0, Math.min(99, cur + d));
    $(`#g${i}${step.dataset.s}`).value = form.games[i][k];
    afterChange();
    return;
  }
  const m = find(SEL);
  if (!m) return;
  if (e.target.id === "save") {
    if (busy) return;
    const c = check(m);
    if (c.err) { $("#msg").textContent = c.err; return; }
    busy = true; $("#save").disabled = true; $("#save").textContent = "保存中…"; $("#msg").textContent = "";
    try {
      await API.post({ action: "save", record: { id: m.id, a: m.a, b: m.b, sa: c.sa, sb: c.sb, ia: c.ia, ib: c.ib, games: encGames(c.games) } });
      await refresh();
      renderForm();
      toast("保存しました");
    } catch (err) {
      renderForm();
      $("#msg").textContent = "保存できませんでした：" + err.message + "（通信を確認してもう一度押してください）";
    }
    busy = false;
  } else if (e.target.id === "del") {
    if (!confirm(`${m.title}の結果を取り消しますか？`)) return;
    try {
      await API.post({ action: "delete", id: m.id });
      form = { games: Array.from({ length: CONFIG.GAMES.min }, () => [null, null]) };
      await refresh();
      renderForm();
      toast("取り消しました");
    } catch (err) {
      $("#msg").textContent = "取り消せませんでした：" + err.message;
    }
  }
});

$("#form").addEventListener("input", e => {
  const t = e.target;
  if (t.tagName !== "INPUT" || t.dataset.i === undefined) return;
  const v = parseInt(t.value, 10);
  form.games[Number(t.dataset.i)][t.dataset.s === "a" ? 0 : 1] = Number.isNaN(v) ? null : v;
  afterChange();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh().catch(() => {}); });

(async function init() {
  try {
    await refresh();
    renderForm();
    const id = new URLSearchParams(location.search).get("m");
    if (id) select(id);
  } catch (err) {
    $("#chips").innerHTML = `<p class="err">読み込みに失敗しました：${err.message}</p><button type="button" class="link" onclick="location.reload()">再読み込み</button>`;
  }
})();
