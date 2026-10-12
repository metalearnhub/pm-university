/* PM University — single-page learning app for Dijae.
   Content: window.PMU (content.js). State: localStorage + linked Google Sheet (PayMeGPT). */
(function () {
'use strict';
const P = window.PMU;
const COACH_URL = 'https://paymegpt.com/agents/24733270/embed';
const DEFAULT_EMAIL = 'dijaedadula@gmail.com';
const KEY = 'pmu.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const words = s => (String(s).trim().match(/\S+/g) || []).length;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- index content ---------- */
const CH = {}; const ORDER = [];
P.courses.forEach(c => c.chapters.forEach((ch, i) => { ch.course = c.id; ch.idx = i; CH[ch.id] = ch; ORDER.push(ch.id); }));
const CARD = {}; P.cards.forEach(c => CARD[c.id] = c);
const SC = {}; P.scenarios.forEach(s => SC[s.id] = s);
const SIGNALS = P.checks.filter(c => c.ch.indexOf('30-day') > -1);

/* ---------- state ---------- */
function blank() {
  return { v: 1, email: DEFAULT_EMAIL, start: today(), xp: 0, updated: 0, days: {}, read: {}, pos: {}, checks: {}, cards: {},
    scen: {}, gen: [], drills: {}, work: [], log: [], ojt: {}, theme: 'auto' };
}
let S;
try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { S = blank(); }
function persist() { S.updated = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} Sync.snapshotSoon(); }
function award(type, item, xp, score, data) {
  S.xp += xp; const d = today(); S.days[d] = (S.days[d] || 0) + xp;
  S.log.unshift({ ts: Date.now(), type, item, xp, score: score == null ? '' : score });
  if (S.log.length > 400) S.log.length = 400;
  persist(); Sync.event(type, item, score, data); toast(`+${xp} XP — ${item}`);
  updateChrome();
}
function streak() {
  let n = 0, d = today();
  if (!S.days[d]) d = addDays(d, -1);
  while (S.days[d]) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- sheet sync (PayMeGPT linked sheet) ---------- */
const Sync = (() => {
  const meta = n => (document.querySelector(`meta[name="${n}"]`) || {}).content;
  const rowsUrl = meta('sheet-rows-url'), dataUrl = meta('sheet-data-url');
  let status = rowsUrl ? 'idle' : 'local', timer = null, queue = [];
  function verifiedEmail() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^lp_(pin|paid)_/.test(k)) continue;
        const v = localStorage.getItem(k) || '';
        const parts = v.split('.');
        if (parts.length === 3) {
          const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          const e = p.email || p.identifier || p.sub;
          if (e && /@/.test(e)) return e;
        }
        try { const j = JSON.parse(v); if (j && j.email) return j.email; } catch (e) {}
      }
    } catch (e) {}
    return null;
  }
  const ve = verifiedEmail(); if (ve) S.email = ve;
  function set(s) { status = s; const el = $('#sync'); if (el) { el.dataset.s = s; el.title = label(); $('#syncTxt').textContent = label(); } }
  function label() { return { local: 'Saved on this device', idle: 'Synced to your sheet', busy: 'Saving…', err: 'Saved here — sheet sync paused' }[status]; }
  async function post(row) {
    if (!rowsUrl) return;
    set('busy');
    try {
      const r = await fetch(rowsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(r.status);
      set('idle');
    } catch (e) { set('err'); queue.push(row); }
  }
  function row(type, item, score, data) {
    return { Timestamp: new Date().toISOString(), Email: S.email, Type: type, Item: String(item).slice(0, 200), Score: score == null ? '' : score, Data: typeof data === 'string' ? data : JSON.stringify(data || {}) };
  }
  function event(type, item, score, data) { if (rowsUrl) post(row(type, item, score, data)); }
  function snapshot() {
    clearTimeout(timer); timer = null;
    if (!rowsUrl) return;
    const lite = Object.assign({}, S, { log: S.log.slice(0, 60), work: S.work.map(w => ({ id: w.id, wf: w.wf, title: w.title, ts: w.ts })) });
    let json = JSON.stringify(lite);
    if (json.length > 45000) { lite.gen = lite.gen.slice(0, 20); lite.log = []; json = JSON.stringify(lite); }
    post(row('snapshot', 'state', S.xp, json));
    if (queue.length) { const q = queue.splice(0); q.forEach(post); }
  }
  function snapshotSoon() { if (!rowsUrl) return; clearTimeout(timer); timer = setTimeout(snapshot, 15000); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) snapshot(); });
  async function restore() {
    if (!dataUrl) return;
    try {
      const r = await fetch(dataUrl); const j = await r.json();
      const rows = (j && (j.data || j.rows)) || [];
      const mine = rows.filter(x => !x.Email || String(x.Email).toLowerCase() === S.email.toLowerCase());
      const snaps = mine.filter(x => x.Type === 'snapshot').sort((a, b) => String(b.Timestamp).localeCompare(String(a.Timestamp)));
      let changed = false;
      if (snaps[0]) {
        const remote = JSON.parse(snaps[0].Data);
        if ((remote.updated || 0) > (S.updated || 0)) { const work = S.work; S = Object.assign(blank(), remote); S.work = work; changed = true; }
      }
      const works = mine.filter(x => x.Type === 'work');
      works.forEach(x => { try { const w = JSON.parse(x.Data); const i = S.work.findIndex(y => y.id === w.id); if (i < 0) { S.work.push(w); changed = true; } else if ((S.work[i].ts || 0) < w.ts || !S.work[i].md) { S.work[i] = w; changed = true; } } catch (e) {} });
      if (changed) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} route(); updateChrome(); toast('Progress restored from your sheet'); }
      set('idle');
    } catch (e) { set('err'); }
  }
  return { event, snapshotSoon, snapshot, restore, set, label, get status() { return status; }, enabled: !!rowsUrl };
})();

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove(); return ok;
  }
}

/* ---------- coach drawer ---------- */
function coach(prompt) {
  const d = $('#coach'); const f = $('#coachFrame');
  if (!f.src) f.src = COACH_URL;
  d.classList.add('open'); document.body.classList.add('coach-open');
  const hint = $('#coachHint');
  if (prompt) {
    copy(prompt).then(ok => {
      hint.innerHTML = ok ? '<strong>Copied.</strong> Paste it into the chat below (Ctrl/Cmd + V) and send.' : 'Copy this into the chat:<br><code>' + esc(prompt.slice(0, 400)) + '</code>';
      hint.hidden = false;
    });
  } else hint.hidden = true;
}
function closeCoach() { $('#coach').classList.remove('open'); document.body.classList.remove('coach-open'); }

/* ---------- illustrations (inline SVG, currentColor + highlighter) ---------- */
const ART = {
  compass: '<circle cx="60" cy="60" r="40"/><circle cx="60" cy="60" r="4" class="fill"/><path d="M60 26 L68 60 L60 94 L52 60Z" class="hl"/><path d="M26 60h8M86 60h8M60 20v6M60 94v6"/>',
  blueprint: '<rect x="26" y="20" width="68" height="82" rx="4"/><path d="M36 36h30M36 48h48M36 60h40"/><rect x="36" y="70" width="22" height="20" class="hl"/><path d="M64 74h20M64 82h14"/>',
  chairs: '<path d="M22 92V66h20v26M22 76h20"/><path d="M50 92V58h20v34M50 70h20"/><path d="M78 92V50h20v42M78 64h20"/><circle cx="32" cy="52" r="6"/><circle cx="60" cy="44" r="6" class="hl"/><circle cx="88" cy="36" r="6"/>',
  scale: '<path d="M60 22v74M36 96h48M28 40h64"/><path d="M28 40l-12 26h24z" class="hl"/><path d="M92 40l-12 26h24z"/><circle cx="60" cy="22" r="4" class="fill"/>',
  pen: '<path d="M30 92l8-24 44-44 16 16-44 44z"/><path d="M74 32l16 16" /><path d="M30 92l24-8" class="hl-s"/><path d="M60 98h34" class="hl-s"/>',
  nodes: '<circle cx="30" cy="34" r="7"/><circle cx="30" cy="62" r="7"/><circle cx="30" cy="90" r="7"/><circle cx="62" cy="48" r="7" class="hl"/><circle cx="62" cy="78" r="7"/><circle cx="92" cy="62" r="8" class="fill"/><path d="M37 34l18 12M37 62l18-12M37 62l18 14M37 90l18-10M69 48l16 12M69 78l16-14"/>',
  mic: '<rect x="46" y="20" width="28" height="46" rx="14" class="hl"/><path d="M36 54c0 14 10 24 24 24s24-10 24-24M60 78v16M44 96h32"/>',
  key: '<circle cx="40" cy="60" r="16"/><circle cx="40" cy="60" r="5" class="hl"/><path d="M56 60h44M86 60v12M96 60v8"/>',
  ladder: '<path d="M38 100V20M82 100V20M38 34h44M38 54h44M38 74h44M38 94h44"/><path d="M38 34h44" class="hl-s"/>',
  bolt: '<path d="M66 16L34 66h24l-6 38 34-52H62z" class="hl"/>',
  grid: '<rect x="24" y="24" width="30" height="30" rx="3"/><rect x="66" y="24" width="30" height="30" rx="3" class="hl"/><rect x="24" y="66" width="30" height="30" rx="3"/><rect x="66" y="66" width="30" height="30" rx="3"/>',
  route: '<circle cx="28" cy="92" r="6" class="fill"/><path d="M28 86c0-30 64-10 64-40S60 20 60 20"/><circle cx="60" cy="20" r="6" class="hl"/>',
  book: '<path d="M60 30c-10-8-24-10-38-8v66c14-2 28 0 38 8 10-8 24-10 38-8V22c-14-2-28 0-38 8zM60 30v66"/><path d="M30 40h20M30 50h20M70 40h20" class="hl-s"/>',
  cards: '<rect x="20" y="34" width="56" height="70" rx="6" transform="rotate(-8 48 69)"/><rect x="44" y="20" width="56" height="70" rx="6" class="hl"/><path d="M58 46h28M58 58h20"/>'
};
const CH_ART = {
  'bc-how-to-use-this-course': 'route', 'bc-your-career-translated': 'ladder', 'bc-day-1-product-management-foundations': 'compass',
  'bc-day-2-specifications': 'blueprint', 'bc-day-3-writing-for-every-audience': 'chairs', 'bc-day-4-evaluating-content': 'scale',
  'bc-day-5-writing-rationales-that-hold-up': 'pen', 'bc-day-6-how-ai-models-learn-from-your-judgments': 'nodes', 'bc-day-7-interview-readiness': 'mic',
  'bc-glossary': 'book', 'bc-templates': 'grid', 'bk-how-this-book-works': 'route', 'bk-the-level-ladder': 'ladder',
  'bk-the-flash-protocol-how-you-ll-remember-all-of-th': 'bolt', 'bk-mnemonic-master-list': 'key', 'bk-module-a-senior-product-thinking': 'compass',
  'bk-module-b-senior-spec-craft': 'blueprint', 'bk-module-c-senior-writing-judgment': 'pen', 'bk-module-d-senior-evaluation': 'scale',
  'bk-module-e-ai-product-literacy-for-pm-po-evaluator': 'nodes', 'bk-scenario-lab': 'chairs', 'bk-rapid-fire-drills': 'bolt',
  'bk-your-30-day-plan-and-coaching-sessions': 'route', 'bk-flashcard-deck': 'cards', 'bk-phase-2-roadmap-deeper-ai-product-engineering-la': 'nodes'
};
const art = (name, cls = '') => `<svg class="art ${cls}" viewBox="0 0 120 120" aria-hidden="true">${ART[name] || ART.book}</svg>`;

/* ---------- icons ---------- */
const IC = {
  today: '<path d="M4 7h16M4 7v12h16V7M8 3v4M16 3v4"/><circle cx="12" cy="13" r="2.4"/>',
  learn: '<path d="M12 6c-2-1.6-5-2-8-1.6v13c3-.4 6 0 8 1.6 2-1.6 5-2 8-1.6v-13c-3-.4-6 0-8 1.6zM12 6v13"/>',
  flash: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
  build: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
  drills: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  coach: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  palace: '<path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6"/>',
  ojt: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M2.5 20c.5-4 2.8-6 5.5-6s5 2 5.5 6M13.5 16c.8-1.6 2-2.4 3.5-2.4 2.3 0 4 1.8 4.5 5"/>'
};
const icon = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;

/* ---------- shell ---------- */
const NAV = [
  ['today', 'Today'], ['learn', 'Library'], ['ojt', 'Shadow a PM'], ['lab', 'Simulator'], ['flash', 'Flash'], ['build', 'Workflows'], ['drills', 'Drills'], ['palace', 'Memory palace'], ['progress', 'Progress']
];
function shell() {
  let root = document.getElementById('pmu');
  if (!root) { root = document.createElement('div'); root.id = 'pmu'; document.body.appendChild(root); }
  root.innerHTML = `
  <a class="skip" href="#main">Skip to content</a>
  <aside class="rail">
    <a class="brand" href="#/today"><span class="mark">${icon('flash')}</span><span><b>PM University</b><small>for Dijae</small></span></a>
    <nav>${NAV.map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${icon(k)}<span>${l}</span></a>`).join('')}</nav>
    <button class="coach-btn" data-coach>${icon('coach')}<span>Ask the coach</span></button>
    <div class="rail-foot">
      <div class="xpline"><span id="xp">0</span> XP <span class="dot"></span> <span id="streak">0</span>-day streak</div>
      <button id="sync" class="sync" data-s="${Sync.status}"><i></i><span id="syncTxt">${Sync.label()}</span></button>
    </div>
  </aside>
  <header class="top">
    <a class="brand" href="#/today"><span class="mark">${icon('flash')}</span><b>PM University</b></a>
    <a class="top-xp" href="#/progress"><span id="xp2">0</span> XP</a>
    <button class="icon-btn" data-coach aria-label="Ask the coach">${icon('coach')}</button>
  </header>
  <main id="main" tabindex="-1"></main>
  <nav class="tabs">${NAV.slice(0, 5).map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${icon(k)}<span>${k === 'ojt' ? 'Shadow' : l}</span></a>`).join('')}</nav>
  <aside id="coach" class="coach" aria-label="AI coach">
    <div class="coach-head"><div><b>Coach</b><small>Gemini, inside PayMeGPT</small></div><button class="icon-btn" id="coachClose" aria-label="Close coach">✕</button></div>
    <div class="coach-cmds">${['Flash me Module D', 'Scenario drill', 'Grade my rationale', 'Mock interview', 'What am I weakest at?'].map(c => `<button class="chip" data-cmd="${c}">${c}</button>`).join('')}</div>
    <p id="coachHint" class="coach-hint" hidden></p>
    <iframe id="coachFrame" title="PM University Coach"></iframe>
  </aside>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="termpop" class="termpop" hidden></div>
  <div id="sel" class="selpop" hidden><button>Ask coach about this</button></div>`;
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-coach]'); if (c) { e.preventDefault(); coach(c.dataset.coach || ''); }
    const cmd = e.target.closest('[data-cmd]'); if (cmd) coach(cmd.dataset.cmd);
  });
  $('#coachClose').onclick = closeCoach;
  $('#sync').onclick = () => { if (Sync.enabled) { Sync.snapshot(); toast('Saving to your sheet'); } else toast('Open the app from your PayMeGPT link to sync to your sheet'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCoach(); });
  // selection → ask coach
  document.addEventListener('selectionchange', () => {
    const s = getSelection(); const pop = $('#sel');
    if (!s || s.isCollapsed || !$('.reader') || !$('.reader').contains(s.anchorNode)) { pop.hidden = true; return; }
    const t = s.toString().trim(); if (t.length < 8) { pop.hidden = true; return; }
    const r = s.getRangeAt(0).getBoundingClientRect();
    pop.style.top = (r.top + scrollY - 46) + 'px'; pop.style.left = Math.max(12, r.left + r.width / 2 - 80) + 'px'; pop.hidden = false;
    pop.firstChild.onclick = () => { pop.hidden = true; coach(`Explain this simply, then give me one example from my CRM/chatbot work and one quick check question:\n\n"${t.slice(0, 900)}"`); };
  });
}
function updateChrome() {
  ['#xp', '#xp2'].forEach(s => { const el = $(s); if (el) el.textContent = S.xp.toLocaleString(); });
  const st = $('#streak'); if (st) st.textContent = streak();
}

