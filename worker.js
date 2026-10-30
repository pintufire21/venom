const RULES = [
  "Trend aligned (EMA 9, 21, 50)",
  "MACD momentum building",
  "RSI in safe zone",
  "Room inside Bollinger band",
  "Confirming candle",
];

function ema(a, n) {
  const k = 2 / (n + 1);
  const out = new Array(a.length);
  let prev = a[0];
  out[0] = prev;
  for (let i = 1; i < a.length; i++) {
    prev = a[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(c, n = 14) {
  const out = new Array(c.length).fill(NaN);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function macdHist(c) {
  const f = ema(c, 12), s = ema(c, 26);
  const m = c.map((_, i) => f[i] - s[i]);
  const sig = ema(m, 9);
  return m.map((v, i) => v - sig[i]);
}

function bollinger(c, n = 20, k = 2) {
  const up = new Array(c.length).fill(NaN);
  const mid = up.slice(), lo = up.slice();
  for (let i = n - 1; i < c.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += c[j];
    const m = s / n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (c[j] - m) * (c[j] - m);
    const sd = Math.sqrt(v / n);
    mid[i] = m; up[i] = m + k * sd; lo[i] = m - k * sd;
  }
  return { up, mid, lo };
}

function atr(h, l, c, n = 14) {
  const out = new Array(c.length).fill(NaN);
  if (c.length <= n) return out;
  const tr = (i) => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let s = 0;
  for (let i = 1; i <= n; i++) s += tr(i);
  let a = s / n;
  out[n] = a;
  for (let i = n + 1; i < c.length; i++) {
    a = (a * (n - 1) + tr(i)) / n;
    out[i] = a;
  }
  return out;
}

function wilson(w, n) {
  const z = 1.96, p = w / n, d = 1 + (z * z) / n;
  const ctr = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, ctr - half), Math.min(1, ctr + half)];
}

function prep(cs) {
  const c = cs.map((x) => x.c), h = cs.map((x) => x.h), l = cs.map((x) => x.l);
  return {
    cs, c,
    e9: ema(c, 9), e21: ema(c, 21), e50: ema(c, 50),
    R: rsi(c, 14), H: macdHist(c), B: bollinger(c, 20, 2), A: atr(h, l, c, 14),
  };
}

// d = 1 for CALL, -1 for PUT. Returns 5 booleans, one per rule.
function flags(S, i, d) {
  const { cs, c, e9, e21, e50, R, H, B } = S;
  const up = d === 1;
  return [
    d * (e9[i] - e21[i]) > 0 && d * (e21[i] - e50[i]) > 0,
    d * H[i] > 0 && d * (H[i] - H[i - 1]) > 0,
    up ? R[i] >= 48 && R[i] <= 68 : R[i] <= 52 && R[i] >= 32,
    up ? c[i] < B.up[i] - 0.25 * (B.up[i] - B.mid[i]) : c[i] > B.lo[i] + 0.25 * (B.mid[i] - B.lo[i]),
    d * (c[i] - cs[i].o) > 0,
  ];
}

// cs = closed candles, oldest first.
function analyze(cs) {
  const S = prep(cs), last = cs.length - 1;
  const fu = flags(S, last, 1), fd = flags(S, last, -1);
  const cu = fu.filter(Boolean).length, cd = fd.filter(Boolean).length;
  const dir = cu === 5 ? 1 : cd === 5 ? -1 : 0;
  const best = cu >= cd ? 1 : -1;
  let w = 0, l = 0;
  for (let i = 60; i < last; i++) {
    let d = 0;
    if (flags(S, i, 1).every(Boolean)) d = 1;
    else if (flags(S, i, -1).every(Boolean)) d = -1;
    if (!d) continue;
    const diff = (cs[i + 1].c - cs[i].c) * d;
    if (diff > 0) w++; else if (diff < 0) l++;
  }
  const n = w + l;
  return {
    dir, best,
    bestFlags: best === 1 ? fu : fd,
    bestCount: best === 1 ? cu : cd,
    price: cs[last].c,
    ind: { rsi: S.R[last], hist: S.H[last], histPrev: S.H[last - 1], atr: S.A[last] },
    bt: { w, l, n, wr: n ? w / n : 0, ci: n ? wilson(w, n) : [0, 0] },
  };
}

const MIN = 60000;
const TFS = [
  { k: "1m", td: "1min", bn: "1m", min: 1 },
  { k: "5m", td: "5min", bn: "5m", min: 5 },
  { k: "15m", td: "15min", bn: "15m", min: 15 },
  { k: "30m", td: "30min", bn: "30m", min: 30 },
  { k: "1h", td: "1h", bn: "1h", min: 60 },
  { k: "4h", td: "4h", bn: "4h", min: 240 },
];
const SCAN_TFS = ["5m", "15m", "30m", "1h"];
const MARKETS = [
  { name: "Crypto", src: "bn", pairs: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LTCUSDT"] },
  { name: "Forex", src: "td", pairs: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/JPY", "GBP/JPY", "EUR/GBP"] },
  { name: "Metals", src: "td", pairs: ["XAU/USD", "XAG/USD"] },
];
// Pairs Venom scans automatically. Edit this list to change them.
const WATCH = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "BTCUSDT", "ETHUSDT"];
const MODES = {
  strict: { name: "Strict", min: 0.6, n: 30, cap: 4 },
  balanced: { name: "Balanced", min: 0.56, n: 25, cap: 8 },
  loose: { name: "Loose", min: 0.54, n: 20, cap: 15 },
};
const DEF = { mode: "balanced", scan: true, tf: "15m", payout: 85 };

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const row = (a, b) => String(a).padEnd(12) + b;
const LINE = "-".repeat(30);
const fmtP = (p) => (p >= 1000 ? p.toFixed(2) : p >= 100 ? p.toFixed(3) : p.toFixed(5));
const pct = (x) => (x * 100).toFixed(0) + "%";
const pct1 = (x) => (x * 100).toFixed(1) + "%";
const label = (s) => (s.endsWith("USDT") ? s.slice(0, -4) + "/USDT" : s);
const istTime = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }) + " IST";
const istDay = (ms) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const kb = (rows) => ({ inline_keyboard: rows });
const btn = (t, d) => ({ text: t, callback_data: d });
const tfOf = (k) => TFS.find((t) => t.k === k);
const mkOf = (sym) => MARKETS.find((m) => m.pairs.includes(sym));
const ccys = (s) => (s.endsWith("USDT") ? ["USD"] : s.split("/"));
const breakeven = (payout) => 100 / (1 + payout / 100);

async function kget(env, k, d) { const v = await env.VENOM.get(k, "json"); return v == null ? d : v; }
const kput = (env, k, v) => env.VENOM.put(k, JSON.stringify(v));
const getSt = async (env) => Object.assign({}, DEF, await kget(env, "settings", {}));

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
const send = (env, text, markup) => {
  const b = { chat_id: env.OWNER_ID, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (markup) b.reply_markup = markup;
  return tg(env, "sendMessage", b);
};
async function show(env, chat, id, text, markup) {
  const body = { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  if (id) {
    const r = await tg(env, "editMessageText", Object.assign({ message_id: id }, body));
    if (r.ok || /not modified/i.test(r.description || "")) return r;
  }
  return tg(env, "sendMessage", body);
}

function isClosed(mk, ms) {
  if (mk.name === "Crypto") return false;
  const d = new Date(ms), day = d.getUTCDay(), h = d.getUTCHours();
  return day === 6 || (day === 5 && h >= 22) || (day === 0 && h < 22);
}

// ---------- market data ----------
async function fetchCandles(env, mk, sym, tf, limit) {
  const now = Date.now();
  let out;
  if (mk.src === "bn") {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf.bn}&limit=${limit}`);
    if (!r.ok) throw new Error("Crypto data unavailable (" + r.status + ")");
    const j = await r.json();
    out = j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
  } else {
    if (!env.TWELVE_KEY) throw new Error("TWELVE_KEY is not set, forex data is off.");
    const u = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${tf.td}&outputsize=${limit}&order=ASC&timezone=UTC&apikey=${env.TWELVE_KEY}`;
    const j = await (await fetch(u)).json();
    if (j.status === "error" || !j.values) throw new Error(j.message || "Forex data unavailable");
    out = j.values.map((v) => ({ t: Date.parse(v.datetime.replace(" ", "T") + "Z"), o: +v.open, h: +v.high, l: +v.low, c: +v.close }));
  }
  const ms = tf.min * MIN;
  while (out.length && out[out.length - 1].t + ms > now) out.pop(); // drop the candle still forming
  return out;
}

// ---------- news ----------
async function getNews(env) {
  const now = Date.now();
  const c = await kget(env, "news", null);
  if (c && now - c.at < 3600000) return c.ev;
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    if (!r.ok) throw new Error("status " + r.status);
    const j = await r.json();
    const ev = j.map((e) => ({ id: e.date + "|" + e.title, t: Date.parse(e.date), title: e.title, c: e.country, imp: e.impact, f: e.forecast || "", p: e.previous || "" })).filter((e) => !isNaN(e.t));
    await kput(env, "news", { at: now, ev });
    return ev;
  } catch (e) {
    await kput(env, "news", { at: now - 3000000, ev: c ? c.ev : [] }); // retry in about 10 minutes
    return c ? c.ev : [];
  }
}
const newsHit = (ev, sym, now) => {
  const cc = ccys(sym);
  return ev.find((e) => e.imp === "High" && cc.includes(e.c) && now >= e.t - 30 * MIN && now <= e.t + 30 * MIN);
};

// ---------- message builders ----------
function signalText(sym, tf, a, st, paper, now, hit) {
  const m = MODES[st.mode], bt = a.bt, up = a.dir === 1;
  const rows = [
    ["Pair", label(sym)], ["Timeframe", tf.k], ["Direction", up ? "▲ CALL (UP)" : "▼ PUT (DOWN)"],
    ["Entry", "next candle open"], ["Expiry", `1 candle (${tf.k})`], null,
    ["Win chance", bt.n ? pct(bt.wr) : "n/a"],
    ["95% range", bt.n ? `${pct(bt.ci[0])} to ${pct(bt.ci[1])}` : "n/a"],
    ["Based on", `${bt.n} past setups`],
    ["Breakeven", `${breakeven(st.payout).toFixed(1)}% at ${st.payout}%`], null,
    ["Price", fmtP(a.price)], ["Time", istTime(now)],
  ];
  const body = rows.map((r) => (r ? row(r[0], r[1]) : LINE)).join("\n");
  let t = `<b>VENOM  ${paper ? "SIGNAL" : "ANALYSIS"}</b>\n<pre>${esc(body)}</pre>`;
  if (paper) t += "\nPaper trade opened. The result will be posted when the next candle closes.";
  else if (bt.n < m.n || bt.wr < m.min) t += `\nBelow your ${m.name} quality filter. Venom would not auto-trade this.`;
  if (hit) t += `\n<b>News warning:</b> ${esc(hit.c)} ${esc(hit.title)} at ${istTime(hit.t)}. Avoid trading now.`;
  return t + "\n<i>Win chance is measured on past candles. It is an estimate, not a guarantee.</i>";
}

function waitText(sym, tf, a, st, now, hit) {
  const dirName = a.best === 1 ? "CALL" : "PUT";
  const rows = [
    ["Pair", label(sym)], ["Timeframe", tf.k], ["Direction", "WAIT"],
    ["Closest", `${dirName}, ${a.bestCount} of 5`], null,
    ["Price", fmtP(a.price)], ["RSI", a.ind.rsi.toFixed(1)],
    ["MACD", a.ind.hist > 0 ? "positive" : "negative"], ["Time", istTime(now)],
  ];
  const body = rows.map((r) => (r ? row(r[0], r[1]) : LINE)).join("\n");
  const rules = RULES.map((r, i) => `${a.bestFlags[i] ? "●" : "○"} ${r}`).join("\n");
  let t = `<b>VENOM  ANALYSIS</b>\n<pre>${esc(body)}</pre>\n<pre>${esc(rules)}</pre>\nVenom signals only when all 5 conditions agree.`;
  if (hit) t += `\n<b>News warning:</b> ${esc(hit.c)} ${esc(hit.title)} at ${istTime(hit.t)}.`;
  return t;
}

function resultText(t, exit, r, st) {
  const word = r === "W" ? "WIN" : r === "L" ? "LOSS" : "TIE";
  const body = [row("Pair", `${label(t.s)} ${t.tf}`), row("Call", t.d === 1 ? "▲ CALL" : "▼ PUT"), row("Entry", fmtP(t.e)), row("Exit", fmtP(exit)), row("Predicted", pct(t.p) + " win chance")].join("\n");
  return `<b>VENOM  RESULT: ${word}</b>\n<pre>${esc(body)}</pre>`;
}

function summarize(list) {
  let w = 0, l = 0, t = 0, ps = 0;
  for (const x of list) { if (x.r === "W") w++; else if (x.r === "L") l++; else t++; ps += x.p || 0; }
  const n = w + l;
  return { w, l, t, n, wr: n ? w / n : 0, ci: n ? wilson(w, n) : [0, 0], pred: list.length ? ps / list.length : 0 };
}
function groupBy(list, key) {
  const g = {};
  for (const x of list) (g[x[key]] = g[x[key]] || []).push(x);
  return Object.entries(g).map(([k, v]) => Object.assign({ k, cnt: v.length }, summarize(v))).sort((a, b) => b.cnt - a.cnt);
}
function streaks(list) {
  let cw = 0, cl = 0, mw = 0, ml = 0;
  for (const x of list) {
    if (x.r === "W") { cw++; cl = 0; } else if (x.r === "L") { cl++; cw = 0; }
    mw = Math.max(mw, cw); ml = Math.max(ml, cl);
  }
  return [mw, ml];
}
function reportText(title, open, closed, st, now) {
  const s = summarize(closed), be = breakeven(st.payout) / 100;
  if (!closed.length) {
    return `<b>VENOM  ${esc(title)}</b>\nNo finished paper trades yet. Venom opens one only when a setup passes your quality filter.\nOpen now: ${open.length}`;
  }
  const [mw, ml] = streaks(closed);
  const profit = s.w * (st.payout / 100) - s.l;
  const main = [
    row("Trades", closed.length), row("Win / Loss", `${s.w} / ${s.l}` + (s.t ? ` (${s.t} ties)` : "")),
    row("Win rate", s.n ? pct1(s.wr) : "n/a"), row("95% range", s.n ? `${pct(s.ci[0])} to ${pct(s.ci[1])}` : "n/a"),
    row("Predicted", pct1(s.pred) + " avg"), row("Breakeven", pct1(be)),
    row("Sim profit", `${profit >= 0 ? "+" : ""}${profit.toFixed(2)} units`), row("Streaks", `best ${mw} wins, worst ${ml} losses`),
  ].join("\n");
  const line = (g, nm) => `${nm.padEnd(10)}${String(g.cnt).padStart(4)}   ${g.n ? pct(g.wr) : "n/a"}`;
  const byTf = groupBy(closed, "tf").map((g) => line(g, g.k)).join("\n");
  const byPair = groupBy(closed, "s").slice(0, 6).map((g) => line(g, label(g.k))).join("\n");
  const byDir = groupBy(closed, "d").map((g) => line(g, g.k === "1" ? "CALL" : "PUT")).join("\n");
  let verdict;
  if (s.n < 100) verdict = `Only ${s.n} decided trades. Too few to judge. Keep it running to 100+.`;
  else if (s.ci[0] > be) verdict = "Edge looks real so far: the low end of the range is above breakeven.";
  else if (s.ci[1] < be) verdict = "Below breakeven. Do not trade real money with this setup.";
  else verdict = "Not proven. The result is still inside the noise range.";
  let t = `<b>VENOM  ${esc(title)}</b>\n${istDay(now)}, ${istTime(now)}\n<pre>${esc(main)}</pre>`;
  t += `<b>By timeframe</b>\n<pre>${esc(byTf)}</pre><b>By pair</b>\n<pre>${esc(byPair)}</pre><b>By direction</b>\n<pre>${esc(byDir)}</pre>`;
  if (closed.length >= 100) {
    const l100 = summarize(closed.slice(-100));
    t += `<b>Last 100</b>\n<pre>${esc(`${l100.w} wins, ${l100.l} losses, ${l100.n ? pct1(l100.wr) : "n/a"}`)}</pre>`;
  }
  return t + `<b>Verdict</b>\n${verdict}\nOpen now: ${open.length}`;
}

async function analysisText(env, mi, pj, tk, st) {
  const mk = MARKETS[mi], sym = mk.pairs[pj], tf = TFS[tk], now = Date.now();
  if (isClosed(mk, now)) return `<b>${label(sym)}</b>\nThis market is closed. Forex and metals reopen Monday 03:30 IST.`;
  const cs = await fetchCandles(env, mk, sym, tf, 600);
  if (cs.length < 120) throw new Error("Not enough candle data for this pair.");
  const a = analyze(cs), hit = newsHit(await getNews(env), sym, now);
  return a.dir ? signalText(sym, tf, a, st, false, now, hit) : waitText(sym, tf, a, st, now, hit);
}

// ---------- menus ----------
function menuText(st) {
  return `<b>VENOM</b>\nMarket analysis with honest paper-trade tracking.\n<pre>${esc(row("Auto scan", st.scan ? "ON" : "OFF") + "\n" + row("Quality", MODES[st.mode].name) + "\n" + row("Scan on", st.tf + " candles"))}</pre>`;
}
const menuKb = (st) => kb([
  [btn("Analyse", "an"), btn(st.scan ? "Auto scan: ON" : "Auto scan: OFF", "as")],
  [btn("Stats", "st"), btn("News", "nw")],
  [btn("Settings", "set"), btn("OTC screenshot", "otc")],
]);
async function showMenu(env, chat, id) { const st = await getSt(env); return show(env, chat, id, menuText(st), menuKb(st)); }

function settingsView(st) {
  const m = MODES[st.mode];
  const mark = (on, t) => (on ? "• " + t : t);
  const text = `<b>Settings</b>\n<pre>${esc(row("Quality", `${m.name}`) + "\n" + row("Min win", pct(m.min) + ` on ${m.n}+ setups`) + "\n" + row("Max per day", m.cap) + "\n" + row("Scan on", st.tf) + "\n" + row("Payout", st.payout + "%"))}</pre>`;
  return {
    text,
    markup: kb([
      Object.keys(MODES).map((k) => btn(mark(st.mode === k, MODES[k].name), "s:mode:" + k)),
      SCAN_TFS.map((k) => btn(mark(st.tf === k, k), "s:tf:" + k)),
      [80, 85, 90].map((p) => btn(mark(st.payout === p, p + "%"), "s:pay:" + p)),
      [btn("Back", "menu")],
    ]),
  };
}

async function onCb(env, cb) {
  const chat = cb.message.chat.id, id = cb.message.message_id, d = cb.data, p = d.split(":");
  const st = await getSt(env);
  if (d === "menu") return showMenu(env, chat, id);
  if (d === "an") return show(env, chat, id, "<b>Choose a market</b>", kb([MARKETS.map((m, i) => btn(m.name, "m:" + i)), [btn("Back", "menu")]]));
  if (p[0] === "m") {
    const mi = +p[1], mk = MARKETS[mi];
    const rows = chunk(mk.pairs.map((s, j) => btn(label(s), `p:${mi}:${j}`)), 3);
    rows.push([btn("Back", "an")]);
    return show(env, chat, id, `<b>${mk.name}</b>\nChoose a pair`, kb(rows));
  }
  if (p[0] === "p") {
    const rows = chunk(TFS.map((t, k) => btn(t.k, `t:${p[1]}:${p[2]}:${k}`)), 3);
    rows.push([btn("Back", "m:" + p[1])]);
    return show(env, chat, id, `<b>${label(MARKETS[+p[1]].pairs[+p[2]])}</b>\nChoose a timeframe`, kb(rows));
  }
  if (p[0] === "t") {
    await show(env, chat, id, "Analysing...", null);
    const text = await analysisText(env, +p[1], +p[2], +p[3], st);
    return show(env, chat, id, text, kb([[btn("Refresh", d), btn("Back", `p:${p[1]}:${p[2]}`)], [btn("Menu", "menu")]]));
  }
  if (d === "as") { st.scan = !st.scan; await kput(env, "settings", st); return showMenu(env, chat, id); }
  if (d === "set") { const v = settingsView(st); return show(env, chat, id, v.text, v.markup); }
  if (p[0] === "s") {
    if (p[1] === "mode" && MODES[p[2]]) st.mode = p[2];
    if (p[1] === "tf" && SCAN_TFS.includes(p[2])) st.tf = p[2];
    if (p[1] === "pay" && [80, 85, 90].includes(+p[2])) st.payout = +p[2];
    await kput(env, "settings", st);
    const v = settingsView(st);
    return show(env, chat, id, v.text, v.markup);
  }
  if (d === "st") {
    const open = await kget(env, "open", []), closed = await kget(env, "closed", []);
    return show(env, chat, id, reportText("STATS", open, closed, st, Date.now()), kb([[btn("Back", "menu")]]));
  }
  if (d === "nw") return show(env, chat, id, await newsText(env), kb([[btn("Back", "menu")]]));
  if (d === "otc") {
    return show(env, chat, id, "<b>OTC screenshot</b>\nSend a chart screenshot as a photo (not as a file). Venom reads it with AI and replies with a rough direction.\nOTC prices are made by the broker, so this cannot be back-tested and is marked unverified.\nFirst time only: send /agree.", kb([[btn("Back", "menu")]]));
  }
}

async function newsText(env) {
  const now = Date.now(), ev = (await getNews(env)).filter((e) => e.imp === "High" && e.t > now - 30 * MIN && e.t < now + 36 * 3600000).sort((a, b) => a.t - b.t).slice(0, 10);
  if (!ev.length) return "<b>VENOM  NEWS</b>\nNo high impact events in the next 36 hours.";
  const lines = ev.map((e) => `${istDay(e.t)} ${istTime(e.t).replace(" IST", "")}  ${e.c}  ${e.title}`).join("\n");
  return `<b>VENOM  NEWS</b>\nHigh impact, IST\n<pre>${esc(lines)}</pre>Venom pauses auto signals on affected pairs from 30 min before to 30 min after each event.`;
}

// ---------- OTC screenshot ----------
const VISION = "@cf/meta/llama-3.2-11b-vision-instruct";
const OTC_PROMPT = 'You are reading a candlestick chart screenshot from a trading platform. Look at the last 10 candles: trend, candle sizes, any clear support, resistance or reversal. Reply ONLY with JSON: {"direction":"UP" or "DOWN" or "WAIT","confidence":"low" or "medium" or "high","reason":"one short sentence"}. If the chart is unclear use WAIT.';
function toB64(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
async function handlePhoto(env, m) {
  const chat = m.chat.id;
  if (!env.AI) return tg(env, "sendMessage", { chat_id: chat, text: "The AI binding is not set up yet. See SETUP.md." });
  await tg(env, "sendMessage", { chat_id: chat, text: "Reading the chart. This takes a few seconds." });
  const ph = m.photo[m.photo.length - 1];
  const f = await tg(env, "getFile", { file_id: ph.file_id });
  if (!f.ok) throw new Error("Could not download the screenshot.");
  const buf = await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer();
  let res;
  try {
    res = await env.AI.run(VISION, { messages: [{ role: "user", content: [{ type: "text", text: OTC_PROMPT }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + toB64(buf) } }] }], max_tokens: 300 });
  } catch (e) {
    if (/agree|licen/i.test(String(e && e.message))) return tg(env, "sendMessage", { chat_id: chat, text: "Send /agree once to accept the model license, then send the screenshot again." });
    res = await env.AI.run(VISION, { prompt: OTC_PROMPT, image: Array.from(new Uint8Array(buf)), max_tokens: 300 });
  }
  const raw = String((res && (res.response || (res.result && res.result.response))) || "");
  let j = null;
  try { j = JSON.parse((raw.match(/\{[\s\S]*\}/) || [""])[0]); } catch (e) { /* keep raw */ }
  let text;
  if (j && j.direction) {
    const dir = String(j.direction).toUpperCase();
    const arrow = dir === "UP" ? "▲ UP" : dir === "DOWN" ? "▼ DOWN" : "WAIT";
    text = `<b>VENOM  OTC READ (unverified)</b>\n<pre>${esc(row("Direction", arrow) + "\n" + row("Confidence", String(j.confidence || "low") + " (AI judgement)"))}</pre>\n${esc(String(j.reason || "").slice(0, 200))}\n<i>OTC prices are made by the broker. This cannot be back-tested. Treat it as a rough read and keep stakes small.</i>`;
  } else {
    text = `<b>VENOM  OTC READ (unverified)</b>\n${esc(raw.slice(0, 500) || "The AI gave no answer. Try a clearer screenshot.")}`;
  }
  return tg(env, "sendMessage", { chat_id: chat, text, parse_mode: "HTML" });
}

