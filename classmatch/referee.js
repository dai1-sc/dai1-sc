"use strict";
/* 審判用：試合を選んで結果を入力する */

let DATA = { results: {}, overrides: {} }, STS = [], KO = [];
let SEL = null, form = null, busy = false;

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
  const state = m.rec ? "入力済" : m.ready ? "未入力" : "リーグ終了後";
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
  form = m.rec ? { sa: m.rec.sa, sb: m.rec.sb, ia: m.rec.ia, ib: m.rec.ib } : { sa: 0, sb: 0, ia: 0, ib: 0 };
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

function field(title, note, k, A, B) {
  const st = key => `<div class="stepper"><button type="button" data-k="${key}" data-d="-1" aria-label="1減らす">−</button>
    <input type="number" inputmode="numeric" min="0" max="99" id="f-${key}" data-k="${key}" value="${form[key]}">
    <button type="button" data-k="${key}" data-d="1" aria-label="1増やす">＋</button></div>`;
  return `<section class="field"><h3>${title}<small>${note}</small></h3>
    <div class="pair"><div class="side"><span class="who">${A}</span>${st(k + "a")}</div><span class="vs">対</span>
    <div class="side"><span class="who">${B}</span>${st(k + "b")}</div></div></section>`;
}

function renderForm() {
  const m = find(SEL), box = $("#form");
  if (!m) { box.innerHTML = '<p class="hint">上の一覧から試合を選んでください。</p>'; return; }
  const A = m.a + "組", B = m.b + "組";
  box.innerHTML = `
    <div class="matchhead"><b>${m.title}</b><span>${m.sub}</span></div>
    ${courtSVG(A, B)}
    ${field("スコア", "（何対何だったか）", "s", A, B)}
    ${field("内野に残っていた人数", "（試合終了時）", "i", A, B)}
    <div id="sum" class="sum"></div>
    <div id="msg" class="msg" role="status"></div>
    <div class="actions">
      <button type="button" id="save" class="primary">${m.rec ? "修正を保存" : "結果を保存"}</button>
      ${m.rec ? '<button type="button" id="del" class="link">この結果を取り消す</button>' : ""}
    </div>`;
  updateSum();
}

function check(m) {
  for (const k of ["sa", "sb", "ia", "ib"]) {
    if (!Number.isInteger(form[k]) || form[k] < 0 || form[k] > 99) return { err: "0〜99の数字を入力してください" };
  }
  if (m.ko) {
    const w = koWinner({ a: m.a, b: m.b, ...form });
    if (!w) return { err: "スコアも内野の人数も同じです。延長戦などで決着をつけてから入力してください" };
    return { win: w, byInfield: form.sa === form.sb };
  }
  const o = outcome(form);
  return { win: o === "A" ? m.a : o === "B" ? m.b : 0 };
}

function updateSum() {
  const m = find(SEL), el = $("#sum");
  if (!m || !el) return;
  const c = check(m);
  if (c.err) { el.className = "sum bad"; el.textContent = c.err; return; }
  const d = form.ia - form.ib;
  const diff = d === 0 ? "内野差 ±0" : `内野差 ${d > 0 ? m.a : m.b}組 +${Math.abs(d)}`;
  el.className = "sum";
  el.innerHTML = `${c.win ? c.win + "組の勝ち" : "引き分け"}　${form.sa}対${form.sb}　（${diff}）` +
    (c.byInfield ? "<small>同スコアのため内野の残り人数で勝者を判定します</small>" : "");
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
    const k = step.dataset.k, d = Number(step.dataset.d);
    form[k] = Math.max(0, Math.min(99, (Number.isInteger(form[k]) ? form[k] : 0) + d));
    $("#f-" + k).value = form[k];
    updateSum();
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
      await API.post({ action: "save", record: { id: m.id, a: m.a, b: m.b, ...form } });
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
      form = { sa: 0, sb: 0, ia: 0, ib: 0 };
      await refresh();
      renderForm();
      toast("取り消しました");
    } catch (err) {
      $("#msg").textContent = "取り消せませんでした：" + err.message;
    }
  }
});

$("#form").addEventListener("input", e => {
  const k = e.target.dataset && e.target.dataset.k;
  if (!k || e.target.tagName !== "INPUT") return;
  form[k] = parseInt(e.target.value, 10);
  updateSum();
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