/* ---------- router ---------- */
const VIEWS = {};
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'today';
  const [v, ...rest] = h.split('/');
  const fn = VIEWS[v] || VIEWS.today;
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === v || (v === 'read' && a.dataset.nav === 'learn') || (v === 'wf' && a.dataset.nav === 'build') || (v === 'sim' && a.dataset.nav === 'lab')));
  const m = $('#main'); m.innerHTML = ''; m.className = 'view-' + v;
  fn(m, rest.map(decodeURIComponent));
  if (v !== 'read') scrollTo(0, 0);
  m.focus({ preventScroll: true });
}
addEventListener('hashchange', route);

/* ---------- TODAY ---------- */
function ojtDoneCount() { return Object.values(S.ojt || {}).filter(x => x.done).length; }
function ojtNextStage() { const O2 = window.OJT; if (!O2) return 1; for (const st of O2.stages) { if (!O2.eps.some(e => e.s === st.n && S.ojt && S.ojt[e.id] && S.ojt[e.id].done)) return st.n; } return 1; }
function planDay() { return Math.min(30, Math.max(1, dayDiff(S.start, today()) + 1)); }
function nextChapter() { return ORDER.find(id => !S.read[id]) || ORDER[0]; }
function dueCards(deck) { const d = today(); return P.cards.filter(c => (!deck || c.deck === deck) && S.cards[c.id] && S.cards[c.id].due <= d); }
function newCards(deck) { return P.cards.filter(c => (!deck || c.deck === deck) && !S.cards[c.id]); }

VIEWS.today = m => {
  const day = planDay(); const wk = Math.min(4, Math.ceil(day / 7)); const plan = P.plan[wk - 1];
  const nx = CH[nextChapter()]; const due = dueCards().length; const readN = Object.keys(S.read).length;
  const scDone = Object.keys(S.scen).length; const sigDone = SIGNALS.filter(s => S.checks[s.k]).length;
  const hooks = shuffle(P.mnemonics); const focus = P.mnemonics[(dayDiff('2026-01-01', today())) % P.mnemonics.length];
  m.innerHTML = `
  <section class="hero">
    <div class="flash-stage" id="flashStage" aria-live="off">
      <div class="flash-word" id="flashWord">${esc(focus.hook)}</div>
    </div>
    <div class="hero-copy">
      <p class="kicker">Today's flash · ${esc(focus.fw)}</p>
      <h1 class="hook">${esc(focus.hook)}</h1>
      <p class="unpack">${esc(focus.un)}</p>
      <div class="row"><button class="btn primary" id="reflash">Flash again</button><a class="btn" href="#/flash/mnemonic">Drill all hooks</a></div>
    </div>
  </section>

  <section class="today-grid">
    <article class="panel plan">
      <header><h2>Day ${day} of your 30-day plan</h2><span class="tag">Week ${wk}</span></header>
      <p class="focus">${esc(plan.focus)}</p>
      <p class="muted">${esc(plan.daily)}</p>
      <div class="weekbar">${[1, 2, 3, 4].map(w => `<span class="${w < wk ? 'done' : w === wk ? 'now' : ''}">W${w}</span>`).join('')}</div>
      <p class="small">End-of-week check with the coach: <b>${esc(plan.check)}</b></p>
    </article>

    <a class="panel next" href="#/read/${nx.id}">
      ${art(CH_ART[nx.id] || 'book', 'sm')}
      <div><p class="kicker">Continue reading</p><h3>${esc(nx.title)}</h3><p class="muted">${Math.max(2, Math.round(nx.words / 200))} min · ${esc(P.courses.find(c => c.id === nx.course).short)}</p></div>
    </a>

    <div class="panel doses">
      <h2>Daily dose</h2>
      <ol class="dose">
        <li><a href="#/flash"><b>Flashcards</b><span>${due ? due + ' due' : newCards().length + ' new waiting'}</span></a></li>
        <li><a href="#/drills"><b>5 rapid-fire drills</b><span>60 seconds each</span></a></li>
        <li><a href="#/lab"><b>1 scenario</b><span>${scDone}/${P.scenarios.length} attempted</span></a></li>
        <li><a href="#/ojt/stage/${ojtNextStage()}"><b>Shadow a PM</b><span>${ojtDoneCount()}/${(window.OJT || { eps: [] }).eps.length} episodes</span></a></li>
        <li><a href="#/wf/eval-single"><b>1 timed evaluation</b><span>15-minute workflow</span></a></li>
      </ol>
    </div>

    <div class="panel stats">
      <div><b>${streak()}</b><span>day streak</span></div>
      <div><b>${readN}/${ORDER.length}</b><span>chapters read</span></div>
      <div><b>${Object.values(S.cards).filter(c => c.box >= 4).length}</b><span>cards mastered</span></div>
      <div><b>${sigDone}/5</b><span>ready-to-apply signals</span></div>
    </div>
  </section>
  <nav class="more-links" aria-label="More">${[['build', 'Workflows'], ['drills', 'Drills'], ['palace', 'Memory palace'], ['progress', 'Progress']].map(([k, l]) => `<a href="#/${k}">${icon(k)}<span>${l}</span></a>`).join('')}<button data-coach>${icon('coach')}<span>Coach</span></button></nav>`;
  const stage = $('#flashStage'), w = $('#flashWord');
  function flash() {
    if (reduced) return;
    stage.classList.add('run'); let i = 0; const seq = hooks.slice(0, 9).concat([focus]);
    const tick = () => { w.textContent = seq[i].hook; w.style.setProperty('--r', (Math.random() * 6 - 3) + 'deg'); i++; if (i < seq.length) setTimeout(tick, 70 + i * 14); else stage.classList.remove('run'); };
    tick();
  }
  $('#reflash').onclick = flash; flash();
};

/* ---------- LIBRARY ---------- */
VIEWS.learn = m => {
  m.innerHTML = `<header class="page-head"><h1>Library</h1><p>Read it as a course. Every checkbox, chapter and template saves as you go.</p></header>
  <a class="panel gen-cta" href="#/ojt">${art('chairs', 'md')}<div><p class="kicker">Learn by watching real work</p><h2>Shadow a PM</h2><p>Each lesson as a real project: the meetings, the PM's thinking, rejected drafts, the finished documents and the questions you'll get. 3 products per lesson.</p><span class="btn primary">Open Shadow a PM</span></div></a>` +
    P.courses.map(c => {
      const done = c.chapters.filter(ch => S.read[ch.id]).length;
      return `<section class="course">
        <header class="course-head"><div><h2>${esc(c.title)}</h2><p class="muted">${done} of ${c.chapters.length} chapters complete</p></div>
        <div class="meter"><i style="width:${Math.round(done / c.chapters.length * 100)}%"></i></div></header>
        <ol class="toc-grid">${c.chapters.map(ch => `<li class="${S.read[ch.id] ? 'read' : ''}"><a href="#/read/${ch.id}">${art(CH_ART[ch.id] || 'book', 'xs')}<span><b>${esc(ch.title)}</b><small>${Math.max(2, Math.round(ch.words / 200))} min${ch.secs.length ? ' · ' + ch.secs.length + ' sections' : ''}${S.read[ch.id] ? ' · done' : ''}</small></span></a></li>`).join('')}</ol>
      </section>`;
    }).join('');
};

const TPL_WF = { 'PRD (one page)': 'prd', 'User story with acceptance criteria': 'story', 'Release notes': 'release', 'Stakeholder update (BLUF)': 'update', 'Decision document': 'decision', 'Evaluation rationale (single response)': 'eval-single', 'Evaluation rationale (side by side)': 'eval-pair', 'Escalation note': 'escalation' };