// ---------- Telegram updates ----------
async function onMsg(env, m) {
  const txt = (m.text || "").trim(), chat = m.chat.id;
  if (m.photo) return handlePhoto(env, m);
  if (/^\/(start|menu)\b/i.test(txt)) return showMenu(env, chat, null);
  const st = await getSt(env);
  if (/^\/stats\b/i.test(txt)) return show(env, chat, null, reportText("STATS", await kget(env, "open", []), await kget(env, "closed", []), st, Date.now()));
  if (/^\/report\b/i.test(txt)) return show(env, chat, null, reportText("REPORT", await kget(env, "open", []), await kget(env, "closed", []), st, Date.now()));
  if (/^\/news\b/i.test(txt)) return show(env, chat, null, await newsText(env));
  if (/^\/settings\b/i.test(txt)) { const v = settingsView(st); return show(env, chat, null, v.text, v.markup); }
  if (/^\/agree\b/i.test(txt)) {
    if (!env.AI) return tg(env, "sendMessage", { chat_id: chat, text: "The AI binding is not set up yet." });
    try { await env.AI.run(VISION, { prompt: "agree" }); } catch (e) { /* the license call can answer with an error text */ }
    return tg(env, "sendMessage", { chat_id: chat, text: "Done. Now send a chart screenshot as a photo." });
  }
  const q = txt.match(/^\/a\s+(\S+)\s+(\S+)/i);
  if (q) {
    const want = q[1].toUpperCase().replace("/", ""), tf = tfOf(q[2].toLowerCase());
    for (let mi = 0; mi < MARKETS.length; mi++) {
      const pj = MARKETS[mi].pairs.findIndex((s) => s.replace("/", "") === want);
      if (pj >= 0 && tf) return show(env, chat, null, await analysisText(env, mi, pj, TFS.indexOf(tf), st));
    }
    return tg(env, "sendMessage", { chat_id: chat, text: "Pair or timeframe not found. Example: /a EURUSD 15m" });
  }
  return showMenu(env, chat, null);
}

async function onUpdate(env, u) {
  const cb = u.callback_query, m = u.message;
  const from = (cb ? cb.from : m && m.from) && (cb ? cb.from : m.from).id;
  const chat = cb ? cb.message && cb.message.chat.id : m && m.chat.id;
  if (!from || !chat) return;
  if (!env.OWNER_ID) return tg(env, "sendMessage", { chat_id: chat, text: `Your Telegram ID is ${from}. Save it as the OWNER_ID secret, then redeploy.` });
  if (String(from) !== String(env.OWNER_ID)) return tg(env, "sendMessage", { chat_id: chat, text: "This is a private bot." });
  try {
    if (cb) { await tg(env, "answerCallbackQuery", { callback_query_id: cb.id }); await onCb(env, cb); }
    else if (m) await onMsg(env, m);
  } catch (e) {
    await tg(env, "sendMessage", { chat_id: chat, text: "Problem: " + String((e && e.message) || e).slice(0, 300) });
  }
}

// ---------- scheduled work ----------
async function scanOne(env, mk, sym, tf, bucket) {
  const ms = tf.min * MIN;
  for (let k = 0; k < 3; k++) {
    try {
      const cs = await fetchCandles(env, mk, sym, tf, 600);
      if (cs.length >= 120 && cs[cs.length - 1].t + ms >= bucket * ms - 5000) return cs;
    } catch (e) { if (k === 2) return null; }
    if (k < 2) await sleep(4000);
  }
  return null;
}