VIEWS.read = (m, [id]) => {
  const ch = CH[id]; if (!ch) { location.hash = '#/learn'; return; }
  const course = P.courses.find(c => c.id === ch.course);
  const i = ORDER.indexOf(id); const prev = CH[ORDER[i - 1]], next = CH[ORDER[i + 1]];
  m.innerHTML = `<div class="progressbar"><i id="rp"></i></div>
  <div class="reader-wrap">
    <article class="reader">
      <header class="chapter-head">
        ${art(CH_ART[id] || 'book', 'lg anim')}
        <div><p class="kicker"><a href="#/learn">${esc(course.short)}</a> · Chapter ${ch.idx + 1} of ${course.chapters.length}</p>
        <h1>${esc(ch.title)}</h1>
        <p class="muted">${Math.max(2, Math.round(ch.words / 200))} min read${S.read[id] ? ' · completed' : ''}</p></div>
      </header>
      ${STAGE_OF_CH[id] ? `<a class="realwork" href="#/ojt/stage/${STAGE_OF_CH[id]}">${icon('ojt')}<span><b>See this lesson in real work</b><small>Shadow a PM or PO doing it on one of 3 products, with drafts, rejections and the finished documents.</small></span></a>` : ''}
      ${ch.idx === 0 && course.intro ? `<div class="intro">${course.intro}</div>` : ''}
      <div class="prose">${ch.html}</div>
      <footer class="chapter-foot">
        <button class="btn primary" id="done">${S.read[id] ? 'Completed — read again anytime' : 'Mark chapter complete'}</button>
        ${STAGE_OF_CH[id] ? `<a class="btn" href="#/ojt/stage/${STAGE_OF_CH[id]}">See it in real work</a>` : ''}
        <button class="btn" data-coach="Flash me on this chapter of my course: &quot;${esc(ch.title)}&quot;. 2-minute summary, then 5 rapid-fire questions; grade each and correct my gaps.">Flash me on this chapter</button>
        <nav class="pn">${prev ? `<a href="#/read/${prev.id}">‹ ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#/read/${next.id}">${esc(next.title)} ›</a>` : ''}</nav>
      </footer>
    </article>
    ${ch.secs.length ? `<aside class="side-toc"><p class="kicker">In this chapter</p>${ch.secs.map(s => `<a href="#" data-jump="${s.id}">${esc(s.t)}</a>`).join('')}</aside>` : ''}
  </div>`;
  // checkboxes
  $$('input[data-k]', m).forEach(cb => {
    cb.checked = !!S.checks[cb.dataset.k];
    cb.onchange = () => { if (cb.checked) { S.checks[cb.dataset.k] = Date.now(); award('task', cb.closest('label').textContent.trim().slice(0, 80), 5); } else { delete S.checks[cb.dataset.k]; persist(); } };
  });
  // template → workflow buttons
  $$('.prose h4', m).forEach(h => {
    const wf = TPL_WF[h.textContent.trim()];
    if (wf) { const b = document.createElement('a'); b.className = 'btn sm'; b.href = '#/wf/' + wf; b.textContent = 'Open as guided workflow'; h.after(b); }
  });
  $$('pre.tpl', m).forEach(pre => { const b = document.createElement('button'); b.className = 'copy'; b.textContent = 'Copy'; b.onclick = () => copy(pre.innerText).then(() => toast('Template copied')); pre.prepend(b); });
  $$('[data-jump]', m).forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (t) t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); });
  $('#done').onclick = () => { if (!S.read[id]) { S.read[id] = Date.now(); award('lesson', ch.title, 40); } if (next) location.hash = '#/read/' + next.id; else location.hash = '#/learn'; };
  const pos = S.pos[id] || 0;
  requestAnimationFrame(() => scrollTo(0, pos ? pos * (document.documentElement.scrollHeight - innerHeight) : 0));
  const rp = $('#rp'); let saveT;
  const onScroll = () => {
    if (!document.body.contains(rp)) { removeEventListener('scroll', onScroll); return; }
    const pct = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);
    rp.style.width = (pct * 100).toFixed(1) + '%';
    clearTimeout(saveT); saveT = setTimeout(() => { S.pos[id] = +pct.toFixed(3); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 400);
  };
  addEventListener('scroll', onScroll, { passive: true });
};

/* ---------- FLASH (Leitner) ---------- */
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const DECKS = [['core', 'Core 40', 'The Mastery Book deck'], ['mnemonic', 'Mnemonic hooks', 'Hook → unpack it'], ['glossary', 'Glossary', 'Bootcamp terms, plain meaning']];
VIEWS.flash = (m, [deck]) => {
  if (deck) return flashSession(m, deck);
  m.innerHTML = `<header class="page-head"><h1>Flash</h1><p>Leitner boxes: miss a card and it comes back today; get it right and it waits longer (1, 3, 7, 14, 30 days).</p></header>
  <div class="decks">${DECKS.map(([id, name, sub]) => {
    const all = P.cards.filter(c => c.deck === id); const due = dueCards(id).length; const nw = newCards(id).length;
    const boxes = [1, 2, 3, 4, 5].map(b => all.filter(c => S.cards[c.id] && S.cards[c.id].box === b).length);
    return `<a class="panel deck" href="#/flash/${id}">
      ${art(id === 'core' ? 'cards' : id === 'mnemonic' ? 'key' : 'book', 'sm')}
      <div><h2>${name}</h2><p class="muted">${sub} · ${all.length} cards</p>
      <p class="due"><b>${due}</b> due · <b>${nw}</b> new</p>
      <div class="boxes" title="Cards per Leitner box">${boxes.map((n, i) => `<span style="--h:${Math.min(100, n / Math.max(1, all.length) * 300)}%"><i></i><small>${i + 1}</small></span>`).join('')}</div></div></a>`;
  }).join('')}</div>
  <section class="panel"><h2>Unpack mode</h2><p class="muted">For the mnemonic hooks: type the full unpack from memory, then compare word by word. Harder than flipping, and it sticks better.</p><a class="btn primary" href="#/flash/mnemonic-type">Start unpack mode</a></section>`;
};
function flashSession(m, deck) {
  const typeMode = deck === 'mnemonic-type'; const d = typeMode ? 'mnemonic' : deck;
  let q = dueCards(d).concat(shuffle(newCards(d)).slice(0, 12)); q = shuffle(q).slice(0, 20);
  if (!q.length) q = shuffle(P.cards.filter(c => c.deck === d)).slice(0, 10);
  let i = 0, right = 0, seen = 0;
  const name = (DECKS.find(x => x[0] === d) || [, 'Deck'])[1];
  function show() {
    if (i >= q.length) {
      m.innerHTML = `<section class="panel center done-card">${art('bolt', 'lg anim')}<h1>Session done</h1><p>${right} of ${seen} right. Missed cards are back in box 1 for today.</p><div class="row"><a class="btn primary" href="#/flash/${deck}">Another round</a><a class="btn" href="#/flash">All decks</a></div></section>`;
      award('flash', name + ' session', 10 + right * 2, Math.round(right / Math.max(1, seen) * 100), { deck: d, right, seen });
      return;
    }
    const c = q[i]; const st = S.cards[c.id] || { box: 0 };
    m.innerHTML = `<div class="session-top"><a href="#/flash">‹ ${esc(name)}</a><span>${i + 1} / ${q.length}</span><span class="tag">Box ${st.box || 'new'}</span></div>
    <div class="meter thin"><i style="width:${i / q.length * 100}%"></i></div>
    <div class="fc" id="fc" tabindex="0" role="button" aria-label="Flip card">
      <div class="fc-in">
        <div class="fc-face front">${c.g ? `<p class="kicker">${esc(c.g)}</p>` : ''}<h2>${esc(c.f)}</h2>${typeMode ? '' : '<p class="muted small">Say it out loud, then tap or press Space to flip</p>'}</div>
        <div class="fc-face back"><p class="kicker">${esc(c.f)}</p><p class="ans">${esc(c.b)}</p></div>
      </div>
    </div>
    ${typeMode ? `<div class="typebox"><textarea id="ta" rows="3" placeholder="Type the full unpack from memory…"></textarea><button class="btn primary" id="check">Check</button><div id="diff"></div></div>` : ''}
    <div class="grade" id="grade" hidden><button class="btn bad" id="miss">Missed it <kbd>1</kbd></button><button class="btn good" id="got">Got it <kbd>2</kbd></button></div>`;
    const fc = $('#fc'); const g = $('#grade');
    const flip = () => { fc.classList.add('flipped'); g.hidden = false; };
    if (!typeMode) { fc.onclick = flip; fc.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } }; fc.focus(); }
    else {
      $('#ta').focus();
      $('#check').onclick = () => {
        const want = c.b.toLowerCase().match(/[a-z0-9]+/g) || []; const have = new Set(($('#ta').value.toLowerCase().match(/[a-z0-9]+/g) || []));
        const keys = want.filter(w => w.length > 3); const hit = keys.filter(w => have.has(w));
        $('#diff').innerHTML = `<p><b>${Math.round(hit.length / Math.max(1, keys.length) * 100)}%</b> of key words recalled.</p><p class="diffline">${esc(c.b).split(/(\s+)/).map(t => { const k = (t.toLowerCase().match(/[a-z0-9]+/) || [''])[0]; return k.length > 3 ? `<span class="${have.has(k) ? 'hit' : 'miss'}">${t}</span>` : t; }).join('')}</p>`;
        flip();
      };
    }
    const grade = ok => {
      seen++; if (ok) right++;
      const box = ok ? Math.min(5, (st.box || 0) + 1) : 1;
      S.cards[c.id] = { box, due: addDays(today(), ok ? BOX_DAYS[box] : 0), n: (st.n || 0) + 1 };
      if (!ok) q.push(c); i++; persist(); show();
    };
    $('#miss').onclick = () => grade(false); $('#got').onclick = () => grade(true);
    document.onkeydown = e => { if (!location.hash.startsWith('#/flash/')) { document.onkeydown = null; return; } if (e.target.tagName === 'TEXTAREA') return; if (!g.hidden && e.key === '1') grade(false); if (!g.hidden && e.key === '2') grade(true); };
  }
  show();
}

/* ---------- rationale checker (local VREIF rubric) ---------- */
function checkRationale(txt, mode) {
  const t = txt || '';
  const checks = [
    ['Verdict', mode === 'pair' ? /\b(A|B)\b[^.]{0,30}\b(much|slightly)?\s*better|prefer(ence)?\s*:?\s*(A|B)\b/i.test(t) : /\b[1-5]\s*\/\s*5\b|score\s*:?\s*[1-5]\b/i.test(t), mode === 'pair' ? 'State which is better and by how much ("B is much better").' : 'Lead with the score, e.g. "2/5."'],
    ['Rule', /instruction|requirement|constraint|accura|audience|clarity|tone|useful|complete|testab|format|limit|ground|guideline|rubric/i.test(t), 'Name the dimension or rule broken (instruction following, constraint, accuracy, audience fit…).'],
    ['Evidence', /["“'‘][^"”'’]{3,}["”'’]|\b\d+\s*(words?|bullets?|%|seconds?|of\s+\d+)/i.test(t), 'Quote the exact words or give the count ("7 bullets against a 5-bullet limit").'],
    ['Impact', /\bwould\b|\bcould\b|so (the|an?|they)|which means|reader|user|customer|exec|receptionist|owner|patient|can'?t|cannot|miss|trust|confus|act on/i.test(t), 'Say what it does to the reader ("an executive skimming would miss that it\'s at risk").'],
    ['Fix', /\bfix\b|should|replace|remove|\badd\b|lead with|rewrite|change|instead|cut\b|define/i.test(t), 'End with what would raise the score.'],
    ['Severity', /\b(critical|major|minor|nit)\b/i.test(t), 'Tag each issue: Critical (trust), Major (task), Minor (time), Nit (taste).']
  ];
  const n = checks.filter(c => c[1]).length;
  const core = checks[2][1] && checks[4][1] && checks[5][1];
  const level = n >= 6 || (n >= 5 && core) ? 'Senior' : n >= 3 ? 'Mid' : 'Junior';
  return { checks, n, level, words: words(t) };
}
function rubricHTML(r) {
  return `<div class="rubric"><div class="lvl lvl-${r.level.toLowerCase()}"><span>Rubric estimate</span><b>${r.level}</b><small>${r.n}/6 VREIF+S parts · ${r.words} words</small></div>
  <ul>${r.checks.map(([k, ok, tip]) => `<li class="${ok ? 'ok' : 'no'}"><b>${ok ? '✓' : '○'} ${k}</b>${ok ? '' : `<span>${esc(tip)}</span>`}</li>`).join('')}</ul></div>`;
}

/* ---------- SIMULATOR ---------- */
VIEWS.lab = m => {
  const best = id => { const a = S.scen[id]; if (!a || !a.length) return ''; const order = { Junior: 1, Mid: 2, Senior: 3 }; return a.reduce((x, y) => order[y.lvl] > order[x.lvl] ? y : x).lvl; };
  m.innerHTML = `<header class="page-head"><h1>Simulator</h1><p>Two ways to practise evaluation. Write first, then compare. Nothing here uses real micro1 tasks or client data.</p></header>
  <a class="panel gen-cta" href="#/sim/gen">
    ${art('scale', 'md anim')}
    <div><p class="kicker">Endless practice</p><h2>Case generator</h2><p>A fresh AI response with hidden flaws planted in it, every time. Spot the flaws, tag severity, score it, write the rationale. The app knows the answer key, so you get graded instantly.</p><span class="btn primary">Generate a case</span></div>
  </a>
  <h2 class="sec">Scenario Lab · from the Mastery Book</h2>
  <div class="scen-grid">${P.scenarios.map(s => `<a class="panel scen" href="#/sim/${s.id}"><span class="num">${s.n}</span><div><h3>${esc(s.t)}</h3><p class="muted small">${esc(s.setup.slice(0, 110))}…</p>${best(s.id) ? `<span class="tag lvl-${best(s.id).toLowerCase()}">Best: ${best(s.id)}</span>` : '<span class="tag">Not tried</span>'}</div></a>`).join('')}</div>
  <section class="panel"><h2>Want a case nobody has seen?</h2><p class="muted">The coach invents a brand-new scenario, scores your rationale and shows the Senior version.</p><button class="btn" data-coach="Scenario drill">Ask the coach for a scenario drill</button></section>`;
};

VIEWS.sim = (m, [id]) => {
  if (id === 'gen') return genCase(m);
  const s = SC[id]; if (!s) { location.hash = '#/lab'; return; }
  const mode = s.pairwise ? 'pair' : s.score ? 'score' : 'open';
  const draftKey = 'draft-' + id;
  m.innerHTML = `<div class="session-top"><a href="#/lab">‹ Simulator</a><span>Scenario ${s.n} of ${P.scenarios.length}</span></div>
  <h1 class="sim-title">${esc(s.t)}</h1>
  <div class="sim">
    <section class="case">${s.setup.split('\n').map(p => `<p>${fmtCase(p)}</p>`).join('')}</section>
    <section class="work">
      ${mode === 'score' ? `<label class="lbl">Your score</label><div class="scorepick" id="sp">${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}">${n}</button>`).join('')}</div>` : ''}
      ${mode === 'pair' ? `<label class="lbl">Your preference</label><div class="scorepick wide" id="sp">${['A much better', 'A slightly better', 'B slightly better', 'B much better'].map(n => `<button data-v="${n}">${n}</button>`).join('')}</div>` : ''}
      <label class="lbl" for="rat">${mode === 'open' ? 'Your answer' : 'Your rationale'} <small>Verdict → Rule → Evidence → Impact → Fix</small></label>
      <textarea id="rat" rows="9" placeholder="${mode === 'pair' ? 'B is much better. Deciding factor: …' : mode === 'score' ? '2/5. Instruction following (Major): …' : 'Write your answer as you would in the job…'}">${esc(localStorage.getItem('pmu.' + draftKey) || '')}</textarea>
      <div id="live"></div>
      <div class="row"><button class="btn primary" id="sub">Submit and compare</button><button class="btn" id="ai">Get AI grading</button></div>
    </section>
  </div>
  <section id="reveal"></section>`;
  let pickV = null;
  $$('#sp button', m).forEach(b => b.onclick = () => { $$('#sp button').forEach(x => x.classList.remove('on')); b.classList.add('on'); pickV = b.dataset.v; });
  const ta = $('#rat'); const live = () => { $('#live').innerHTML = ta.value.trim() ? rubricHTML(checkRationale(ta.value, mode === 'pair' ? 'pair' : 'score')) : ''; try { localStorage.setItem('pmu.' + draftKey, ta.value); } catch (e) {} };
  ta.oninput = live; live();
  $('#ai').onclick = () => coach(`Grade my rationale for this practice scenario like a QA reviewer (severity, evidence, structure), give my level (Junior/Mid/Senior) and show the Senior version.\n\nSCENARIO: ${s.setup}\n\nMY ${mode === 'score' ? 'SCORE: ' + (pickV || '?') + '/5\n' : mode === 'pair' ? 'PREFERENCE: ' + (pickV || '?') + '\n' : ''}MY RATIONALE: ${ta.value}`);
  $('#sub').onclick = () => {
    if (words(ta.value) < 8) { toast('Write at least a sentence or two first'); ta.focus(); return; }
    const r = checkRationale(ta.value, mode === 'pair' ? 'pair' : 'score');
    let scoreNote = '';
    if (mode === 'score' && pickV) { const dlt = Math.abs(+pickV - s.score); scoreNote = dlt === 0 ? `Your score matches the Senior score (${s.score}/5).` : `Senior score: ${s.score}/5. You were ${dlt} point${dlt > 1 ? 's' : ''} ${+pickV > s.score ? 'generous' : 'harsh'}.`; }
    if (mode === 'pair' && pickV) { const sen = s.answers.find(a => a.lvl === 'Senior').txt; const want = /B is much better/.test(sen) ? 'B much better' : /A is much better/.test(sen) ? 'A much better' : ''; scoreNote = want ? (pickV === want ? 'Your preference matches the Senior call.' : `Senior call: ${want}.`) : ''; }
    (S.scen[id] = S.scen[id] || []).push({ ts: Date.now(), lvl: r.level, n: r.n, pick: pickV, txt: ta.value });
    award('scenario', 'Scenario ' + s.n + ': ' + s.t, r.level === 'Senior' ? 30 : r.level === 'Mid' ? 20 : 12, r.level, { pick: pickV, n: r.n });
    $('#reveal').innerHTML = `<div class="panel reveal-in"><h2>Compare with the model answers</h2>${scoreNote ? `<p class="scorenote">${esc(scoreNote)}</p>` : ''}
      <div class="answers">${s.answers.map(a => `<div class="ans-card lvl-${a.lvl.toLowerCase()}"><span class="tag lvl-${a.lvl.toLowerCase()}">${a.lvl}</span><p>${esc(a.txt)}</p></div>`).join('')}</div>
      <p class="muted">Ask yourself: what did the Senior answer have that yours didn't? Severity tags, a quote, a count, the reader impact, a fix?</p>
      <div class="row">${P.scenarios[s.n] ? `<a class="btn primary" href="#/sim/${P.scenarios[s.n].id}">Next scenario</a>` : '<a class="btn primary" href="#/sim/gen">Try the case generator</a>'}<a class="btn" href="#/lab">All scenarios</a></div></div>`;
    $('#reveal').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    try { localStorage.removeItem('pmu.' + draftKey); } catch (e) {}
  };
};
function fmtCase(p) {
  return esc(p).replace(/(Prompt given to the AI:|Prompt:|AI response:|Response:|Story:|Spec excerpt:|Situation:|Question:|\bA:|\bB:)/g, '<b class="lab">$1</b>');
}