async function cron(env) {
  if (!env.OWNER_ID) return;
  const now = Date.now(), st = await getSt(env);
  const meta = Object.assign({ scanned: {}, news: {}, lastReport: now, total: 0, reportedTotal: 0, day: "", count: 0 }, await kget(env, "meta", {}));
  let open = await kget(env, "open", []), closed = await kget(env, "closed", []);
  let openDirty = false, closedDirty = false, metaDirty = false;
  const ev = await getNews(env);

  // 1. settle paper trades whose candle has closed
  const due = open.filter((t) => now >= t.t + tfOf(t.tf).min * MIN + 15000);
  if (due.length) {
    const keys = [...new Set(due.map((t) => t.s + "|" + t.tf))], data = {};
    await Promise.all(keys.map(async (g) => {
      const [s, k] = g.split("|");
      try { data[g] = await fetchCandles(env, mkOf(s), s, tfOf(k), 12); } catch (e) { data[g] = null; }
    }));
    for (const t of due) {
      const cs = data[t.s + "|" + t.tf], c = cs && cs.find((x) => x.t === t.t);
      if (!c) {
        if (now > t.t + tfOf(t.tf).min * MIN + 6 * 3600000) { open = open.filter((x) => x.id !== t.id); openDirty = true; }
        continue;
      }
      const diff = (c.c - t.e) * t.d, r = diff > 0 ? "W" : diff < 0 ? "L" : "T";
      closed.push({ s: t.s, tf: t.tf, d: t.d, e: t.e, x: c.c, r, p: t.p, t: t.t });
      open = open.filter((x) => x.id !== t.id);
      meta.total++; openDirty = closedDirty = metaDirty = true;
      await send(env, resultText(t, c.c, r, st));
    }
    if (closed.length > 1000) closed = closed.slice(-1000);
  }

  // 2. news alerts
  for (const e of ev) {
    if (e.imp === "High" && e.t > now && e.t - now <= 20 * MIN && !meta.news[e.id]) {
      meta.news[e.id] = now; metaDirty = true;
      const body = `${e.c}  ${e.title}\nStarts ${istTime(e.t)} (in ${Math.round((e.t - now) / MIN)} min)` + (e.f || e.p ? `\nForecast ${e.f || "-"}  Previous ${e.p || "-"}` : "");
      await send(env, `<b>VENOM  NEWS ALERT</b>\n<pre>${esc(body)}</pre>Auto signals on ${esc(e.c)} pairs are paused from 30 min before to 30 min after.`);
    }
  }
  for (const k of Object.keys(meta.news)) if (now - meta.news[k] > 3 * 86400000) { delete meta.news[k]; metaDirty = true; }

  // 3. scan the watchlist when a candle has just closed
  if (st.scan && SCAN_TFS.includes(st.tf)) {
    const tf = tfOf(st.tf), ms = tf.min * MIN, bucket = Math.floor(now / ms), mode = MODES[st.mode];
    const today = istDay(now);
    if (meta.day !== today) { meta.day = today; meta.count = 0; metaDirty = true; }
    const items = WATCH.filter((sym) => !isClosed(mkOf(sym), now) && meta.scanned[sym + "|" + tf.k] !== bucket);
    for (const sym of items) meta.scanned[sym + "|" + tf.k] = bucket;
    if (items.length) metaDirty = true;
    if (items.length && now - bucket * ms <= 150000) {
      const res = await Promise.all(items.map(async (sym) => ({ sym, cs: await scanOne(env, mkOf(sym), sym, tf, bucket) })));
      for (const r of res) {
        if (!r.cs) continue;
        const a = analyze(r.cs);
        if (!a.dir || a.bt.n < mode.n || a.bt.wr < mode.min) continue;
        if (newsHit(ev, r.sym, now) || open.some((t) => t.s === r.sym)) continue;
        if (meta.count >= mode.cap) break;
        meta.count++; metaDirty = true;
        const last = r.cs[r.cs.length - 1];
        open.push({ id: r.sym + "|" + last.t, s: r.sym, tf: tf.k, d: a.dir, e: last.c, t: last.t + ms, p: a.bt.wr });
        openDirty = true;
        await send(env, signalText(r.sym, tf, a, st, true, now, null));
      }
    }
  }

  // 4. reports: every 100 finished trades, and every 48 hours
  const since = meta.total - meta.reportedTotal;
  if (closed.length && (since >= 100 || now - meta.lastReport >= 48 * 3600000)) {
    await send(env, reportText(since >= 100 ? "100 TRADE REPORT" : "48 HOUR REPORT", open, closed, st, now));
    meta.lastReport = now; meta.reportedTotal = meta.total; metaDirty = true;
  }

  if (openDirty) await kput(env, "open", open);
  if (closedDirty) await kput(env, "closed", closed);
  if (metaDirty) await kput(env, "meta", meta);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/webhook") {
      if (env.WEBHOOK_SECRET && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const u = await req.json();
      ctx.waitUntil(onUpdate(env, u).catch((e) => console.log("update error", e && e.message)));
      return new Response("ok");
    }
    return new Response("Venom is running.");
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env).catch((e) => console.log("cron error", e && e.stack)));
  },
};