/* ---------- case generator ---------- */
const PACKS = [
  {
    id: 'rn', name: 'Release notes for clinic receptionists',
    source: ['Patients can confirm appointments by replying YES to the SMS reminder.', 'Confirmed appointments show a green tick in the calendar.', 'Fixed: the double-booking warning didn\'t appear for Saturday slots.'],
    prompt: lim => `Write release notes for clinic receptionists based on the changelog. Under ${lim} words. Must say what they need to do differently.`,
    parts: [
      { id: 'p1', t: 'New: patients can now confirm their appointment by replying YES to the SMS reminder.' },
      { id: 'p2', t: 'Confirmed appointments show a green tick in your calendar.' },
      { id: 'p3', t: 'Fixed: the double-booking warning now appears for Saturday slots too.' },
      { id: 'act', t: 'What to do differently: check for the green tick before you call a patient to confirm.' }
    ],
    faults: [
      { id: 'hall', label: 'Claims something not in the source (fabrication)', sev: 'Critical', add: 'Patients can also reschedule themselves online from the reminder link.', at: 2 },
      { id: 'noact', label: 'Missing required element: what to do differently', sev: 'Major', remove: 'act' },
      { id: 'jargon', label: 'Wrong register for the audience (technical jargon)', sev: 'Major', add: 'Under the hood, an inbound SMS webhook now writes the confirmation state to the appointment status enum.', at: 2 },
      { id: 'fluff', label: 'Empty fluency / marketing filler', sev: 'Minor', add: 'We\'re thrilled to bring you a reimagined, delightful front-desk experience that makes every day smoother!', at: 0 },
      { id: 'over', label: 'Breaks the word limit', sev: 'Major', limit: true }
    ],
    decoys: ['Contradicts itself', 'Wrong date or version number']
  },
  {
    id: 'ex', name: 'Exec update on the CRM migration',
    source: ['Status: at risk — the vendor API rate limit is slowing record transfer.', '62% of records migrated (target for this week: 80%).', 'Decision needed: approve a 1-week extension by Friday.'],
    prompt: lim => `Write an exec update on the CRM migration. ${lim} bullets max. Lead with status.`, bulletMode: true,
    parts: [
      { id: 'status', t: 'Status: At risk. The vendor\'s API rate limit is slowing the record transfer.' },
      { id: 'm', t: 'Progress: 62% of records migrated against an 80% target for this week.' },
      { id: 'mit', t: 'Mitigation: batching transfers overnight to stay under the rate limit.' },
      { id: 'ask', t: 'Decision needed: approve a 1-week extension by Friday.' }
    ],
    faults: [
      { id: 'buried', label: 'Buried lede: status is not first', sev: 'Major', move: 'status' },
      { id: 'noask', label: 'Missing required element: the decision/ask', sev: 'Major', remove: 'ask' },
      { id: 'hall', label: 'Claims something not in the source (fabrication)', sev: 'Critical', add: 'Customer churn has already dropped 12% since the migration started.', at: 2 },
      { id: 'jargon', label: 'Wrong register for the audience (field-level detail)', sev: 'Minor', add: 'Mapped lead_source picklist values to custom field LS__c with a default fallback.', at: 1 },
      { id: 'over', label: 'Breaks the bullet limit', sev: 'Major', limit: true }
    ],
    decoys: ['Contradicts itself', 'Tone too casual for executives']
  },
  {
    id: 'cl', name: 'Changelog summary for small-business owners',
    source: ['Added: CSV export on the Contacts page.', 'Search now finds contacts by partial phone number.', 'Fixed: importing a spreadsheet no longer creates duplicate contacts.'],
    prompt: lim => `Summarize this changelog for small-business owners in plain language. Under ${lim} words.`,
    parts: [
      { id: 'p1', t: 'You can now export your contacts to a CSV file from the Contacts page.' },
      { id: 'p2', t: 'Search finds a contact even if you only remember part of their phone number.' },
      { id: 'p3', t: 'Importing a spreadsheet no longer creates duplicate contacts.' }
    ],
    faults: [
      { id: 'hall', label: 'Claims something not in the source (fabrication)', sev: 'Critical', add: 'PDF export is also available, and the dashboard loads twice as fast.', at: 1 },
      { id: 'contra', label: 'Contradicts itself', sev: 'Major', add: 'Note: duplicate contacts may still appear after an import.', at: 3 },
      { id: 'jargon', label: 'Wrong register for the audience (technical jargon)', sev: 'Major', add: 'Matching now uses normalized E.164 numbers with a substring index.', at: 2 },
      { id: 'fluff', label: 'Empty fluency / marketing filler', sev: 'Minor', add: 'This update is a game-changer that will transform the way you work forever!', at: 0 },
      { id: 'over', label: 'Breaks the word limit', sev: 'Major', limit: true }
    ],
    decoys: ['Missing required element', 'Buried lede']
  }
];
function buildCase() {
  const pk = pick(PACKS); const nF = 1 + Math.floor(Math.random() * 3);
  const faults = shuffle(pk.faults).slice(0, nF);
  let parts = pk.parts.map(p => ({ id: p.id, t: p.t }));
  faults.forEach(f => {
    if (f.remove) parts = parts.filter(p => p.id !== f.remove);
    if (f.add) parts.splice(Math.min(f.at, parts.length), 0, { id: 'f-' + f.id, t: f.add });
  });
  const mv = faults.find(f => f.move); if (mv) { const i = parts.findIndex(p => p.id === mv.move); const [x] = parts.splice(i, 1); parts.push(x); }
  const text = pk.bulletMode ? parts.map(p => '• ' + p.t).join('\n') : parts.map(p => p.t).join(' ');
  const count = pk.bulletMode ? parts.length : words(text);
  const over = faults.some(f => f.limit);
  const lim = pk.bulletMode ? (over ? Math.max(3, count - 2) : count + 1) : (over ? Math.round(count * 0.7 / 5) * 5 : Math.ceil((count + 15) / 10) * 10);
  const sevs = faults.map(f => f.sev);
  let score = sevs.includes('Critical') ? 1 : 5 - sevs.filter(s => s === 'Major').length * 1.5 - sevs.filter(s => s === 'Minor').length * 0.5;
  score = Math.max(1, Math.min(5, Math.round(score)));
  const options = shuffle(pk.faults.map(f => ({ id: f.id, label: f.label })).concat(pk.decoys.map((d, i) => ({ id: 'decoy' + i, label: d }))));
  return { pack: pk.id, name: pk.name, source: pk.source, prompt: pk.prompt(lim), text, count, lim, faults: faults.map(f => ({ id: f.id, label: f.label, sev: f.sev, ev: f.add || (f.remove ? 'Missing: ' + pk.parts.find(p => p.id === f.remove).t : f.move ? 'Status appears last' : `${count} ${pk.bulletMode ? 'bullets' : 'words'} vs limit ${lim}`) })), score, options, bullet: !!pk.bulletMode };
}
function genCase(m) {
  const c = buildCase(); const t0 = Date.now();
  m.innerHTML = `<div class="session-top"><a href="#/lab">‹ Simulator</a><span>Case generator</span><span class="tag" id="clock">0:00</span></div>
  <h1 class="sim-title">${esc(c.name)}</h1>
  <div class="sim">
    <section class="case">
      <p class="kicker">Source facts</p><ul class="src">${c.source.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <p class="kicker">Prompt given to the AI</p><p class="prompt">${esc(c.prompt)}</p>
      <p class="kicker">AI response</p><blockquote class="resp">${esc(c.text).replace(/\n/g, '<br>')}</blockquote>
      <p class="muted small">Tip: count before you judge. Requirements in the prompt: list them, then tick each.</p>
    </section>
    <section class="work">
      <label class="lbl">1 · Which flaws are in the response?</label>
      <div class="faults">${c.options.map(o => `<div class="fault" data-id="${o.id}"><label><input type="checkbox"> ${esc(o.label)}</label><select aria-label="Severity"><option value="">Severity</option><option>Critical</option><option>Major</option><option>Minor</option><option>Nit</option></select></div>`).join('')}</div>
      <label class="lbl">2 · Score</label><div class="scorepick" id="sp">${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}">${n}</button>`).join('')}</div>
      <label class="lbl" for="rat">3 · Rationale <small>Verdict → Rule → Evidence → Impact → Fix</small></label>
      <textarea id="rat" rows="7" placeholder="2/5. Accuracy (Critical): …"></textarea>
      <div id="live"></div>
      <div class="row"><button class="btn primary" id="sub">Grade me</button><button class="btn" id="new">New case</button></div>
    </section>
  </div><section id="reveal"></section>`;
  const clock = setInterval(() => { const el = $('#clock'); if (!el) return clearInterval(clock); const s = Math.round((Date.now() - t0) / 1000); el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 1000);
  let pickV = null;
  $$('#sp button', m).forEach(b => b.onclick = () => { $$('#sp button').forEach(x => x.classList.remove('on')); b.classList.add('on'); pickV = +b.dataset.v; });
  const ta = $('#rat'); ta.oninput = () => { $('#live').innerHTML = ta.value.trim() ? rubricHTML(checkRationale(ta.value, 'score')) : ''; };
  $('#new').onclick = () => genCase(m);
  $('#sub').onclick = () => {
    const chosen = $$('.fault', m).filter(f => $('input', f).checked).map(f => ({ id: f.dataset.id, sev: $('select', f).value }));
    const truth = new Set(c.faults.map(f => f.id));
    const tp = chosen.filter(x => truth.has(x.id)).length, fp = chosen.length - tp, fn = c.faults.length - tp;
    const sevOk = chosen.filter(x => { const f = c.faults.find(y => y.id === x.id); return f && f.sev === x.sev; }).length;
    const r = checkRationale(ta.value, 'score');
    const sd = pickV ? Math.abs(pickV - c.score) : 3;
    const pts = Math.max(0, Math.round(tp / c.faults.length * 40 - fp * 10 + sevOk / c.faults.length * 20 + (sd === 0 ? 20 : sd === 1 ? 10 : 0) + r.n / 6 * 20));
    const secs = Math.round((Date.now() - t0) / 1000);
    S.gen.unshift({ ts: Date.now(), pack: c.pack, pts, tp, fp, fn, secs, lvl: r.level }); if (S.gen.length > 100) S.gen.length = 100;
    award('generator', c.name, Math.round(pts / 4) + 5, pts, { tp, fp, fn, secs, score: pickV, truth: c.score });
    $$('.fault', m).forEach(f => { const real = truth.has(f.dataset.id); const ck = $('input', f).checked; f.classList.add(real && ck ? 'tp' : real ? 'fn' : ck ? 'fp' : 'tn'); });
    $('#reveal').innerHTML = `<div class="panel reveal-in">
      <div class="result-head"><div class="big">${pts}<small>/100</small></div><div><h2>${pts >= 80 ? 'Senior-level read' : pts >= 55 ? 'Solid — tighten the gaps' : 'Keep drilling this one'}</h2><p class="muted">Found ${tp} of ${c.faults.length} planted flaws${fp ? ` · ${fp} false alarm${fp > 1 ? 's' : ''}` : ''} · severity right on ${sevOk} · your score ${pickV || '—'} vs key ${c.score}/5 · ${Math.floor(secs / 60)}m ${secs % 60}s</p></div></div>
      <h3>Answer key</h3><ul class="key">${c.faults.map(f => `<li><span class="sev sev-${f.sev.toLowerCase()}">${f.sev}</span><b>${esc(f.label)}</b><span class="ev">${esc(f.ev)}</span></li>`).join('')}</ul>
      <p class="muted small">Key score rule: any Critical caps at 1/5; each Major costs about 1.5; each Minor about 0.5.</p>
      <div class="row"><button class="btn primary" id="again">Next case</button><button class="btn" id="ai2">Ask coach to review my rationale</button></div></div>`;
    $('#again').onclick = () => genCase(m);
    $('#ai2').onclick = () => coach(`Grade my evaluation rationale (practice case, not real task data). Severity, evidence, structure; give my level and the Senior version.\n\nPROMPT: ${c.prompt}\nSOURCE: ${c.source.join(' ')}\nRESPONSE: ${c.text}\nMY SCORE: ${pickV}/5\nMY RATIONALE: ${ta.value}`);
    $('#reveal').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  };
}

/* ---------- DRILLS ---------- */
VIEWS.drills = m => {
  const pri = P.drills.map(d => ({ d, w: !S.drills[d.id] ? 2 : S.drills[d.id].ok ? (S.drills[d.id].last < today() ? 1 : 0.2) : 3 + Math.random() }));
  let set = pri.sort((a, b) => (b.w + Math.random()) - (a.w + Math.random())).slice(0, 5).map(x => x.d);
  let i = 0, ok = 0, timer;
  function show() {
    clearInterval(timer);
    if (i >= set.length) {
      m.innerHTML = `<section class="panel center done-card">${art('mic', 'lg anim')}<h1>Five done</h1><p>${ok} nailed, ${set.length - ok} to repeat tomorrow.</p><div class="row"><button class="btn primary" id="more">Five more</button><button class="btn" data-coach="Mock interview">Mock interview with the coach</button></div></section>`;
      award('drills', 'Rapid-fire set', 10 + ok * 3, ok);
      $('#more').onclick = () => VIEWS.drills(m);
      return;
    }
    const d = set[i]; let left = 60;
    m.innerHTML = `<div class="session-top"><span>Rapid-fire drill ${i + 1} / ${set.length}</span><span class="tag">${esc(d.cat)}</span></div>
    <section class="drill">
      <div class="ring" id="ring" style="--p:1"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52"/><circle class="arc" cx="60" cy="60" r="52"/></svg><b id="sec">60</b></div>
      <h1 class="drill-q">${esc(d.q)}</h1>
      <p class="muted">Answer out loud in under 60 seconds. Typing is optional.</p>
      <textarea id="ans" rows="3" placeholder="Optional notes…"></textarea>
      <div class="row center"><button class="btn bad" id="shaky">Shaky — repeat it</button><button class="btn good" id="nailed">Nailed it</button><button class="btn" id="hint">Ask coach for a model answer</button></div>
    </section>`;
    timer = setInterval(() => { left--; const s = $('#sec'); if (!s) return clearInterval(timer); s.textContent = Math.max(0, left); $('#ring').style.setProperty('--p', Math.max(0, left / 60)); if (left <= 0) { clearInterval(timer); $('#ring').classList.add('out'); } }, 1000);
    const grade = g => { S.drills[d.id] = { ok: g, last: today(), n: ((S.drills[d.id] || {}).n || 0) + 1 }; if (g) ok++; persist(); i++; show(); };
    $('#shaky').onclick = () => grade(false); $('#nailed').onclick = () => grade(true);
    $('#hint').onclick = () => coach(`Rapid-fire drill question: "${d.q}". Give a strong 45-second model answer a Senior PM/PO evaluator would say, then grade mine: ${$('#ans').value || '(I answered out loud)'}`);
  }
  show();
};

/* ---------- MEMORY PALACE ---------- */
VIEWS.palace = m => {
  const rooms = P.palace;
  m.innerHTML = `<header class="page-head"><h1>Memory palace</h1><p>Your career as a building. Walk it in order; each room hands you its frameworks. Do this once before every interview.</p></header>
  <div class="palace">
    <svg class="floor" viewBox="0 0 600 220" aria-hidden="true">
      <path d="M20 200 H580" class="base"/>
      ${rooms.map((r, i) => { const x = 20 + i * 95; return `<g class="room" data-i="${i}" transform="translate(${x},0)"><path d="M4 200V${90 - i * 8}l40-${26}l40 ${26}V200" /><rect x="30" y="160" width="28" height="40" rx="2"/><text x="44" y="${120 - i * 8}" text-anchor="middle">${i + 1}</text></g>`; }).join('')}
    </svg>
    <div class="room-card panel" id="rc"></div>
    <div class="row center"><button class="btn" id="prev">‹ Previous room</button><button class="btn primary" id="nextR">Walk to next room ›</button><button class="btn" id="quiz">Quiz me on this room</button></div>
  </div>`;
  let i = 0;
  const show = () => {
    const r = rooms[i];
    $$('.room', m).forEach(g => g.classList.toggle('on', +g.dataset.i === i));
    const rc = $('#rc'); rc.classList.remove('in'); void rc.offsetWidth; rc.classList.add('in');
    rc.innerHTML = `<p class="kicker">Room ${i + 1} of ${rooms.length}</p><h2>${esc(r.room)}</h2><p class="what"><b>What lives here:</b> ${esc(r.what)}</p><p class="pic"><b>Picture it:</b> ${esc(r.pic)}</p>`;
  };
  $$('.room', m).forEach(g => g.onclick = () => { i = +g.dataset.i; show(); });
  $('#prev').onclick = () => { i = (i + rooms.length - 1) % rooms.length; show(); };
  $('#nextR').onclick = () => { i = (i + 1) % rooms.length; show(); if (i === 0) award('palace', 'Walked the memory palace', 10); };
  $('#quiz').onclick = () => coach(`Quiz me on the frameworks in this memory-palace room: "${rooms[i].room}" — ${rooms[i].what}. 4 quick questions, one at a time.`);
  show();
};

/* ---------- WORKFLOWS ---------- */
const AMBIG = ['quickly', 'fast', 'simple', 'easy', 'intuitive', 'robust', 'seamless', 'user-friendly', 'etc', 'and/or', 'should', 'some', 'many', 'appropriate', 'as needed', 'efficient', 'flexible', 'always', 'never'];
function ambiguity(t) { const s = ' ' + String(t).toLowerCase() + ' '; return AMBIG.filter(w => new RegExp('[^a-z]' + w.replace('/', '\\/') + '[^a-z]').test(s)); }
const WF = {
  'eval-single': {
    title: 'Evaluate one AI response', art: 'scale', mins: 15, hook: 'I Can Always Use Clear, Tight Copy → VREIF',
    why: 'The Day 4 routine plus the Day 5 rationale, as a timed workflow. This is the core of the evaluator job.',
    steps: [
      { id: 'prompt', label: 'Paste the prompt', type: 'area', hint: 'Use a practice prompt or one you wrote. Never paste real micro1 task content or client data.' },
      { id: 'reqs', label: 'List every explicit requirement and constraint', type: 'reqs', hint: 'One per row. Count them. Word limits, formats, must-include items, audience.' },
      { id: 'aud', label: 'Audience and purpose', type: 'text', hint: 'Who reads this, and what must they be able to do after? Execs: WHY + ASK. Engineers: HOW + EDGE. Users: WHAT + NEXT.' },
      { id: 'resp', label: 'Paste the response', type: 'area', hint: 'Read it once for the overall picture before judging.', stats: true },
      { id: 'faults', label: 'Failure modes (3F · 3C · 3T)', type: 'faults', hint: 'Tag what you see. Severity: Trust = Critical, Task = Major, Time = Minor, Taste = Nit.' },
      { id: 'strength', label: 'Strengths', type: 'text', hint: 'What works? Seniors credit what is right.' },
      { id: 'fix', label: 'Fix', type: 'text', hint: 'The one change that would raise the score most.' },
      { id: 'score', label: 'Score', type: 'score', hint: 'Any Critical usually caps at 1–2. Two Majors usually land at 2.' }
    ],
    render: v => {
      const reqs = (v.reqs || []).filter(r => r.t);
      const met = reqs.filter(r => r.s === 'Met').length;
      const fl = (v.faults || []).filter(f => f.on);
      return `Score: ${v.score || '?'}/5 — ${fl.length ? fl.map(f => f.sev + ': ' + f.label).join('; ') : 'meets the brief'}\n` +
        `Instruction following: ${met} of ${reqs.length} requirements met.${reqs.filter(r => r.s !== 'Met').map(r => `\n  - ${r.s || 'Unchecked'}: ${r.t}${r.e ? ` — "${r.e}"` : ''}`).join('')}\n` +
        `Audience fit & usefulness: ${v.aud || '[who is it for; can they act on it?]'}\n` +
        `Issues:${fl.map(f => `\n  - ${f.label} (${f.sev || 'severity?'})${f.e ? `: "${f.e}"` : ''}`).join('') || ' none found'}\n` +
        `Strengths: ${v.strength || '[what works]'}\nFix: ${v.fix || '[what would raise the score]'}`;
    }
  },
  'eval-pair': {
    title: 'Side-by-side comparison', art: 'scale', mins: 12, hook: 'Much better = Major/Critical gap; slightly = Minor',
    why: 'Pairwise judgments are the raw material of RLHF. Decide on one factor and show evidence from both.',
    steps: [
      { id: 'prompt', label: 'The prompt', type: 'area', hint: 'List its requirements in your head first.' },
      { id: 'a', label: 'Response A', type: 'area', stats: true },
      { id: 'b', label: 'Response B', type: 'area', stats: true },
      { id: 'pref', label: 'Preference', type: 'select', opts: ['A is much better', 'A is slightly better', 'B is slightly better', 'B is much better'] },
      { id: 'factor', label: 'Deciding factor, with quoted evidence from both', type: 'area', hint: 'Watch length bias and order bias.' },
      { id: 'as', label: 'A: key strength / key weakness', type: 'text' },
      { id: 'bs', label: 'B: key strength / key weakness', type: 'text' },
      { id: 'flip', label: 'What would change my preference', type: 'text' }
    ],
    render: v => `Preference: ${v.pref || '[A / B] is [much / slightly] better'}.\nDeciding factor: ${v.factor || ''}\nA: ${v.as || ''}\nB: ${v.bs || ''}\nWhat would change my preference: ${v.flip || ''}`
  },
  prd: {
    title: 'One-page PRD', art: 'blueprint', mins: 30, hook: 'Pretty Good Notes Usually Require Fixing All Risky Releases',
    why: 'Problem first, then outcomes, then requirements. Non-goals stop scope creep.',
    steps: [
      { id: 'name', label: 'Feature name', type: 'text' },
      { id: 'problem', label: 'Problem', type: 'area', hint: 'Who has what pain, how often, and the evidence.' },
      { id: 'goal', label: 'Goal & success metrics', type: 'area', hint: 'Count it, cap it, clock it: numerator ÷ denominator, target, by when. Add a counter-metric.' },
      { id: 'non', label: 'Non-goals', type: 'list', hint: 'What this will NOT do.' },
      { id: 'users', label: 'Users & key scenarios', type: 'area', hint: 'Persona(s) and 2–3 main use cases.' },
      { id: 'fr', label: 'Functional requirements', type: 'list', hint: '"The system must…" One testable behaviour per line.' },
      { id: 'nfr', label: 'Non-functional requirements', type: 'area', hint: 'PRISM-SAD: Performance, Reliability, Integrity, Security, Maintainability · Scalability, Accessibility, Data privacy.' },
      { id: 'flow', label: 'User flow incl. errors and edge cases', type: 'area' },
      { id: 'assume', label: 'Assumptions / constraints / dependencies', type: 'area' },
      { id: 'risks', label: 'Risks & open questions', type: 'area', hint: 'Want it? Use it? Build it? Should we? (Value, Usability, Feasibility, Viability)' },
      { id: 'release', label: 'Release approach', type: 'text', hint: 'Pilot, phases, rollback plan.' }
    ],
    render: v => `# ${v.name || '[Feature name]'}\n\nProblem: ${v.problem || ''}\nGoal & success metrics: ${v.goal || ''}\nNon-goals:${li(v.non)}\nUsers & key scenarios: ${v.users || ''}\nFunctional requirements:${(v.fr || []).filter(Boolean).map((x, i) => `\n  ${i + 1}. ${x}`).join('')}\nNon-functional requirements: ${v.nfr || ''}\nUser flow: ${v.flow || ''}\nAssumptions / constraints / dependencies: ${v.assume || ''}\nRisks & open questions: ${v.risks || ''}\nRelease approach: ${v.release || ''}`
  },
  story: {
    title: 'User story + acceptance criteria', art: 'blueprint', mins: 10, hook: 'INVEST · Scene, Act, Proof',
    why: 'Testable criteria are binary, observable and include the unhappy path.',
    steps: [
      { id: 'user', label: 'As a…', type: 'text', hint: 'A specific user, not "the user".' },
      { id: 'want', label: 'I want…', type: 'text' },
      { id: 'so', label: 'So that…', type: 'text', hint: 'The benefit (outcome), not the feature.' },
      { id: 'ac', label: 'Acceptance criteria (Given / When / Then)', type: 'list', hint: 'Include at least one unhappy path and one rule with a number.' },
      { id: 'oos', label: 'Out of scope', type: 'text' }
    ],
    render: v => `As a ${v.user || '[user]'}, I want ${v.want || '[capability]'}, so that ${v.so || '[benefit]'}.\n\nAcceptance criteria:${li(v.ac)}\n\nOut of scope: ${v.oos || ''}`
  },
  release: {
    title: 'Release notes', art: 'chairs', mins: 10, hook: 'Happy News Is Fixed Always',
    why: 'Benefit first, what changed second, and always the action required.',
    steps: [
      { id: 'ver', label: 'Version — date', type: 'text' },
      { id: 'hl', label: 'Highlight', type: 'text', hint: 'Biggest user benefit in one sentence.' },
      { id: 'new', label: 'New', type: 'list', hint: 'Benefit first — what changed.' },
      { id: 'imp', label: 'Improved', type: 'list' },
      { id: 'fix', label: 'Fixed', type: 'list', hint: 'What users will notice.' },
      { id: 'act', label: 'Action required', type: 'text', hint: 'What users must do differently, or "None".' }
    ],
    render: v => `## ${v.ver || '[Version] — [Date]'}\nHighlight: ${v.hl || ''}\n${(v.new || []).filter(Boolean).map(x => '\nNew: ' + x).join('')}${(v.imp || []).filter(Boolean).map(x => '\nImproved: ' + x).join('')}${(v.fix || []).filter(Boolean).map(x => '\nFixed: ' + x).join('')}\nAction required: ${v.act || ''}`
  },
  update: {
    title: 'Stakeholder update (BLUF)', art: 'chairs', mins: 10, hook: 'Smart Captains Measure Risks And Navigate',
    why: 'Bottom line first. An executive should know the status and your ask from line one.',
    steps: [
      { id: 'status', label: 'Status', type: 'select', opts: ['On track', 'At risk', 'Off track'] },
      { id: 'why', label: 'One-line reason', type: 'text' },
      { id: 'since', label: 'Since last update', type: 'list', hint: 'Outcomes, not activities.' },
      { id: 'metrics', label: 'Metrics', type: 'text', hint: 'Number vs target.' },
      { id: 'risks', label: 'Risks / blockers', type: 'list', hint: 'Risk → impact → mitigation.' },
      { id: 'ask', label: 'Decision or help needed', type: 'text', hint: '[Ask] — [owner] by [date]' },
      { id: 'next', label: 'Next', type: 'list', hint: 'Top 1–3 items.' }
    ],
    render: v => `Status: ${v.status || '[On track / At risk / Off track]'} — ${v.why || ''}\nSince last update:${li(v.since)}\nMetrics: ${v.metrics || ''}\nRisks / blockers:${li(v.risks)}\nDecision or help needed: ${v.ask || ''}\nNext:${li(v.next)}`
  },
  decision: {
    title: 'Decision document', art: 'compass', mins: 20, hook: 'Don\'t Choose Options Randomly; Trade-offs Count',
    why: 'Record the decision, the options you rejected, and what you gave up.',
    steps: [
      { id: 'dec', label: 'Decision', type: 'text', hint: 'One sentence.' },
      { id: 'ctx', label: 'Context', type: 'area' },
      { id: 'opts', label: 'Options considered (with pros / cons)', type: 'list' },
      { id: 'rat', label: 'Rationale', type: 'area', hint: 'Criteria used and why the chosen option wins.' },
      { id: 'trade', label: 'Trade-offs accepted', type: 'text' },
      { id: 'cons', label: 'Consequences / follow-ups', type: 'area' },
      { id: 'owner', label: 'Owner & date', type: 'text' }
    ],
    render: v => `Decision: ${v.dec || ''}\nContext: ${v.ctx || ''}\nOptions considered:${li(v.opts)}\nRationale: ${v.rat || ''}\nTrade-offs accepted: ${v.trade || ''}\nConsequences / follow-ups: ${v.cons || ''}\nOwner & date: ${v.owner || ''}`
  },
  escalation: {
    title: 'Escalation note', art: 'pen', mins: 5, hook: 'Gap, Rule, Ask, Act',
    why: 'When guidelines don\'t cover a case: escalate, don\'t guess, and say what you did meanwhile.',
    steps: [
      { id: 'gap', label: 'Ambiguity', type: 'area', hint: 'What is unclear.' },
      { id: 'rule', label: 'Missing rule', type: 'text', hint: 'What the guidelines don\'t cover.' },
      { id: 'ask', label: 'Decision needed', type: 'text', hint: 'The question, in one sentence.' },
      { id: 'act', label: 'What I did meanwhile', type: 'text', hint: 'How you scored it and flagged it.' }
    ],
    render: v => `Ambiguity: ${v.gap || ''}\nMissing rule: ${v.rule || ''}\nDecision needed: ${v.ask || ''}\nWhat I did meanwhile: ${v.act || ''}`
  }
};
function li(a) { return (a || []).filter(Boolean).map(x => '\n- ' + x).join(''); }
const FAULTS = ['Fluent-but-wrong', 'Filler / empty fluency', 'Fabrication (hallucination)', 'Constraint breach', 'Contradiction', 'Scope creep', 'Tone mismatch', 'Wrong target audience', 'Truncated / incomplete', 'Buried lede'];

VIEWS.build = m => {
  m.innerHTML = `<header class="page-head"><h1>Workflows</h1><p>Real work, step by step. Each workflow walks you through a deliverable, checks it as you write, and saves it to My work.</p></header>
  <div class="wf-grid">${Object.entries(WF).map(([id, w]) => `<a class="panel wf" href="#/wf/${id}">${art(w.art, 'sm')}<div><h2>${esc(w.title)}</h2><p class="muted small">${esc(w.why)}</p><p class="small"><span class="tag">${w.steps.length} steps</span> <span class="tag">~${w.mins} min</span></p></div></a>`).join('')}</div>
  <h2 class="sec">My work</h2>
  ${S.work.length ? `<ul class="mywork">${S.work.slice().sort((a, b) => b.ts - a.ts).map(w => `<li><a href="#/wf/${w.wf}/${w.id}"><b>${esc(w.title || WF[w.wf].title)}</b><small>${esc(WF[w.wf] ? WF[w.wf].title : w.wf)} · ${new Date(w.ts).toLocaleDateString()}</small></a></li>`).join('')}</ul>` : '<p class="empty">Nothing yet. Start with “Evaluate one AI response”, the core skill of the role.</p>'}`;
};
VIEWS.wf = (m, [id, docId]) => {
  const w = WF[id]; if (!w) { location.hash = '#/build'; return; }
  let doc = docId && S.work.find(x => x.id === docId);
  if (!doc) doc = { id: 'w' + Date.now().toString(36), wf: id, title: '', v: {}, ts: Date.now(), t0: Date.now() };
  const v = doc.v; let step = 0;
  m.innerHTML = `<div class="session-top"><a href="#/build">‹ Workflows</a><span>${esc(w.title)}</span><span class="tag" id="clock">${w.mins} min target</span></div>
  <div class="wf-layout">
    <section class="wf-steps">
      <header class="wf-head">${art(w.art, 'sm')}<div><h1>${esc(w.title)}</h1><p class="muted small">Hook: <b>${esc(w.hook)}</b></p></div></header>
      <ol class="stepper" id="stepper">${w.steps.map((s, i) => `<li data-i="${i}"><button>${esc(s.label)}</button></li>`).join('')}</ol>
      <div id="stepBody"></div>
      <div class="row"><button class="btn" id="back">Back</button><button class="btn primary" id="fwd">Next step</button></div>
    </section>
    <aside class="wf-preview panel">
      <div class="row between"><b>Live draft</b><span><button class="btn sm" id="cp">Copy</button> <button class="btn sm" id="dl">Download .md</button></span></div>
      <pre id="pv"></pre>
      <div id="lint"></div>
      <div class="row"><button class="btn primary" id="save">Save to My work</button><button class="btn" id="review">Ask coach to review</button></div>
    </aside>
  </div>`;
  const t0 = doc.t0 || Date.now();
  const clock = setInterval(() => { const el = $('#clock'); if (!el) return clearInterval(clock); const s = Math.round((Date.now() - t0) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${w.mins}:00`; el.classList.toggle('late', s > w.mins * 60); }, 1000);
  function md() { return w.render(v); }
  function refresh() {
    $('#pv').textContent = md();
    const all = JSON.stringify(v); const amb = ambiguity(all.replace(/"(prompt|resp|a|b)":"[^"]*"/g, ''));
    const lints = [];
    if (amb.length) lints.push(['warn', `Ambiguity words: ${amb.slice(0, 8).join(', ')}. Replace with something testable.`]);
    const empty = w.steps.filter(s => { const x = v[s.id]; return x == null || x === '' || (Array.isArray(x) && !x.filter(y => y && (y.t || y.on || typeof y === 'string')).length); });
    if (empty.length) lints.push(['info', `${empty.length} step${empty.length > 1 ? 's' : ''} still empty: ${empty.map(s => s.label).slice(0, 3).join(', ')}${empty.length > 3 ? '…' : ''}`]);
    if (id === 'eval-single' || id === 'eval-pair') { const r = checkRationale(md(), id === 'eval-pair' ? 'pair' : 'score'); lints.push([r.level === 'Senior' ? 'ok' : 'info', `Rationale rubric: ${r.level} (${r.n}/6 parts)`]); }
    if (id === 'prd' && v.goal && !/\d/.test(v.goal)) lints.push(['warn', 'Success metric has no number. Count it, cap it, clock it.']);
    if (id === 'story' && (v.ac || []).filter(Boolean).length && !(v.ac || []).some(a => /given/i.test(a) && /then/i.test(a))) lints.push(['warn', 'Write criteria as Given / When / Then.']);
    if (id === 'update' && v.ask && !/\b(by|before)\b/i.test(v.ask)) lints.push(['warn', 'Your ask has no deadline. Add "by [date]".']);
    $('#lint').innerHTML = lints.map(([k, t]) => `<p class="lint ${k}">${esc(t)}</p>`).join('');
    $$('#stepper li').forEach((li, i) => { const s = w.steps[i]; const x = v[s.id]; li.classList.toggle('filled', !(x == null || x === '' || (Array.isArray(x) && !x.length))); li.classList.toggle('on', i === step); });
  }
  function field(s) {
    const val = v[s.id];
    if (s.type === 'text') return `<input id="f" value="${esc(val || '')}" placeholder="${esc(s.hint || '')}">`;
    if (s.type === 'area') return `<textarea id="f" rows="7" placeholder="${esc(s.hint || '')}">${esc(val || '')}</textarea>${s.stats ? '<p class="muted small" id="st"></p>' : ''}`;
    if (s.type === 'select') return `<div class="scorepick wide">${s.opts.map(o => `<button data-v="${esc(o)}" class="${val === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`;
    if (s.type === 'score') return `<div class="scorepick">${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}" class="${+val === n ? 'on' : ''}">${n}</button>`).join('')}</div><p class="muted small" id="sug"></p>`;
    if (s.type === 'list') { const a = (val && val.length ? val : ['']); return `<div class="lst">${a.map((x, i) => `<div class="lrow"><input data-i="${i}" value="${esc(x)}" placeholder="${i === 0 ? esc(s.hint || '') : ''}"><button class="x" data-del="${i}" aria-label="Remove">✕</button></div>`).join('')}</div><button class="btn sm" id="add">Add line</button>`; }
    if (s.type === 'reqs') { const a = (val && val.length ? val : [{ t: '', s: '', e: '' }]); return `<div class="lst reqs">${a.map((r, i) => `<div class="lrow req"><input data-i="${i}" data-f="t" value="${esc(r.t)}" placeholder="Requirement ${i + 1}"><select data-i="${i}" data-f="s"><option value="">Check later</option>${['Met', 'Partly met', 'Missed'].map(o => `<option ${r.s === o ? 'selected' : ''}>${o}</option>`).join('')}</select><input data-i="${i}" data-f="e" value="${esc(r.e)}" placeholder="Quoted evidence"><button class="x" data-del="${i}" aria-label="Remove">✕</button></div>`).join('')}</div><button class="btn sm" id="add">Add requirement</button><button class="btn sm" id="auto">Detect from prompt</button>`; }
    if (s.type === 'faults') { const a = val && val.length ? val : FAULTS.map(l => ({ label: l, on: false, sev: '', e: '' })); v[s.id] = a; return `<div class="faults big">${a.map((f, i) => `<div class="fault ${f.on ? 'sel' : ''}"><label><input type="checkbox" data-i="${i}" ${f.on ? 'checked' : ''}> ${esc(f.label)}</label><select data-i="${i}" data-f="sev"><option value="">Severity</option>${['Critical', 'Major', 'Minor', 'Nit'].map(o => `<option ${f.sev === o ? 'selected' : ''}>${o}</option>`).join('')}</select><input data-i="${i}" data-f="e" value="${esc(f.e)}" placeholder="Quote" ${f.on ? '' : 'hidden'}></div>`).join('')}</div>`; }
    return '';
  }
  function draw() {
    const s = w.steps[step];
    $('#stepBody').innerHTML = `<div class="step-card"><p class="kicker">Step ${step + 1} of ${w.steps.length}</p><h2>${esc(s.label)}</h2>${s.hint && !['text', 'area', 'list'].includes(s.type) ? `<p class="muted">${esc(s.hint)}</p>` : ''}${field(s)}</div>`;
    $('#back').disabled = step === 0; $('#fwd').textContent = step === w.steps.length - 1 ? 'Finish' : 'Next step';
    const B = $('#stepBody');
    const f = $('#f', B);
    if (f) { f.oninput = () => { v[s.id] = f.value; stats(); refresh(); }; f.focus(); }
    const stats = () => { const st = $('#st', B); if (st) { const t = v[s.id] || ''; st.textContent = `${words(t)} words · ${(t.match(/^\s*([-•*]|\d+[.)])\s/gm) || []).length} bullets · ${t.split(/\n\s*\n/).filter(x => x.trim()).length} paragraphs`; } };
    stats();
    $$('.scorepick button', B).forEach(b => b.onclick = () => { $$('.scorepick button', B).forEach(x => x.classList.remove('on')); b.classList.add('on'); v[s.id] = s.type === 'score' ? +b.dataset.v : b.dataset.v; refresh(); });
    if (s.type === 'score') { const fl = (v.faults || []).filter(x => x.on); const sev = fl.map(x => x.sev); let sc = sev.includes('Critical') ? 1 : 5 - sev.filter(x => x === 'Major').length * 1.5 - sev.filter(x => x === 'Minor').length * 0.5; sc = Math.max(1, Math.min(5, Math.round(sc))); $('#sug', B).textContent = `From your tagged issues, a consistent score would be about ${sc}/5. ${s.hint}`; }
    if (s.type === 'list') {
      const sync = () => { v[s.id] = $$('.lrow input', B).map(i => i.value); refresh(); };
      $$('.lrow input', B).forEach(i => { i.oninput = sync; i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sync(); v[s.id].splice(+i.dataset.i + 1, 0, ''); draw(); $$('.lrow input', $('#stepBody'))[+i.dataset.i + 1].focus(); } }; });
      $$('[data-del]', B).forEach(b => b.onclick = () => { sync(); v[s.id].splice(+b.dataset.del, 1); draw(); refresh(); });
      $('#add', B).onclick = () => { sync(); v[s.id].push(''); draw(); const ins = $$('.lrow input', $('#stepBody')); ins[ins.length - 1].focus(); };
      const first = $('.lrow input', B); if (first) first.focus();
    }
    if (s.type === 'reqs') {
      const sync = () => { const a = []; $$('.req', B).forEach((row, i) => a.push({ t: $('[data-f=t]', row).value, s: $('[data-f=s]', row).value, e: $('[data-f=e]', row).value })); v[s.id] = a; refresh(); };
      $$('.req input, .req select', B).forEach(x => { x.oninput = sync; x.onchange = sync; });
      $$('[data-del]', B).forEach(b => b.onclick = () => { sync(); v[s.id].splice(+b.dataset.del, 1); draw(); refresh(); });
      $('#add', B).onclick = () => { sync(); v[s.id].push({ t: '', s: '', e: '' }); draw(); };
      $('#auto', B).onclick = () => {
        const p = v.prompt || ''; if (!p.trim()) { toast('Paste the prompt in step 1 first'); return; }
        const sents = p.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
        const found = sents.filter(x => /\b(must|should|include|under|max|maximum|at least|no more than|exactly|only|lead with|limit|words?|bullets?|for\s+[a-z]+s?\b)/i.test(x) || /\d/.test(x));
        sync(); const have = new Set(v[s.id].map(r => r.t)); found.forEach(t => { if (!have.has(t)) v[s.id].push({ t, s: '', e: '' }); });
        v[s.id] = v[s.id].filter(r => r.t || r.e); if (!v[s.id].length) v[s.id].push({ t: '', s: '', e: '' });
        draw(); refresh(); toast(`${found.length} requirement${found.length === 1 ? '' : 's'} detected. Check and edit them.`);
      };
    }
    if (s.type === 'faults') {
      $$('.fault input[type=checkbox]', B).forEach(c => c.onchange = () => { const f = v[s.id][+c.dataset.i]; f.on = c.checked; c.closest('.fault').classList.toggle('sel', c.checked); $('[data-f=e]', c.closest('.fault')).hidden = !c.checked; refresh(); });
      $$('.fault select, .fault input[data-f=e]', B).forEach(x => { const h = () => { v[s.id][+x.dataset.i][x.dataset.f] = x.value; refresh(); }; x.oninput = h; x.onchange = h; });
    }
    refresh();
  }
  $('#back').onclick = () => { if (step > 0) { step--; draw(); } };
  $('#fwd').onclick = () => { if (step < w.steps.length - 1) { step++; draw(); } else save(true); };
  $('#stepper').onclick = e => { const li = e.target.closest('li'); if (li) { step = +li.dataset.i; draw(); } };
  $('#cp').onclick = () => copy(md()).then(() => toast('Draft copied'));
  $('#dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md()], { type: 'text/markdown' })); a.download = (doc.title || w.title).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.md'; a.click(); };
  $('#review').onclick = () => coach(`Review this ${w.title} like a senior PM/PO reviewer. Name the top 3 issues with severity (Critical/Major/Minor/Nit), quote the words, and give the fix. Practice content only.\n\n${md()}`);
  function save(finish) {
    doc.title = v.name || v.ver || v.dec || (v.prompt ? v.prompt.slice(0, 50) : '') || w.title;
    doc.md = md(); doc.ts = Date.now(); doc.secs = Math.round((Date.now() - t0) / 1000);
    const i = S.work.findIndex(x => x.id === doc.id); const isNew = i < 0;
    if (isNew) S.work.push(doc); else S.work[i] = doc;
    const xp = isNew ? 25 + (doc.secs <= w.mins * 60 ? 10 : 0) : 5;
    award('workflow', w.title + (doc.title !== w.title ? ': ' + doc.title.slice(0, 40) : ''), xp, doc.secs, '');
    if (Sync.enabled) Sync.event('work', doc.title, doc.secs, JSON.stringify(doc).slice(0, 45000));
    if (finish) { toast(`Saved. ${Math.floor(doc.secs / 60)} min ${doc.secs % 60} s${doc.secs <= w.mins * 60 ? ' — inside the target' : ''}.`); }
    if (isNew) history.replaceState(null, '', '#/wf/' + id + '/' + doc.id);
  }
  $('#save').onclick = () => save(false);
  draw();
};

/* ---------- SHADOW A PM (OJT) ---------- */
const O = window.OJT || { stages: [], products: {}, terms: {}, eps: [] };
const EP = {}; O.eps.forEach(e => EP[e.id] = e);
const epFor = (s, p) => O.eps.find(e => e.s === s && e.p === p);
const STAGE_OF_CH = {}; O.stages.forEach(st => st.chapters.forEach(c => { if (!STAGE_OF_CH[c]) STAGE_OF_CH[c] = st.n; }));
function ojtState(id) { S.ojt = S.ojt || {}; return S.ojt[id] = S.ojt[id] || { calls: {}, task: '', qa: {}, done: 0 }; }

function mdInline(s) {
  return esc(s).replace(/\[\[([a-z0-9]+)\|([^\]]+)\]\]/g, (m, k, t) => O.terms[k] ? `<button class="term" data-t="${k}">${t}</button>` : t)
    .replace(/\[\[([a-z0-9]+)\]\]/g, (m, k) => O.terms[k] ? `<button class="term" data-t="${k}">${esc(O.terms[k].name)}</button>` : k)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function md(src) {
  const lines = String(src).split('\n'); let out = '', list = null, table = null, para = [];
  const flushP = () => { if (para.length) { out += `<p>${para.map(mdInline).join('<br>')}</p>`; para = []; } };
  const flushL = () => { if (list) { out += `<${list.t}>${list.items.map(i => `<li>${mdInline(i)}</li>`).join('')}</${list.t}>`; list = null; } };
  const flushT = () => { if (table) { out += '<div class="tbl"><table>' + table.map((r, i) => '<tr>' + r.map(c => i === 0 ? `<th>${mdInline(c)}</th>` : `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') + '</table></div>'; table = null; } };
  const flush = () => { flushP(); flushL(); flushT(); };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) { flush(); continue; }
    let m;
    if ((m = l.match(/^(#{1,2})\s+(.*)/))) { flush(); out += m[1].length === 1 ? `<h3>${mdInline(m[2])}</h3>` : `<h4>${mdInline(m[2])}</h4>`; continue; }
    if (l.startsWith('|')) { flushP(); flushL(); (table = table || []).push(l.replace(/^\||\|$/g, '').split('|').map(x => x.trim())); continue; }
    if ((m = l.match(/^\s*[-•]\s+(.*)/))) { flushP(); flushT(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); flushT(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = l.match(/^>\s?(.*)/))) { flush(); out += `<blockquote>${mdInline(m[1])}</blockquote>`; continue; }
    flushL(); flushT(); para.push(l);
  }
  flush(); return out;
}
const plain = s => String(s).replace(/\[\[[a-z0-9]+\|([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '');
function wordDiff(a, b) {
  const tok = t => plain(t).replace(/\n+/g, ' ¶ ').split(/\s+/).filter(Boolean); const A = tok(a), B = tok(b);
  const n = A.length, mm = B.length; const L = Array.from({ length: n + 1 }, () => new Uint16Array(mm + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = mm - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = [];
  while (i < n && j < mm) { if (A[i] === B[j]) { out.push(esc(A[i])); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { out.push(`<del>${esc(A[i++])}</del>`); } else { out.push(`<ins>${esc(B[j++])}</ins>`); } }
  while (i < n) out.push(`<del>${esc(A[i++])}</del>`); while (j < mm) out.push(`<ins>${esc(B[j++])}</ins>`);
  return out.join(' ').replace(/<\/del> <del>/g, ' ').replace(/<\/ins> <ins>/g, ' ').replace(/<del>(\s*¶\s*)+<\/del>/g, '').replace(/\s*¶\s*/g, '<br>');
}
function markQuotes(root, comments) {
  comments.forEach((c, n) => {
    const q = c[1].toLowerCase(); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = w.nextNode())) {
      const i = node.data.toLowerCase().indexOf(q); if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + q.length);
      const mk = document.createElement('mark'); mk.className = 'cmt'; mk.dataset.n = n + 1; r.surroundContents(mk); break;
    }
  });
}
function who(cast, k) { const c = cast[k] || [k, '', 'user']; const ini = c[0].split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join(''); return { name: c[0], role: c[1], team: c[2], ini }; }
const avatar = (cast, k) => { const p = who(cast, k); return `<span class="av t-${p.team}" title="${esc(p.name)} — ${esc(p.role)}">${esc(p.ini)}</span>`; };

// term popover
document.addEventListener('click', e => {
  const t = e.target.closest('.term'); const pop = $('#termpop');
  if (!t) { if (pop && !e.target.closest('#termpop')) pop.hidden = true; return; }
  const d = O.terms[t.dataset.t]; if (!d || !pop) return;
  pop.innerHTML = `<b>${esc(d.name)}</b><p>${esc(d.def)}</p>${CH[d.ch] ? `<a href="#/read/${d.ch}">Lesson: ${esc(CH[d.ch].title)}</a>` : ''}`;
  const r = t.getBoundingClientRect(); pop.hidden = false;
  pop.style.top = (r.bottom + scrollY + 8) + 'px'; pop.style.left = Math.max(12, Math.min(innerWidth - 332, r.left)) + 'px';
});

VIEWS.ojt = (m, [a, b]) => {
  if (a === 'stage') return ojtPicker(m, +b);
  if (a && EP[a]) return ojtPlayer(m, EP[a], b === 'sim' ? 'sim' : 'watch');
  const doneN = O.eps.filter(e => S.ojt && S.ojt[e.id] && S.ojt[e.id].done).length;
  m.innerHTML = `<header class="page-head"><h1>Shadow a PM</h1><p>Sit beside a senior PM or PO while they do the real work: the messy meetings and messages first, then their thinking, the decisions, every draft that got rejected and why, the finished documents, and the questions each team will throw at you. Pick a lesson, pick a product, then watch it done or simulate it yourself.</p><p class="small muted">${doneN} of ${O.eps.length} episodes complete · all companies and people are fictional</p></header>
  <div class="prod-row">${Object.entries(O.products).map(([k, p]) => `<div class="panel prod" style="--pc:${p.color}"><span class="tag">${esc(p.type)}</span><h3>${esc(p.name)}</h3><p class="small">${esc(p.what)}</p><p class="small muted">Feature: <b>${esc(p.feature)}</b><br>Mentor: ${esc(p.mentor)}, ${esc(p.mentorRole)}</p></div>`).join('')}</div>
  <ol class="stages">${O.stages.map(st => `<li class="panel stage">
    <div class="stage-head">${art(st.art, 'sm')}<div><p class="kicker">Stage ${st.n} · ${esc(st.lesson)}</p><h2>${esc(st.title)}</h2><p class="small muted">${esc(st.teaches)}</p></div></div>
    <div class="stage-picks">${Object.keys(O.products).map(pk => { const e = epFor(st.n, pk); if (!e) return ''; const ds = S.ojt && S.ojt[e.id]; return `<a class="pick ${ds && ds.done ? 'done' : ''}" style="--pc:${O.products[pk].color}" href="#/ojt/${e.id}"><b>${esc(O.products[pk].name)}</b><span>${esc(e.title)}</span><small>${ds && ds.done ? 'Done' : 'Start'}</small></a>`; }).join('')}</div>
  </li>`).join('')}</ol>`;
};

function ojtPicker(m, n) {
  const st = O.stages.find(x => x.n === n); if (!st) { location.hash = '#/ojt'; return; }
  m.innerHTML = `<div class="session-top"><a href="#/ojt">‹ Shadow a PM</a><span>Stage ${n}</span></div>
  <header class="page-head"><h1>${esc(st.title)}</h1><p>Lesson: ${st.chapters.map(c => CH[c] ? `<a href="#/read/${c}">${esc(CH[c].title)}</a>` : '').join(' · ')}</p><p>Which product do you want to work on?</p></header>
  <div class="pick-big">${Object.entries(O.products).map(([pk, p]) => { const e = epFor(n, pk); return e ? `<div class="panel pickcard" style="--pc:${p.color}"><span class="tag">${esc(p.type)}</span><h2>${esc(p.name)}</h2><p class="small muted">${esc(p.what)}</p><h3>${esc(e.title)}</h3><p class="small">${esc(e.scene.slice(0, 180))}…</p><div class="row"><a class="btn primary" href="#/ojt/${e.id}">Watch the PM</a><a class="btn" href="#/ojt/${e.id}/sim">Simulate it myself</a></div></div>` : ''; }).join('')}</div>`;
}

function ojtPlayer(m, e, mode) {
  const p = O.products[e.p]; const st = O.stages.find(x => x.n === e.s); const S0 = ojtState(e.id);
  const calls = e.walk.map((w, i) => w.call ? i : -1).filter(i => i >= 0);
  const others = Object.keys(O.products).map(pk => epFor(e.s, pk)).filter(x => x && x.id !== e.id);
  m.innerHTML = `<div class="session-top"><a href="#/ojt">‹ Shadow a PM</a><span>Stage ${st.n} · ${esc(st.lesson)}</span><span class="modes"><a class="${mode === 'watch' ? 'on' : ''}" href="#/ojt/${e.id}">Watch</a><a class="${mode === 'sim' ? 'on' : ''}" href="#/ojt/${e.id}/sim">Simulate</a></span></div>
  <header class="ep-head" style="--pc:${p.color}"><div><p class="kicker">${esc(p.name)} · ${esc(p.feature)}</p><h1>${esc(e.title)}</h1>
    <p class="lessons">${st.chapters.map(c => CH[c] ? `<a class="chip" href="#/read/${c}">${esc(CH[c].title)}</a>` : '').join('')}</p></div>${art(st.art, 'md anim')}</header>
  <div class="scene panel">${avatar(e.cast, Object.keys(e.cast)[0])}<p>${esc(e.scene)}</p></div>
  ${mode === 'sim' ? `<p class="simnote">Simulate mode: read the inputs, make each decision, then write the work yourself. The PM's walkthrough, drafts and finished documents unlock after you submit.</p>` : ''}
  <section class="ojt-sec"><h2><span class="n">1</span>The inputs</h2><p class="muted small">What the PM had in front of them. ${mode === 'watch' ? 'Press Play on meetings to watch them happen, with the PM\'s notes in the margin.' : 'Read everything before deciding anything.'}</p>
    <div class="src-tabs" role="tablist">${e.sources.map((s, i) => `<button role="tab" data-i="${i}" class="${i === 0 ? 'on' : ''}"><i class="st-${s.type}"></i>${esc(s.title)}</button>`).join('')}</div>
    <div id="srcBody"></div></section>
  <section class="ojt-sec" id="secWalk"></section>
  <section class="ojt-sec" id="secTask"></section>
  <section class="ojt-sec" id="secDocs"></section>
  <section class="ojt-sec" id="secQA"></section>
  <footer class="ep-foot" id="epFoot"></footer>`;

  // sources
  const showSrc = i => {
    $$('.src-tabs button', m).forEach(b => b.classList.toggle('on', +b.dataset.i === i));
    const s = e.sources[i]; const box = $('#srcBody');
    if (s.lines) {
      box.innerHTML = `<div class="src-card"><div class="src-meta"><b>${esc(s.title)}</b><span>${esc(s.meta || '')}</span>${mode === 'watch' ? '<button class="btn sm" id="play">▶ Play</button>' : ''}</div>
      <ol class="transcript ${s.type}">${s.lines.map((l, j) => { const pp = who(e.cast, l[0]); return `<li data-j="${j}">${avatar(e.cast, l[0])}<div class="bub"><b>${esc(pp.name)}</b> <small>${esc(pp.role)}</small><p>${esc(l[1])}</p></div>${l[2] && mode === 'watch' ? `<aside class="pmnote"><b>${esc(p.mentor.split(' ')[0])}'s note</b>${esc(l[2])}</aside>` : ''}</li>`; }).join('')}</ol></div>`;
      const play = $('#play');
      if (play) play.onclick = () => {
        const items = $$('.transcript li', box); items.forEach(li => li.classList.add('hide')); play.disabled = true;
        let j = 0; const step = () => { if (!document.body.contains(box)) return; if (j >= items.length) { play.disabled = false; play.textContent = '↻ Replay'; return; } items[j].classList.remove('hide'); items[j].classList.add('pop'); items[j].scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); const len = (s.lines[j][1].length + (s.lines[j][2] || '').length); j++; setTimeout(step, reduced ? 0 : Math.min(4200, 900 + len * 28)); };
        step();
      };
    } else {
      box.innerHTML = `<div class="src-card ${s.type}"><div class="src-meta"><b>${esc(s.title)}</b><span>${esc(s.meta || '')}</span></div><div class="src-body prose-s">${md(s.body)}</div></div>`;
    }
  };
  $$('.src-tabs button', m).forEach(b => b.onclick = () => showSrc(+b.dataset.i)); showSrc(0);

  function callCard(w, i) {
    const c = w.call; const chosen = S0.calls[i];
    return `<div class="call ${chosen != null ? 'answered' : ''}" data-i="${i}"><p class="kicker">Your call</p><h3>${esc(c.q)}</h3>
      <div class="opts">${c.opts.map((o, k) => `<button data-k="${k}" class="${chosen != null ? (k === c.a ? 'right' : k === chosen ? 'wrong' : '') : ''}" ${chosen != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
      <div class="why" ${chosen != null ? '' : 'hidden'}><b>${chosen === c.a ? 'Same call as the PM.' : 'The PM chose differently.'}</b> ${esc(c.why)}</div></div>`;
  }
  function bindCalls(root) {
    $$('.call', root).forEach(card => {
      const i = +card.dataset.i; const c = e.walk[i].call;
      $$('.opts button', card).forEach(b => b.onclick = () => {
        if (S0.calls[i] != null) return; const k = +b.dataset.k; S0.calls[i] = k; persist();
        $$('.opts button', card).forEach(x => { x.disabled = true; const kk = +x.dataset.k; if (kk === c.a) x.classList.add('right'); else if (kk === k) x.classList.add('wrong'); });
        $('.why', card).hidden = false; $('.why b', card).textContent = k === c.a ? 'Same call as the PM.' : 'The PM chose differently.';
        card.classList.add('answered'); if (k === c.a) toast('Same call as a senior PM');
        if (mode === 'watch') nextStep();
      });
    });
  }
  // walkthrough
  let shown = 0;
  function walkHTML(upto) {
    return e.walk.slice(0, upto).map((w, i) => w.call ? callCard(w, i) : `<div class="say">${avatar(e.cast, Object.keys(e.cast)[0])}<div><p>${esc(w.say)}</p>${(w.terms || []).length ? `<p class="terms">${w.terms.map(k => O.terms[k] ? `<button class="term" data-t="${k}">${esc(O.terms[k].name)}</button>` : '').join('')}</p>` : ''}${w.ref ? `<button class="linkish" data-ref="${w.ref}">See the source</button>` : ''}</div></div>`).join('');
  }
  function renderWalk() {
    const sec = $('#secWalk');
    sec.innerHTML = `<h2><span class="n">2</span>Over ${esc(p.mentor.split(' ')[0])}'s shoulder</h2><p class="muted small">${esc(p.mentor)}, ${esc(p.mentorRole)}, explains each move as it happens.</p><div class="walk">${walkHTML(shown)}</div>
      ${shown < e.walk.length ? `<div class="row"><button class="btn primary" id="wNext">Continue</button><button class="btn" id="wAll">Show all</button></div>` : ''}`;
    bindCalls(sec);
    $$('[data-ref]', sec).forEach(b => b.onclick = () => { const i = e.sources.findIndex(s => s.id === b.dataset.ref); if (i >= 0) { showSrc(i); $('.src-tabs').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); } });
    const nx = $('#wNext'); if (nx) nx.onclick = nextStep; const al = $('#wAll'); if (al) al.onclick = () => { shown = e.walk.length; renderWalk(); afterWalk(); };
  }
  function nextStep() {
    // stop at an unanswered call
    const pending = e.walk.slice(0, shown).findIndex((w, i) => w.call && S0.calls[i] == null);
    if (pending >= 0) { toast('Make your call first'); return; }
    shown = Math.min(e.walk.length, shown + 1); renderWalk();
    const last = $$('#secWalk .walk > *').pop(); if (last) { last.classList.add('pop'); last.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); }
    if (shown >= e.walk.length) afterWalk();
  }
  let revealed = false;
  function afterWalk() { if (revealed) return; revealed = true; renderDocs(); renderQA(); renderTask(); renderFoot(); }

  // documents with version history
  function renderDocs() {
    const sec = $('#secDocs');
    sec.innerHTML = `<h2><span class="n">${mode === 'sim' ? 4 : 3}</span>The work, draft by draft</h2><p class="muted small">Every version, who reviewed it, what they rejected and how the next draft answered it. Tap a highlighted term for its meaning and lesson.</p>
      <div class="doc-tabs">${e.docs.map((d, i) => `<button data-i="${i}" class="${i === 0 ? 'on' : ''}">${esc(d.title)}<small>${esc(d.aud)}</small></button>`).join('')}</div><div id="docBody"></div>`;
    const showDoc = i => {
      $$('.doc-tabs button', sec).forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      const d = e.docs[i]; let v = d.versions.length - 1; let diff = false;
      const draw = () => {
        const ver = d.versions[v]; const prev = d.versions[v - 1];
        $('#docBody').innerHTML = `<div class="vtimeline">${d.versions.map((x, k) => `<button data-v="${k}" class="${k === v ? 'on' : ''} st-${/reject|return|not ready|changes|pushback|rewrite/i.test(x.status) ? 'bad' : /approv|accept|ready|sent|ship|publish|record|keep|order/i.test(x.status) ? 'good' : 'mid'}"><b>${esc(x.v)}</b><span>${esc(x.status)}</span></button>${k < d.versions.length - 1 ? '<i class="arrow">→</i>' : ''}`).join('')}</div>
        <div class="docwrap">
          <article class="docpaper"><div class="docmeta"><span>${esc(ver.by || '')}</span>${prev ? `<label class="difft"><input type="checkbox" id="dt" ${diff ? 'checked' : ''}> Show changes from ${esc(prev.v)}</label>` : ''}</div>
            <div class="docbody prose-s" id="db">${diff && prev ? `<p class="diff">${wordDiff(prev.body, ver.body)}</p>` : md(ver.body)}</div></article>
          <aside class="comments">${ver.note ? `<div class="vnote"><b>Outcome</b><p>${esc(ver.note)}</p></div>` : ''}${(ver.comments || []).map((c, n) => `<div class="cmt-card" data-n="${n + 1}">${avatar(e.cast, c[0])}<div><b>${esc(who(e.cast, c[0]).name)}</b> <span class="cn">${n + 1}</span><q>${esc(c[1])}</q><p>${esc(c[2])}</p></div></div>`).join('') || '<p class="muted small">No comments on this version.</p>'}</aside>
        </div>`;
        $$('.vtimeline button').forEach(b => b.onclick = () => { v = +b.dataset.v; diff = false; draw(); });
        const dt = $('#dt'); if (dt) dt.onchange = () => { diff = dt.checked; draw(); };
        if (!diff && ver.comments) markQuotes($('#db'), ver.comments);
        $$('.cmt-card').forEach(c => { c.onmouseenter = () => { const mk = $(`mark.cmt[data-n="${c.dataset.n}"]`); if (mk) mk.classList.add('hot'); }; c.onmouseleave = () => $$('mark.cmt.hot').forEach(x => x.classList.remove('hot')); c.onclick = () => { const mk = $(`mark.cmt[data-n="${c.dataset.n}"]`); if (mk) mk.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); }; });
      };
      v = 0; draw();
    };
    $$('.doc-tabs button', sec).forEach(b => b.onclick = () => showDoc(+b.dataset.i)); showDoc(0);
  }
  function renderQA() {
    const sec = $('#secQA');
    sec.innerHTML = `<h2><span class="n">${mode === 'sim' ? 5 : 4}</span>Questions you'll get</h2><p class="muted small">Answer in your head or type it, then reveal what a senior would say — and what never to say.</p>
    ${e.qa.map((q, i) => `<div class="qa panel" data-i="${i}"><div class="qa-q">${avatar(e.cast, q.who)}<div><small>${esc(who(e.cast, q.who).name)} · ${esc(who(e.cast, q.who).role)}</small><h3>${esc(q.q)}</h3></div></div>
      <textarea rows="2" placeholder="Your answer (optional)">${esc((S0.qa || {})[i] || '')}</textarea><button class="btn sm">Reveal</button>
      <div class="qa-a" hidden><div class="good"><b>Say</b><p>${esc(q.good)}</p></div><div class="avoid"><b>Don't say</b><p>${esc(q.avoid)}</p></div><p class="small muted"><b>Why:</b> ${esc(q.why)}</p></div></div>`).join('')}`;
    $$('.qa', sec).forEach(card => { const ta = $('textarea', card); ta.oninput = () => { S0.qa = S0.qa || {}; S0.qa[card.dataset.i] = ta.value; persist(); }; $('button.btn', card).onclick = ev => { $('.qa-a', card).hidden = false; ev.target.remove(); }; });
  }
  function runChecks(txt) {
    return (e.task.checks || []).map(([label, re]) => {
      let ok;
      if (re.startsWith('__words:')) { const [a, b] = re.slice(8).split('-').map(Number); const w = words(txt); ok = w >= a && w <= b; label += ` (you: ${w})`; }
      else if (re.startsWith('__sentences:')) { const [a, b] = re.slice(12).split('-').map(Number); const n = (txt.match(/[^.!?]+[.!?]+/g) || []).length; ok = n >= a && n <= b; label += ` (you: ${n})`; }
      else { try { ok = new RegExp(re, 'im').test(txt); } catch (x) { ok = false; } }
      return [label, ok];
    });
  }
  function renderTask() {
    const sec = $('#secTask'); const t = e.task; if (!t) return;
    const n = mode === 'sim' ? 3 : 5;
    sec.innerHTML = `<h2><span class="n">${n}</span>${mode === 'sim' ? 'Do the work' : 'Your turn'}</h2>
      <div class="panel task"><p><b>${esc(t.prompt)}</b></p><label class="lbl" for="tt">${esc(t.label)}</label><textarea id="tt" rows="8">${esc(S0.task || '')}</textarea><p class="muted small" id="twc"></p>
      <div class="row"><button class="btn primary" id="tcheck">${mode === 'sim' && !revealed ? 'Submit and see how the PM did it' : 'Check my work'}</button>${t.wf ? `<a class="btn" href="#/wf/${t.wf}">Use the guided workflow</a>` : ''}<button class="btn" id="tcoach">Ask coach to grade</button></div>
      <div id="tres"></div></div>`;
    const ta = $('#tt'); const wc = () => $('#twc').textContent = words(ta.value) + ' words'; wc();
    ta.oninput = () => { S0.task = ta.value; wc(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (x) {} };
    const showRes = txt => { const res = runChecks(txt); const pass = res.filter(r => r[1]).length;
      $('#tres').innerHTML = `<div class="tchecks"><p><b>${pass} of ${res.length}</b> checks passed${pass === res.length ? ' — now compare with the PM\'s version.' : '.'}</p><ul>${res.map(([l, ok]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${esc(l)}</li>`).join('')}</ul><p class="muted small">These checks test structure and key facts. For judgment and wording, ask the coach to grade it.</p></div>`; return [pass, res.length]; };
    if (S0.taskScore != null && S0.task) showRes(S0.task);
    $('#tcheck').onclick = () => {
      if (words(ta.value) < 5) { toast('Write your answer first'); ta.focus(); return; }
      const [pass, tot] = showRes(ta.value); const first = S0.taskScore == null;
      S0.task = ta.value; S0.taskScore = Math.round(pass / tot * 100);
      if (first) award('ojt-task', p.name + ': ' + e.title, 10 + pass * 3, S0.taskScore, { ep: e.id }); else persist();
      if (mode === 'sim' && !revealed) { shown = e.walk.length; renderWalkSim(true); afterWalk(); setTimeout(() => $('#secDocs').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }), 60); }
    };
    $('#tcoach').onclick = () => coach(`You are grading a practice task from a PM/PO training simulation (fictional company ${p.name}). Grade like a senior ${/PO/.test(p.mentorRole) ? 'product owner' : 'product manager'}: what's strong, the top 3 gaps with severity, and a rewritten senior version.\n\nTASK: ${t.prompt}\n\nCONTEXT: ${e.scene}\n${e.sources.map(s => s.title + ': ' + (s.body || s.lines.map(l => who(e.cast, l[0]).name + ': ' + l[1]).join(' '))).join('\n').slice(0, 2500)}\n\nMY ANSWER:\n${ta.value}`);
  }
  // sim mode: decisions only until submit
  function renderWalkSim(unlocked) {
    const sec = $('#secWalk');
    if (!unlocked) {
      sec.innerHTML = `<h2><span class="n">2</span>Your decisions</h2><p class="muted small">Make each call before you write. You'll see the PM's reasoning after you submit.</p><div class="walk">${calls.map(i => callCard(e.walk[i], i).replace(/<div class="why"[\s\S]*?<\/div><\/div>$/, '<div class="why" hidden><b></b></div></div>')).join('')}</div>`;
      $$('.call', sec).forEach(card => { const i = +card.dataset.i; $$('.opts button', card).forEach(b => b.onclick = () => { if (S0.calls[i] != null) return; S0.calls[i] = +b.dataset.k; persist(); $$('.opts button', card).forEach(x => { x.disabled = true; x.classList.toggle('picked', +x.dataset.k === S0.calls[i]); }); card.classList.add('answered'); }); if (S0.calls[i] != null) $$('.opts button', card).forEach(x => { x.disabled = true; x.classList.remove('right', 'wrong'); x.classList.toggle('picked', +x.dataset.k === S0.calls[i]); }); });
    } else { shown = e.walk.length; renderWalk(); }
  }
  function renderFoot() {
    const f = $('#epFoot');
    f.innerHTML = `<div class="panel foot-in"><div><h2>${S0.done ? 'Episode complete' : 'Finished watching?'}</h2><p class="muted small">Try the same stage with another product to see how the thinking transfers.</p></div>
      <div class="row">${S0.done ? '' : '<button class="btn primary" id="epDone">Mark episode complete</button>'}${others.map(o => `<a class="btn" href="#/ojt/${o.id}">${esc(O.products[o.p].name)}: ${esc(o.title)}</a>`).join('')}${epFor(e.s + 1, e.p) ? `<a class="btn" href="#/ojt/${epFor(e.s + 1, e.p).id}">Next stage with ${esc(p.name)} ›</a>` : ''}</div></div>`;
    const d = $('#epDone'); if (d) d.onclick = () => { S0.done = Date.now(); const right = calls.filter(i => S0.calls[i] === e.walk[i].call.a).length; award('ojt', p.name + ': ' + e.title, 40 + right * 5, right + '/' + calls.length, { ep: e.id }); renderFoot(); };
  }

  if (mode === 'watch') {
    shown = 1; renderWalk();
    // returning visitor: show all
    if (S0.done || Object.keys(S0.calls).length >= calls.length && calls.length) { shown = e.walk.length; renderWalk(); afterWalk(); }
  } else {
    renderWalkSim(false); renderTask();
    if (S0.taskScore != null) { revealed = false; shown = e.walk.length; renderWalkSim(true); afterWalk(); }
  }
}

/* ---------- PROGRESS ---------- */
VIEWS.progress = m => {
  const days = []; for (let i = 83; i >= 0; i--) days.push(addDays(today(), -i));
  const max = Math.max(10, ...days.map(d => S.days[d] || 0));
  const counts = t => S.log.filter(l => l.type === t).length;
  const lv = { Junior: 0, Mid: 0, Senior: 0 }; Object.values(S.scen).forEach(a => a.forEach(x => lv[x.lvl]++)); S.gen.forEach(g => lv[g.lvl] = (lv[g.lvl] || 0) + 1);
  const lvT = Math.max(1, lv.Junior + lv.Mid + lv.Senior);
  const genAvg = S.gen.length ? Math.round(S.gen.slice(0, 10).reduce((a, g) => a + g.pts, 0) / Math.min(10, S.gen.length)) : null;
  m.innerHTML = `<header class="page-head"><h1>Progress</h1><p>Signed in as <b>${esc(S.email)}</b>. ${Sync.enabled ? 'Every action is saved here and to your progress sheet.' : 'Saved on this device. Open your PayMeGPT link to sync across devices.'}</p></header>
  <section class="panel">
    <div class="row between"><h2>Last 12 weeks</h2><span class="muted small">${S.xp.toLocaleString()} XP total · ${streak()}-day streak</span></div>
    <div class="heat" role="img" aria-label="Activity heatmap">${days.map(d => `<i title="${d}: ${S.days[d] || 0} XP" style="--a:${(S.days[d] || 0) / max}" class="${S.days[d] ? 'on' : ''} ${d === today() ? 'now' : ''}"></i>`).join('')}</div>
  </section>
  <div class="today-grid">
    <section class="panel stats">
      <div><b>${Object.keys(S.read).length}/${ORDER.length}</b><span>chapters</span></div>
      <div><b>${Object.keys(S.checks).length}/${P.checks.length}</b><span>exercises ticked</span></div>
      <div><b>${Object.values(S.cards).filter(c => c.box >= 4).length}/${P.cards.length}</b><span>cards mastered</span></div>
      <div><b>${S.work.length}</b><span>work pieces</span></div>
      <div><b>${ojtDoneCount()}</b><span>Shadow-a-PM episodes</span></div>
      <div><b>${counts('drills')}</b><span>drill sets</span></div>
      <div><b>${genAvg == null ? '—' : genAvg}</b><span>generator avg (last 10)</span></div>
    </section>
    <section class="panel">
      <h2>Evaluation level</h2><p class="muted small">Across scenarios and generated cases, by rubric estimate.</p>
      <div class="lvbar">${['Junior', 'Mid', 'Senior'].map(k => `<span class="lvl-${k.toLowerCase()}" style="flex:${lv[k] || 0.0001}"><b>${k}</b> ${lv[k]}</span>`).join('')}</div>
      <p class="small">${lv.Senior ? Math.round(lv.Senior / lvT * 100) + '% of attempts at Senior.' : 'No Senior-level attempts yet. Try Scenario 1.'}</p>
    </section>
  </div>
  <section class="panel">
    <h2>Ready-to-apply signals</h2><p class="muted small">All five, consistently, before you apply for the PM/PO role.</p>
    <ul class="checks">${SIGNALS.map(s => `<li><label class="chk"><input type="checkbox" data-k="${s.k}" ${S.checks[s.k] ? 'checked' : ''}><span>${esc(s.t)}</span></label></li>`).join('')}</ul>
  </section>
  <section class="panel">
    <h2>Activity log</h2>
    ${S.log.length ? `<ul class="log">${S.log.slice(0, 40).map(l => `<li><span class="t">${new Date(l.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span class="ty ty-${l.type}">${l.type}</span><span>${esc(l.item)}</span><b>+${l.xp}</b></li>`).join('')}</ul>` : '<p class="empty">Your activity shows up here. Read a chapter or flip a few cards to start.</p>'}
  </section>
  <section class="panel">
    <h2>Your data</h2>
    <div class="row"><label class="lbl inline">Email <input id="em" value="${esc(S.email)}"></label><button class="btn" id="saveEm">Save email</button></div>
    <div class="row"><button class="btn" id="exp">Export backup (.json)</button><label class="btn">Import backup<input type="file" id="imp" accept="application/json" hidden></label><button class="btn" id="startReset">Restart 30-day plan from today</button></div>
    <p class="muted small">30-day plan started ${esc(S.start)}. ${Sync.enabled ? 'Sheet sync: ' + Sync.label() + '.' : ''}</p>
  </section>`;
  $$('input[data-k]', m).forEach(cb => cb.onchange = () => { if (cb.checked) { S.checks[cb.dataset.k] = Date.now(); award('signal', cb.nextElementSibling.textContent.slice(0, 60), 15); } else { delete S.checks[cb.dataset.k]; persist(); } });
  $('#saveEm').onclick = () => { const e = $('#em').value.trim(); if (!/@/.test(e)) { toast('Enter a valid email'); return; } S.email = e; persist(); toast('Email saved'); };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })); a.download = 'pm-university-backup-' + today() + '.json'; a.click(); };
  $('#imp').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { S = Object.assign(blank(), JSON.parse(t)); persist(); route(); updateChrome(); toast('Backup imported'); } catch (x) { toast('That file is not a PM University backup'); } }); };
  $('#startReset').onclick = () => { if (confirm('Restart the 30-day plan from today? Your progress stays.')) { S.start = today(); persist(); toast('Plan restarted: Day 1'); } };
};

/* ---------- boot ---------- */
function boot() {
  shell(); updateChrome(); route();
  if (Sync.enabled) Sync.restore();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
