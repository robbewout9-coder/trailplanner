/* ============ APP: scherm, opslag, acties ============ */
const LS_KEY = 'trailplanner-v1', LS_SET = 'trailplanner-settings', LS_ACTIVE = 'trailplanner-active';
const SET_DEF = { voice:true, voiceURI:'', rate:1, vol:1, cueEvery:'km', verbose:true, tips:true, tooFast:true, fuel:true, runWalk:'auto', bg:false, autoPause:false, hideInstall:false };
const VERSION = '3.1.0';
let TODAY = todayIso();
let S = null, PLAN = null, SET = Object.assign({}, SET_DEF);
let UI = { tab:'vandaag', planTab:'kalender', month:null, openWeek:null, modal:null, toast:null, wipe:false, backup:'' };
let WZ = null;
let RUN = null, LIVE = { timer:null, snapT:0, dim:false, countdown:0 };
let installEvt = null;

const $app = document.getElementById('app'), $layer = document.getElementById('layer'), $live = document.getElementById('live');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- opslag ---------- */
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); return true; } catch(e){ return false; } }
function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }
let persistAsked = false;
function persist(){
  lsSet(LS_KEY, JSON.stringify({ ts: Date.now(), json: JSON.stringify(S) }));
  if (!persistAsked && navigator.storage && navigator.storage.persist){ persistAsked = true; navigator.storage.persist().catch(() => {}); }
}
function recompute(){ PLAN = S ? buildPlan(S) : null; }
function setState(next){ S = next; recompute(); persist(); }
function loadLocal(){
  const raw = lsGet(LS_KEY);
  if (raw){ try { const o = JSON.parse(raw); const st = migrateState(JSON.parse(o.json)); if (st){ S = st; recompute(); } } catch(e){} }
  const rs = lsGet(LS_SET);
  if (rs){ try { SET = Object.assign({}, SET_DEF, JSON.parse(rs)); } catch(e){} }
}
function saveSet(){ lsSet(LS_SET, JSON.stringify(SET)); applyVoiceSettings(); }
function applyVoiceSettings(){ Voice.enabled = !!SET.voice; Voice.rate = SET.rate; Voice.volume = SET.vol; Voice.voiceURI = SET.voiceURI; }

/* routes bewaren in IndexedDB (te groot voor localStorage) */
const TrackDB = {
  db:null,
  open(){
    if (this.db) return Promise.resolve(this.db);
    return new Promise(res => {
      try {
        const rq = indexedDB.open('trailplanner', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('tracks');
        rq.onsuccess = () => { this.db = rq.result; res(this.db); };
        rq.onerror = () => res(null);
      } catch(e){ res(null); }
    });
  },
  async put(id, v){ const db = await this.open(); if (!db) return false; return new Promise(r => { const t = db.transaction('tracks', 'readwrite'); t.objectStore('tracks').put(v, id); t.oncomplete = () => r(true); t.onerror = () => r(false); }); },
  async get(id){ const db = await this.open(); if (!db) return null; return new Promise(r => { const q = db.transaction('tracks').objectStore('tracks').get(id); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); },
  async clear(){ const db = await this.open(); if (!db) return; return new Promise(r => { const t = db.transaction('tracks', 'readwrite'); t.objectStore('tracks').clear(); t.oncomplete = () => r(true); t.onerror = () => r(false); }); },
  async del(id){ const db = await this.open(); if (!db) return; db.transaction('tracks', 'readwrite').objectStore('tracks').delete(id); }
};

/* ---------- iconen en tekentjes ---------- */
const IC = {
  today:'<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plan:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  acts:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  more:'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  play:'<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/>',
  pause:'<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  skip:'<path d="M5 5l9 7-9 7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  vol:'<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute:'<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none"/><path d="M17 9l5 6M22 9l-5 6"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  share:'<path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>',
  addsq:'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevl:'<path d="M15 5l-7 7 7 7"/>', chevr:'<path d="M9 5l7 7-7 7"/>',
  repeat:'<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  mountain:'<path d="M3 20l6-10 4 6 3-4 5 8z"/>',
  pin:'<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  pinoff:'<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" opacity=".45"/><circle cx="12" cy="10" r="2.5" opacity=".45"/><path d="M4 4l16 16"/>',
  mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'
};
const ic = (n, cls) => '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>';

function effortOf(s){
  if (s.k === 'steady') return s.fx === 'long' ? 0.55 : s.fx === 'race' ? 0.62 : 0.48;
  return EFFORT[s.k] != null ? EFFORT[s.k] : 0.4;
}
function colorOf(s){
  if (s.k === 'work' || s.k === 'sprint' || s.k === 'stride') return 'var(--c-hills)';
  if (s.k === 'tempo') return 'var(--c-tempo)';
  if (s.k === 'warm' || s.k === 'cool' || s.k === 'rec' || s.k === 'walk' || s.k === 'rest') return 'rgba(255,255,255,.3)';
  if (s.k === 'ex') return 'var(--c-str)';
  return 'var(--tc)';
}
function profileSvg(steps, cls){
  if (!steps || !steps.length) return '';
  const wt = s => Math.pow(Math.max(s.sec || 0, s.manual ? 45 : 0, 4), 0.55);
  const tot = steps.reduce((a, s) => a + wt(s), 0) || 1, W = 300, H = 60, gap = 1.6;
  let x = 0, out = '';
  steps.forEach((s, i) => {
    const w = Math.max(3.4, wt(s) / tot * W - gap), h = Math.max(7, effortOf(s) * H);
    out += '<rect class="pb" data-i="' + i + '" x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2.5" fill="' + colorOf(s) + '"/>';
    x += w + gap;
  });
  return '<svg class="prof ' + (cls || '') + '" viewBox="0 0 ' + (x - gap).toFixed(1) + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
}
function ridgeSvg(seed){
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([i * 30, 70 - (Math.sin(i * 1.3 + seed) * 18 + Math.sin(i * 0.5 + seed * 2) * 22 + 22)]);
  let d = 'M0 100 L0 ' + pts[0][1].toFixed(1);
  pts.forEach(p => { d += ' L' + p[0] + ' ' + p[1].toFixed(1); });
  d += ' L360 100 Z';
  const pts2 = [];
  for (let i = 0; i <= 12; i++) pts2.push([i * 30, 85 - (Math.sin(i * 0.9 + seed * 3) * 14 + Math.sin(i * 0.4 + seed) * 12 + 10)]);
  let d2 = 'M0 100 L0 ' + pts2[0][1].toFixed(1);
  pts2.forEach(p => { d2 += ' L' + p[0] + ' ' + p[1].toFixed(1); });
  d2 += ' L360 100 Z';
  return '<svg class="ridge" viewBox="0 0 360 100" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="var(--tc)" opacity=".18"/><path d="' + d2 + '" fill="var(--tc)" opacity=".28"/></svg>';
}
function routeSvg(track){
  if (!track || track.length < 3) return '';
  const lats = track.map(p => p[0]), lons = track.map(p => p[1]);
  const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
  const k = Math.cos((la0 + la1) / 2 * Math.PI / 180);
  const w = Math.max((lo1 - lo0) * k, 1e-5), h = Math.max(la1 - la0, 1e-5);
  const W = 320, H = 220, pad = 18, sc = Math.min((W - 2*pad) / w, (H - 2*pad) / h);
  const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
  const P = p => [(ox + (p[1] - lo0) * k * sc).toFixed(1), (oy + (la1 - p[0]) * sc).toFixed(1)];
  const d = track.map((p, i) => (i ? 'L' : 'M') + P(p).join(' ')).join('');
  const a = P(track[0]), b = P(track[track.length - 1]);
  return '<svg class="route" style="aspect-ratio:' + W + '/' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Route"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c6f760"/><stop offset="1" stop-color="#43e3a3"/></linearGradient></defs>' +
    '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="' + d + '" fill="none" stroke="url(#rg)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + a[0] + '" cy="' + a[1] + '" r="6" fill="#fff"/><circle cx="' + b[0] + '" cy="' + b[1] + '" r="6" fill="#ffe27a"/></svg>';
}
function elevSvg(track){
  const pts = (track || []).filter(p => p[2] != null);
  if (pts.length < 6) return '';
  const alts = pts.map(p => p[2]), a0 = Math.min(...alts), a1 = Math.max(...alts), dmax = pts[pts.length - 1][4] || 1;
  const W = 320, H = 80, rng = Math.max(a1 - a0, 20);
  const P = p => [(p[4] / dmax * W).toFixed(1), (H - 6 - (p[2] - a0) / rng * (H - 14)).toFixed(1)];
  const d = pts.map((p, i) => (i ? 'L' : 'M') + P(p).join(' ')).join('');
  return '<svg class="route" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Hoogteprofiel" style="aspect-ratio:' + W + '/' + H + ';background:rgba(0,0,0,.2)"><path d="' + d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z" fill="rgba(63,224,165,.2)"/><path d="' + d + '" fill="none" stroke="#3fe0a5" stroke-width="2.4" stroke-linejoin="round"/><text x="8" y="14" fill="#93ab9f" font-size="10">' + Math.round(a1) + ' m</text><text x="8" y="' + (H - 8) + '" fill="#93ab9f" font-size="10">' + Math.round(a0) + ' m</text></svg>';
}

/* ---------- kleine bouwstenen ---------- */
function toast(msg){
  UI.toast = msg; renderLayer();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { UI.toast = null; renderLayer(); }, 4800);
}
function stat(v, l){ return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>'; }
function statusBadge(s){
  if (s.status === 'done') return '<span class="badge ok">Gedaan ✓' + (s.actual && s.actual.km != null && s.type !== 'strength' ? ' · ' + fmtKm(s.actual.km) : '') + '</span>';
  if (s.status === 'skipped') return '<span class="badge bad">Overgeslagen</span>';
  if (s.moved) return '<span class="badge warn">Verplaatst</span>';
  if (s.date < TODAY) return '<span class="badge warn">Nog bevestigen</span>';
  return '<span class="badge">Gepland</span>';
}
function sessionStats(s){
  const out = [];
  if (s.km) out.push(stat(num1(s.km), 'kilometer'));
  if (s.vert) out.push(stat('↑ ' + s.vert, 'hoogtemeters'));
  if (s.minutes) out.push(stat(fmtMin(s.minutes), 'duur (schatting)'));
  if (s.rpe && s.type !== 'strength') out.push(s.type === 'hills' ? stat('7–8', s.label === 'Intervaltraining' ? 'RPE bij intervallen' : 'RPE op de klim') : stat(s.rpe, 'inspanning (RPE)'));
  if (s.hr) out.push(stat(s.hr[0] + '–' + s.hr[1], 'hartslag (bpm)'));
  return '<div class="stats">' + out.join('') + '</div>';
}
const PHASE = { build:'Opbouw', recovery:'Herstelweek', taper:'Afbouw (taper)', race:'Wedstrijdweek' };
function exList(s){
  if (!s.ex) return '';
  return '<div class="scroll-x"><table><thead><tr><th>Oefening</th><th>Sets × reps</th><th>Rust</th></tr></thead><tbody>' + s.ex.map(e => '<tr><td><b>' + esc(e.n) + '</b>' + (e.note ? '<br><span class="small muted">' + esc(e.note) + '</span>' : '') + '</td><td class="num">' + e.sets + ' × ' + (e.hold ? e.hold + ' sec' : esc(e.reps)) + '</td><td class="num">' + e.rest + ' s</td></tr>').join('') + '</tbody></table></div>';
}
function sessionBody(s){
  const T = TYPES[s.type];
  const blocks = s.blocks.filter(b => b.l !== 'Oefeningen' || !s.ex).map(b => '<div class="blk"><dt>' + esc(b.l) + '</dt><dd>' + esc(b.t) + '</dd></div>').join('');
  const tips = s.tips.map(t => '<p class="tip">' + esc(t) + '</p>').join('');
  return '<div class="t-' + T.color + '"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow" style="color:var(--tc)">' + esc(s.label || T.label) + ' · ' + esc(PHASE[s.kind] || '') + '</div><h2 style="margin-top:6px">' + esc(s.title) + '</h2></div>' + statusBadge(s) + '</div>' +
    profileSvg(s.steps) + sessionStats(s) + exList(s) + '<dl class="blocks" style="margin:14px 0 8px">' + blocks + '</dl>' + tips + '</div>';
}
function sessionRow(s){
  const T = TYPES[s.type];
  const meta = s.type === 'strength' ? fmtMin(s.minutes) : fmtKm(s.km) + (s.vert ? ' · ↑' + s.vert + ' m' : '');
  const mark = s.status === 'done' ? '✓' : s.status === 'skipped' ? '✕' : s.moved ? '↔' : '';
  return '<button class="li t-' + T.color + '" data-act="open" data-id="' + esc(s.id) + '"><span class="bar"></span><span class="grow"><b>' + esc(s.title) + '</b><span class="small muted">' + esc(fmtDate(s.date, {short:true})) + ' · ' + meta + '</span></span>' + (mark ? '<span class="badge ' + (s.status === 'skipped' ? 'bad' : s.status === 'done' ? 'ok' : 'warn') + '">' + mark + '</span>' : ic('chevr')) + '</button>';
}
function findSession(id){ return PLAN ? PLAN.sessions.find(s => s.id === id) : null; }
function daysToRace(){ return S ? diffDays(S.cfg.raceDate, TODAY) : 0; }
function weekKindLabel(k){ return { build:'Opbouw', recovery:'Herstel', taper:'Afbouw', race:'Wedstrijd' }[k] || k; }
function weekKindBadge(k){ return '<span class="badge ' + (k === 'taper' ? 'warn' : k === 'race' ? 'acc' : '') + '">' + weekKindLabel(k) + '</span>'; }
function isStandalone(){ return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
const UA = navigator.userAgent || '';
const ENV = { ios: /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) };
ENV.safari = ENV.ios && /Safari/.test(UA) && !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line|MicroMessenger|GSA/.test(UA);

/* ---------- installatie ---------- */
function qrHtml(url){
  try { const q = qrcode(0, 'M'); q.addData(url); q.make(); return '<div class="qr">' + q.createSvgTag({ cellSize:4, margin:0, scalable:true }) + '</div>'; } catch(e){ return ''; }
}
function installCard(full){
  if (isStandalone()){
    return full ? '<div class="card"><div class="card-h"><h3>Geïnstalleerd</h3><span class="badge ok">✓ op je beginscherm</span></div><p class="muted small">Je gebruikt Trailplanner als app. Je gegevens blijven op dit toestel bewaard, ook zonder internet. Maak af en toe een reservekopie hieronder.</p></div>' : '';
  }
  if (!full && SET.hideInstall) return '';
  const url = location.href.split('#')[0].replace(/index\.html$/, '');
  const shareIc = '<span class="kbd">' + ic('share') + '</span>', addIc = '<span class="kbd">' + ic('addsq') + '</span>';
  let body = '';
  if (ENV.ios){
    body = (!ENV.safari ? '<div class="note warn small"><b>Open deze pagina eerst in Safari.</b><span>Je gebruikt nu een andere app of browser. Kopieer de link en open hem in Safari, of kies via het deelmenu “Open in Safari”.</span></div>' : '') +
      '<ol><li><span>Tik onderin op <b>Delen</b> ' + shareIc + ' (bij nieuwere iOS-versies onder de <b>•••</b>-knop).</span></li><li><span>Scroll en kies <b>Zet op beginscherm</b> ' + addIc + ' (soms onder “Meer”).</span></li><li><span>Tik rechtsboven op <b>Voeg toe</b>. Klaar: open voortaan de app via het icoon.</span></li></ol>' +
      '<p class="small muted" style="margin-top:10px"><b>Belangrijk:</b> doe dit vóór je je schema invult. Safari en de beginschermapp hebben aparte opslag, dus gegevens uit Safari komen niet vanzelf in de app (gebruik anders de reservekopie).</p>';
  } else if (installEvt){
    body = '<p class="muted">Installeer Trailplanner als app: eigen icoon, volledig scherm en werkt ook offline.</p><button class="btn primary" data-act="install" style="margin-top:12px">Installeer app</button>';
  } else {
    const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);
    body = '<p class="muted">Open deze pagina op je iPhone (in Safari) om hem op je beginscherm te zetten.</p>' + (!local && location.protocol === 'https:' ? '<div style="margin-top:12px">' + qrHtml(url) + '<p class="small muted" style="margin-top:8px">Scan met de camera van je iPhone.</p></div>' : '<p class="small muted" style="margin-top:8px">Zet de site eerst online (zie de handleiding), dan verschijnt hier een QR-code.</p>');
  }
  return '<div class="card install"><div class="card-h"><h3>Zet op je beginscherm</h3>' + (full ? '' : '<button class="btn sm ghost" data-act="hide-install">Later</button>') + '</div>' + body + '</div>';
}

/* ---------- wizard ---------- */
const STEP_TITLES = ['Je wedstrijd', 'Jij en je week', 'Je trainingen'];
const WIZ_DEF = { beginner:{ v0:12, lr0:6, runs:3, pace:7.5 }, gevorderd:{ v0:30, lr0:12, runs:4, pace:6 } };
function wzInit(fromCfg){
  const c = fromCfg;
  WZ = { step:0, errs:[], d: c ? {
    name:c.name, distance:c.distance, vert:c.vert, raceDate:c.raceDate, level:c.level, v0:c.v0, lr0:c.lr0,
    availDays:c.availDays.slice(), runsPerWeek:c.runsPerWeek, longDow:c.longDow, strength:c.strength, hills:c.hills, tempo:c.tempo !== false, strengthHome:!!c.strengthHome, pace:c.pace, age:c.age || '', hrmax:c.hrmax || ''
  } : {
    name:'', distance:30, vert:'', raceDate:'2026-12-14', level:'', v0:'', lr0:'',
    availDays:[1,3,5,6], runsPerWeek:'', longDow:5, strength:2, hills:'klimmetjes', tempo:true, strengthHome:false, pace:'', age:'', hrmax:''
  }, redo: !!c };
}
function wzCollect(){
  const g = id => { const e = document.getElementById(id); return e ? e.value : null; };
  const d = WZ.d;
  if (WZ.step === 0){ d.name = g('w-name') ?? d.name; d.distance = g('w-dist') ?? d.distance; d.vert = g('w-vert') ?? d.vert; d.raceDate = g('w-date') ?? d.raceDate; }
  if (WZ.step === 1){ d.v0 = g('w-v0') ?? d.v0; d.lr0 = g('w-lr0') ?? d.lr0; d.runsPerWeek = g('w-runs') ?? d.runsPerWeek; d.longDow = g('w-long') ?? d.longDow; }
  if (WZ.step === 2){ d.strength = g('w-str') ?? d.strength; d.pace = g('w-pace') ?? d.pace; d.age = g('w-age') ?? d.age; d.hrmax = g('w-hrmax') ?? d.hrmax; }
}
function wzValidate(step){
  const d = WZ.d, e = [];
  if (step === 0){
    if (!(Number(d.distance) >= 5)) e.push('Vul de afstand in (minstens 5 km).');
    if (d.vert === '' || isNaN(Number(d.vert)) || Number(d.vert) < 0) e.push('Vul de hoogtemeters in, of tik op een van de schattingen.');
    if (!d.raceDate) e.push('Kies de datum van je wedstrijd.');
    else if (diffDays(d.raceDate, TODAY) < 7) e.push('De wedstrijd moet minstens een week in de toekomst liggen.');
  }
  if (step === 1){
    if (!d.level) e.push('Kies hoe ervaren je bent.');
    if (!(Number(d.v0) > 0)) e.push('Vul in hoeveel kilometer je nu per week loopt.');
    if (!(Number(d.lr0) > 0)) e.push('Vul je langste loop van de afgelopen 4 weken in.');
    if (d.availDays.length < 2) e.push('Kies minstens twee trainingsdagen.');
  }
  return e;
}
function wizardView(){
  const d = WZ.d, st = WZ.step, lvl = LEVELS[d.level];
  const bar = '<div class="steps">' + STEP_TITLES.map((t, i) => '<i class="' + (i <= st ? 'on' : '') + '"></i>').join('') + '</div>';
  let body = '';
  if (st === 0){
    const dist = Number(d.distance) || 30;
    body = '<div class="stack">' +
      '<div class="fld"><label for="w-name">Naam van de wedstrijd (mag leeg)</label><input type="text" id="w-name" value="' + esc(d.name) + '" placeholder="Bijvoorbeeld: Winter Trail"></div>' +
      '<div class="two"><div class="fld"><label for="w-dist">Afstand (km)</label><input type="number" inputmode="decimal" id="w-dist" min="5" max="100" step="0.5" value="' + esc(d.distance) + '"></div>' +
      '<div class="fld"><label for="w-vert">Hoogtemeters omhoog</label><input type="number" inputmode="numeric" id="w-vert" min="0" step="10" value="' + esc(d.vert) + '" placeholder="bijv. 1200"></div></div>' +
      '<div class="fld"><span class="hint">Weet je het niet? Tik op een schatting:</span>' +
      '<div class="chips">' + [['Heuvelachtig',25],['Veel',40],['Bergachtig',60]].map(a => '<button class="pchip" data-act="wiz-vert" data-v="' + (Math.round(dist*a[1]/50)*50) + '">' + a[0] + ' · ' + (Math.round(dist*a[1]/50)*50) + ' m</button>').join('') + '</div></div>' +
      '<div class="fld"><label for="w-date">Datum van de wedstrijd</label><input type="date" id="w-date" value="' + esc(d.raceDate) + '" min="' + addDays(TODAY, 7) + '"></div></div>';
  }
  if (st === 1){
    const maxR = lvl ? lvl.maxRuns : 5;
    const ro = []; for (let i = 2; i <= maxR; i++) ro.push('<option value="' + i + '"' + (Number(d.runsPerWeek) === i ? ' selected' : '') + '>' + i + ' keer per week</option>');
    body = '<div class="stack"><div class="lab">Hoe ervaren ben je?</div><div class="opts">' +
      '<button class="opt" data-act="wiz-level" data-v="beginner" aria-pressed="' + (d.level === 'beginner') + '"><b>Beginner</b><span>Ik loop net of kort. 5 tot 8 km rustig lukt.</span></button>' +
      '<button class="opt" data-act="wiz-level" data-v="gevorderd" aria-pressed="' + (d.level === 'gevorderd') + '"><b>Gevorderd</b><span>Ik loop al regelmatig en 10 km of meer is geen probleem.</span></button></div>' +
      (d.level ? '<div class="two"><div class="fld"><label for="w-v0">Kilometers per week nu</label><input type="number" inputmode="decimal" id="w-v0" min="0" step="1" value="' + esc(d.v0) + '"></div>' +
      '<div class="fld"><label for="w-lr0">Langste loop (km)</label><input type="number" inputmode="decimal" id="w-lr0" min="0" step="0.5" value="' + esc(d.lr0) + '"></div></div>' +
      '<p class="small muted">Dit is een voorbeeld. Pas het aan op wat je echt doet. Eerlijk invullen voorkomt blessures.</p>' : '') +
      '<div class="fld"><span class="lab">Op welke dagen kun je trainen?</span><div class="days">' +
      WD.map((w, i) => '<button class="dpill" data-act="wiz-day" data-v="' + i + '" aria-pressed="' + d.availDays.includes(i) + '">' + w + '</button>').join('') + '</div>' +
      '<span class="hint">Kies minstens 2 dagen. Een rustdag tussen twee trainingen is ideaal.</span></div>' +
      '<details><summary>Meer opties</summary><div class="two"><div class="fld"><label for="w-runs">Aantal looptrainingen</label><select id="w-runs">' + ro.join('') + '</select></div>' +
      '<div class="fld"><label for="w-long">Dag van de lange duurloop</label><select id="w-long">' + d.availDays.map(i => '<option value="' + i + '"' + (Number(d.longDow) === i ? ' selected' : '') + '>' + WD_LANG[i] + '</option>').join('') + '</select></div></div></details></div>';
  }
  if (st === 2){
    body = '<div class="stack"><div class="lab">Waar kun je bergop trainen?</div><div class="opts">' +
      [['heuvels','Heuvels of bergen','Elke week echte klimmen.'],['klimmetjes','Een paar klimmetjes','Viaduct, dijk of korte helling.'],['vlak','Trap of loopband','Met helling of trappen.'],['geen','Niets hiervan','Dan doe ik intervallen op vlak terrein.']].map(a => '<button class="opt" data-act="wiz-hills" data-v="' + a[0] + '" aria-pressed="' + (d.hills === a[0]) + '"><b>' + a[1] + '</b><span>' + a[2] + '</span></button>').join('') + '</div>' +
      (d.level === 'gevorderd' ? '<div class="sw"><div class="t"><b>Tempoloop erbij</b><span>Eén pittige loop van 15 tot 30 minuten per week.</span></div><button class="tgl" role="switch" aria-checked="' + (d.tempo !== false) + '" aria-label="Tempoloop" data-act="wiz-tempo"></button></div>' : '') +
      '<div class="fld"><label for="w-str">Krachttraining per week</label><select id="w-str">' + [0,1,2].map(i => '<option value="' + i + '"' + (Number(d.strength) === i ? ' selected' : '') + '>' + (i === 0 ? 'Geen' : i + ' keer (30–40 min)') + '</option>').join('') + '</select></div>' +
      (Number(d.strength) > 0 ? '<div class="sw"><div class="t"><b>Thuis, zonder materiaal</b><span>Alleen je lichaam, een stoel en een trap.</span></div><button class="tgl" role="switch" aria-checked="' + !!d.strengthHome + '" aria-label="Thuis trainen" data-act="wiz-home"></button></div>' : '') +
      '<p class="small muted">Je kunt dit later altijd aanpassen onder Meer, of per training via Aanpassen.</p>' +
      '<details><summary>Extra (mag leeg)</summary><div class="stack" style="padding-top:4px"><div class="two"><div class="fld"><label for="w-pace">Tempo rustig lopen (min/km)</label><input type="number" inputmode="decimal" id="w-pace" min="4" max="12" step="0.25" value="' + esc(d.pace || (lvl ? lvl.pace : '')) + '"></div>' +
      '<div class="fld"><label for="w-age">Leeftijd</label><input type="number" inputmode="numeric" id="w-age" min="14" max="90" value="' + esc(d.age) + '"></div></div>' +
      '<div class="fld"><label for="w-hrmax">Gemeten maximale hartslag</label><input type="number" inputmode="numeric" id="w-hrmax" min="120" max="220" value="' + esc(d.hrmax) + '" placeholder="bijv. 188"><span class="hint">Alleen voor hartslagzones. Leeftijd of dit getal is genoeg.</span></div></div></details></div>';
  }
  const errs = WZ.errs.length ? '<div class="note bad">' + WZ.errs.map(e => '<span class="err">' + esc(e) + '</span>').join('') + '</div>' : '';
  const last = st === STEP_TITLES.length - 1;
  return '<div class="card"><div class="card-h"><h2>' + (WZ.redo ? 'Schema opnieuw opstellen' : STEP_TITLES[st]) + '</h2><span class="muted small">Stap ' + (st+1) + ' van ' + STEP_TITLES.length + '</span></div>' + bar + body + errs +
    '<div class="row" style="justify-content:space-between;margin-top:20px"><span>' + (st > 0 ? '<button class="btn" data-act="wiz-back">Terug</button>' : (WZ.redo ? '<button class="btn" data-act="wiz-cancel">Annuleren</button>' : '')) + '</span><button class="btn primary" data-act="' + (last ? 'wiz-finish' : 'wiz-next') + '">' + (last ? 'Maak mijn schema' : 'Volgende') + '</button></div></div>';
}

/* ---------- weergaven ---------- */
function headerHtml(){
  let cd = '', sub = 'Schema op maat voor jouw trailwedstrijd';
  if (S){
    const n = daysToRace();
    cd = n > 0 ? '<b>' + n + '</b><span>dagen tot<br>de start</span>' : n === 0 ? '<b>Vandaag</b><span>is het zover</span>' : '<b>Klaar</b><span>wedstrijd<br>voorbij</span>';
    sub = (S.cfg.name ? esc(S.cfg.name) + ' · ' : '') + S.cfg.distance + ' km · ↑ ' + S.cfg.vert + ' m';
  }
  return '<header class="top"><div class="brand"><div class="logo">' + ic('mountain') + '</div><div style="min-width:0"><b>Trailplanner</b><small>' + sub + '</small></div></div>' + (cd ? '<div class="cd">' + cd + '</div>' : '') + '</header>';
}
function navHtml(){
  if (!S || WZ) return '';
  const t = [['vandaag','Vandaag','today'],['plan','Plan','plan'],['acts','Logboek','acts'],['meer','Meer','more']];
  return '<nav class="nav" aria-label="Hoofdmenu"><div class="nav-in" role="tablist">' + t.map(x => '<button role="tab" data-act="tab" data-v="' + x[0] + '" aria-selected="' + (UI.tab === x[0]) + '">' + ic(x[2]) + x[1] + '</button>').join('') + '</div></nav>';
}
function actionRow(s){
  const id = esc(s.id);
  if (s.status === 'planned'){
    const can = s.date <= TODAY;
    return '<div class="stack" style="margin-top:14px">' + (can ? '<button class="btn primary xl" data-act="prestart" data-id="' + id + '">' + ic('play') + (s.type === 'strength' ? 'Start krachttraining' : 'Start training') + '</button>' : '') +
      '<div class="row"><button class="btn sm" data-act="open" data-id="' + id + '">Bekijk</button><button class="btn sm" data-act="adjust" data-id="' + id + '">Aanpassen</button></div></div>';
  }
  return '<div class="row" style="margin-top:14px"><button class="btn sm" data-act="open" data-id="' + id + '">Bekijk</button></div>';
}
function heroHtml(s, label){
  const T = TYPES[s.type], seed = (s.date.charCodeAt(9) + s.date.charCodeAt(8)) % 7;
  return '<section class="hero t-' + T.color + '">' + ridgeSvg(seed) + '<div class="eyebrow">' + esc(label) + ' · ' + esc(fmtDate(s.date)) + '</div><h2>' + esc(s.title) + '</h2>' +
    '<div class="meta"><span class="pill"><i class="dot"></i>' + esc(s.label || T.label) + '</span>' + (PHASE[s.kind] ? '<span class="pill">' + PHASE[s.kind] + '</span>' : '') + statusBadge(s) + '</div>' +
    profileSvg(s.steps) + sessionStats(s) + actionRow(s) + '</section>';
}
function weekStripHtml(){
  const mon = mondayOf(TODAY), wk = PLAN.weeks.find(w => w.monday === mon);
  const days = [];
  for (let i = 0; i < 7; i++){
    const d = addDays(mon, i), ss = PLAN.sessions.filter(s => s.date === d);
    const main = ss.find(s => s.type !== 'strength') || ss[0];
    const cls = main ? 't-' + TYPES[main.type].color + ' has' + (main.status === 'done' ? ' done' : '') + (main.status === 'skipped' ? ' skip' : '') : '';
    days.push('<button class="wd ' + cls + (d === TODAY ? ' today' : '') + '"' + (main ? ' data-act="open" data-id="' + esc(main.id) + '"' : ' disabled') + '>' + WD[i] + '<i>' + (main && main.status === 'done' ? '✓' : (main ? TYPES[main.type].code : Number(d.slice(8)))) + '</i></button>');
  }
  const pct = wk && wk.km ? Math.min(100, Math.round(wk.doneKm / wk.km * 100)) : 0;
  return '<div class="card"><div class="card-h"><h3>Deze week</h3>' + (wk ? weekKindBadge(wk.kind) : '') + '</div><div class="wstrip">' + days.join('') + '</div>' +
    (wk ? '<div class="row" style="margin-top:14px;gap:16px;flex-wrap:nowrap"><div class="ring" style="--p:' + pct + '"><div><div><b>' + pct + '%</b><span>gedaan</span></div></div></div><div class="stack" style="gap:4px"><div><b class="num">' + num1(wk.doneKm) + '</b> <span class="muted">van ' + fmtKm(wk.km) + '</span></div><div class="small muted">↑ ' + wk.vert + ' m · ' + fmtMin(wk.min) + ' gepland</div>' + (wk.load ? '<div class="small muted">Belasting (RPE × min): <b class="num">' + Math.round(wk.load) + '</b></div>' : '') + '</div></div>' : '') + '</div>';
}
function vandaagView(){
  const an = analyse(S, PLAN, TODAY);
  let h = installCard(false);
  if (daysToRace() < 0) h += '<div class="note ok"><b>De wedstrijd is voorbij. Goed gedaan!</b><span>Neem een à twee weken rustig herstel. Wandelen, fietsen en zwemmen mogen wel.</span></div>';
  if (an.trigger){
    h += '<div class="note warn"><b>Je loopt achter op je schema</b><span>Zal ik je schema vanaf morgen rustig opnieuw opbouwen? Dan hoef je niets in te halen.</span>' +
      (an.pending.length ? '<span class="small">Heb je trainingen gedaan maar niet afgevinkt? Bevestig die eerst hieronder.</span>' : '') +
      '<div class="row"><button class="btn primary" data-act="rebase-now">Ja, schema bijwerken</button></div><span class="small muted">' + esc(an.reasons.join(', ')) + '.</span></div>';
  }
  const todays = PLAN.sessions.filter(s => s.date === TODAY);
  if (todays.length) todays.forEach(s => { h += heroHtml(s, 'Vandaag'); });
  else if (daysToRace() >= 0){
    const nx = PLAN.sessions.find(s => s.date > TODAY && s.status === 'planned');
    h += '<section class="card"><div class="eyebrow">Vandaag</div><h2 style="margin:8px 0">Rustdag</h2><p class="muted">Rust hoort bij trainen: dan word je sterker.</p></section>';
    if (nx) h += heroHtml(nx, diffDays(nx.date, TODAY) === 1 ? 'Morgen' : 'Volgende training');
  }
  if (an.pending.length) h += '<div class="card"><div class="card-h"><h3>Nog te bevestigen</h3><span class="badge warn">' + an.pending.length + '</span></div><p class="small muted" style="margin-bottom:6px">Tik op een training en kies: gedaan of lukte niet.</p><div class="list">' + an.pending.slice(-4).map(sessionRow).join('') + '</div></div>';
  h += weekStripHtml();
  const li = loadInsight(PLAN, TODAY);
  if (li.notes.length) h += '<div class="note warn"><b>Tip van je coach</b>' + li.notes.map(n => '<span>' + esc(n) + '</span>').join('') + '</div>';
  return h;
}

function shiftMonth(ym, n){ const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return dateToIso(d).slice(0, 7); }
const SHORT = { long:'lang', hills:'heuvel', tempo:'tempo', easy:'rustig', shakeout:'activatie', strength:'kracht', race:'race' };
function kalenderView(){
  const firstM = S.cfg.startDate.slice(0, 7), lastM = S.cfg.raceDate.slice(0, 7);
  if (!UI.month) UI.month = TODAY.slice(0, 7) < firstM ? firstM : TODAY.slice(0, 7) > lastM ? lastM : TODAY.slice(0, 7);
  const ym = UI.month, [y, m] = ym.split('-').map(Number);
  const start = ym + '-01', endM = shiftMonth(ym, 1) + '-01';
  const byDate = {};
  PLAN.sessions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  let cells = WD.map(w => '<div class="wh">' + w + '</div>').join('');
  for (let d = mondayOf(start); d < endM; d = addDays(d, 1)){
    const inM = d.slice(0, 7) === ym, ss = byDate[d] || [];
    const chips = ss.map(s => {
      const T = TYPES[s.type], mark = s.status === 'done' ? '✓' : s.status === 'skipped' ? '✕' : s.moved ? '↔' : '';
      const km = s.km ? ' ' + String(Math.round(s.km * 10) / 10).replace('.', ',') : '';
      return '<span class="chip t-' + T.color + ' ' + s.status + '" role="button" tabindex="0" data-act="open" data-id="' + esc(s.id) + '">' + (mark ? '<span>' + mark + '</span>' : '') + T.code + km + '<span class="lab">&nbsp;' + SHORT[s.type] + '</span></span>';
    }).join('');
    cells += '<div class="day' + (inM ? '' : ' out') + (d === TODAY ? ' today' : '') + (d === S.cfg.raceDate ? ' race' : '') + '"><span class="n">' + Number(d.slice(8)) + '</span>' + chips + '</div>';
  }
  const leg = [['long','Lange duurloop'],['hills','Heuvels'],['tempo','Tempo'],['easy','Rustig / activatie'],['str','Kracht'],['race','Wedstrijd']].map(a => '<span class="t-' + a[0] + '"><i class="dot"></i>' + a[1] + '</span>').join('');
  return '<div class="card"><div class="cal-head"><button class="iconbtn" data-act="cal-prev"' + (ym <= firstM ? ' disabled' : '') + ' aria-label="Vorige maand">' + ic('chevl') + '</button><h2>' + MAANDEN[m-1] + ' ' + y + '</h2><button class="iconbtn" data-act="cal-next"' + (ym >= lastM ? ' disabled' : '') + ' aria-label="Volgende maand">' + ic('chevr') + '</button></div><div class="cal">' + cells + '</div>' +
    '<div class="legend">' + leg + '<span>✓ gedaan</span><span>✕ overgeslagen</span><span>↔ verplaatst</span></div><p class="small muted" style="margin-top:10px">Tik op een training voor details, afvinken, verplaatsen of overslaan.</p></div>';
}
function wekenView(){
  const wks = PLAN.weeks.filter(w => w.km > 0 || w.kind !== 'race');
  const max = Math.max.apply(null, wks.map(w => w.km).concat([1]));
  const cur = mondayOf(TODAY);
  const bars = wks.map((w, i) => '<div class="bar k-' + w.kind + (w.monday === cur ? ' cur' : '') + '"><em>' + Math.round(w.km) + '</em><i style="height:' + Math.max(4, Math.round(w.km / max * 100)) + 'px"></i><em>W' + (i+1) + '</em></div>').join('');
  const open = UI.openWeek || (PLAN.weeks.find(w => w.monday === cur) || {}).monday;
  const list = PLAN.weeks.map(w => {
    const n = wks.indexOf(w) + 1, isOpen = open === w.monday, pct = w.km ? Math.min(100, Math.round(w.doneKm / w.km * 100)) : 0;
    const hs = w.min > 0 ? Math.round(w.hardMin / w.min * 100) : 0;
    return '<div class="wk"><button class="wk-h" data-act="week" data-v="' + w.monday + '" aria-expanded="' + isOpen + '"><span class="row"><b style="font:800 20px var(--f-disp);text-transform:uppercase">' + (w.kind === 'race' && !w.km ? 'Wedstrijdweek' : 'Week ' + n) + '</b><span class="small muted">' + esc(fmtDate(w.monday, {noDay:true, short:true})) + ' – ' + esc(fmtDate(addDays(w.monday, 6), {noDay:true, short:true})) + '</span>' + weekKindBadge(w.kind) + '</span><span class="row small muted"><span>' + fmtKm(w.km) + '</span><span>↑ ' + w.vert + ' m</span></span></button>' +
      (isOpen ? '<div class="row small muted" style="margin:10px 0"><div class="meter"><i style="width:' + pct + '%"></i></div><span>' + fmtKm(w.doneKm) + ' van ' + fmtKm(w.km) + '</span></div>' + (w.min ? '<p class="small muted" style="margin-bottom:6px">Intensief (heuvels, tempo): ongeveer ' + hs + '% van de tijd. Richtlijn: maximaal ~20%.</p>' : '') + '<div class="list">' + w.sessions.map(sessionRow).join('') + '</div>' : '') + '</div>';
  }).join('');
  return '<div class="card"><div class="card-h"><h2>Kilometers per week</h2></div><div class="bars">' + bars + '</div>' +
    '<div class="legend"><span><i class="dot" style="background:var(--accent2)"></i>Opbouw</span><span><i class="dot" style="background:var(--c-easy)"></i>Herstelweek</span><span><i class="dot" style="background:var(--c-hills)"></i>Afbouw</span><span><i class="dot" style="background:var(--c-race)"></i>Wedstrijd</span></div></div><div class="card">' + list + '</div>';
}
function planView(){
  return '<div class="seg" role="tablist"><button role="tab" data-act="plantab" data-v="kalender" aria-selected="' + (UI.planTab === 'kalender') + '">Kalender</button><button role="tab" data-act="plantab" data-v="weken" aria-selected="' + (UI.planTab === 'weken') + '">Weken</button></div>' + (UI.planTab === 'weken' ? wekenView() : kalenderView());
}
function actsView(){
  const acts = (S.acts || []).slice().sort((a, b) => b.ts - a.ts);
  const head = '<div class="card"><div class="card-h"><h2>Activiteiten</h2></div><p class="muted small" style="margin-bottom:12px">Alles wat je met de live coach hebt getraind. Wil je gewoon lopen zonder schema?</p><button class="btn primary" data-act="prestart" data-id="">' + ic('play') + 'Vrije loop starten</button></div>';
  if (!acts.length) return head + '<div class="note"><b>Nog geen activiteiten</b><span>Start een training vanaf het scherm Vandaag. Daarna zie je hier je route, tempo en hoogtemeters.</span></div>';
  return head + '<div class="card flat"><div class="list">' + acts.map(a => {
    const T = TYPES[a.type] || { color:'easy', label:'Vrije loop' };
    return '<button class="li t-' + T.color + '" data-act="act" data-id="' + esc(a.id) + '"><span class="bar"></span><span class="grow"><b>' + esc(a.title) + '</b><span class="small muted">' + esc(fmtDate(a.at, {short:true})) + ' · ' + (a.dist ? num1(a.dist / 1000) + ' km · ' : '') + fmtClock(a.dur) + (a.ascent ? ' · ↑' + a.ascent + ' m' : '') + (a.rpe ? ' · RPE ' + a.rpe : '') + '</span></span>' + ic('chevr') + '</button>';
  }).join('') + '</div></div>';
}

function switchRow(key, title, sub){
  return '<div class="sw"><div class="t"><b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div><button class="tgl" role="switch" aria-checked="' + !!SET[key] + '" aria-label="' + title + '" data-act="set-toggle" data-v="' + key + '"></button></div>';
}
function meerView(){
  const age = S.cfg.age, hm = hrMax(S.cfg), c = S.cfg;
  const hr = z => hm ? ' (' + Math.round(hm*z.lo) + '–' + Math.round(hm*z.hi) + ' bpm)' : '';
  const nl = Voice.dutch();
  const voiceOpts = nl.length ? '<select id="set-voice" data-act-change="set-voice">' + '<option value="">Automatisch</option>' + nl.map(v => '<option value="' + esc(v.voiceURI) + '"' + (SET.voiceURI === v.voiceURI ? ' selected' : '') + '>' + esc(v.name) + ' (' + esc(v.lang) + ')</option>').join('') + '</select>' : '<div class="note warn small"><span>' + (Voice.ok ? 'Geen Nederlandse stem gevonden. Op iPhone: Instellingen › Toegankelijkheid › Gesproken content › Stemmen › Nederlands, en download een stem.' : 'Spraak wordt in deze browser niet ondersteund.') + '</span></div>';
  const bk = UI.backup ? '<div class="fld" style="margin-top:10px"><label for="bk-copy">Kopieer deze tekst en bewaar hem</label><textarea id="bk-copy" readonly>' + esc(UI.backup) + '</textarea></div>' : '';
  const sel = (k, opts, cur) => '<select data-cfg="' + k + '">' + opts.map(o => '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
  return installCard(true) +
    '<div class="card"><div class="card-h"><h3>Mijn trainingen</h3></div><p class="small muted" style="margin-bottom:10px">Pas je schema aan op wat jij kunt. Het schema verandert direct mee. Een enkele training wisselen kan ook: tik bij een training op Aanpassen.</p>' +
    '<div class="fld" style="margin-bottom:12px"><label>Bergop trainen</label>' + sel('hills', [['heuvels', HILLS_LABEL.heuvels], ['klimmetjes', HILLS_LABEL.klimmetjes], ['vlak', HILLS_LABEL.vlak], ['geen', HILLS_LABEL.geen]], c.hills) + '</div>' +
    (c.level === 'gevorderd' ? '<div class="sw"><div class="t"><b>Tempoloop</b><span>Eén pittige loop per week.</span></div><button class="tgl" role="switch" aria-checked="' + (c.tempo !== false) + '" aria-label="Tempoloop" data-act="cfg-toggle" data-v="tempo"></button></div>' : '') +
    '<div class="two" style="padding-top:8px"><div class="fld"><label>Krachttraining</label>' + sel('strength', [[0, 'Geen'], [1, '1 keer per week'], [2, '2 keer per week']], c.strength) + '</div>' +
    '<div class="fld"><label>Kracht doe ik</label>' + sel('strengthHome', [['false', 'Met gewichten'], ['true', 'Thuis zonder materiaal']], !!c.strengthHome) + '</div></div>' +
    '<div class="row" style="margin-top:14px"><button class="btn" data-act="redo">Alles opnieuw instellen</button></div></div>' +
    '<div class="card"><div class="card-h"><h3>Spraakcoach</h3></div>' +
    switchRow('voice', 'Coach praat tijdens het lopen', 'Via je telefoon of automatisch via je bluetooth-oordopjes.') +
    '<div class="fld" style="padding:10px 0"><label for="set-vol">Volume</label><input type="range" id="set-vol" min="0.3" max="1" step="0.05" value="' + SET.vol + '" data-act-input="set-vol"></div>' +
    '<div class="row"><button class="btn sm" data-act="voice-test">' + ic('vol') + 'Test de stem</button></div>' +
    '<details style="margin-top:10px"><summary>Meer geluidsopties</summary><div>' +
    '<div class="fld" style="padding:6px 0 12px"><label for="set-voice">Stem</label>' + voiceOpts + '</div>' +
    '<div class="fld" style="padding-bottom:12px"><label for="set-rate">Spreeksnelheid</label><input type="range" id="set-rate" min="0.8" max="1.25" step="0.05" value="' + SET.rate + '" data-act-input="set-rate"></div>' +
    '<div class="fld" style="padding:0 0 8px"><label for="set-cue">Tussenstanden</label><select id="set-cue" data-act-change="set-cue">' + [['km','Elke kilometer'],['km2','Elke 2 kilometer'],['off','Alleen intervallen en meldingen']].map(o => '<option value="' + o[0] + '"' + (SET.cueEvery === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
    switchRow('verbose', 'Uitgebreide tussenstand', 'Met gemiddeld tempo en hoogtemeters.') +
    switchRow('tips', 'Looptips', 'Af en toe een korte techniektip.') +
    switchRow('tooFast', 'Waarschuwing “te snel”', 'Op rustige dagen bijsturen.') +
    switchRow('fuel', 'Eet- en drinkherinnering', 'Bij lange duurlopen.') +
    switchRow('autoPause', 'Automatisch pauzeren', 'Pauzeert als je stilstaat. Experimenteel.') +
    switchRow('bg', 'Achtergrondmodus (experimenteel)', 'Houdt de app actief met vergrendeld scherm. Kan je muziekapp pauzeren.') +
    '</div></details></div>' +
    '<div class="card"><div class="card-h"><h3>Privacy en locatie</h3><span class="badge ok">Niets wordt gedeeld</span></div>' +
    '<div class="prose small"><p><b>Wie ziet mijn locatie?</b> Niemand. Je GPS-positie wordt alleen tijdens een training gebruikt, op je telefoon uitgerekend en daar bewaard. Trailplanner stuurt geen locatie, route of training naar internet en heeft geen account, dus er kan niemand live meekijken.</p>' +
    '<p>Alleen de website-host (GitHub) ziet, zoals bij elke website, dat de pagina is geopend. Nooit wat je invult of waar je loopt.</p>' +
    '<p><b>Stoppen:</b> tik tijdens een training op het locatie-icoon bovenin om GPS uit te zetten (de coach telt dan alleen op tijd). Toegang intrekken kan altijd in Instellingen › Privacy en beveiliging › Locatievoorzieningen. Een route verlaat je telefoon alleen als jij zelf op “GPX exporteren” tikt.</p></div>' +
    '<div class="row" style="margin-top:12px"><button class="btn sm danger" data-act="wipe-tracks">Wis alle opgeslagen routes</button></div></div>' +
    schemaInfoHtml() +
    '<div class="card"><div class="card-h"><h3>Uitleg en onderbouwing</h3></div>' + uitleg(hm, age, hr) + '</div>' +
    '<div class="card"><h3 style="margin-bottom:8px">Jouw gegevens</h3><p class="small muted" style="margin-bottom:12px">Alles staat alleen op dit toestel. Maak af en toe een reservekopie.</p><div class="row">' +
    '<button class="btn" data-act="backup">Reservekopie tonen en kopiëren</button><button class="btn" data-act="backup-file">Als bestand bewaren</button>' +
    (UI.wipe ? '<span class="note bad" style="flex-direction:row;align-items:center;gap:10px">Alles wissen?<button class="btn sm danger" data-act="wipe-yes">Ja, wissen</button><button class="btn sm" data-act="wipe-no">Nee</button></span>' : '<button class="btn danger" data-act="wipe">Alles wissen</button>') + '</div>' + bk +
    '<div class="fld" style="margin-top:14px"><label for="bk-in">Reservekopie terugzetten</label><textarea id="bk-in" placeholder="Plak hier je reservekopie"></textarea></div><div class="row" style="margin-top:8px"><button class="btn" data-act="restore">Terugzetten</button></div>' +
    '<p class="tiny dim" style="margin-top:14px">Trailplanner ' + VERSION + '</p></div>';
}
function uitleg(hm, age, hr){
  const zones = HR_ZONES.map(z => '<tr><td><b>' + z.z + '</b></td><td>' + Math.round(z.lo*100) + '–' + Math.round(z.hi*100) + '%' + hr(z) + '</td><td>' + z.rpe + '</td><td>' + z.use + '</td></tr>').join('');
  return '<details open><summary>Zo is je schema opgebouwd</summary><div class="prose"><ul>' +
    '<li><b>Opbouw:</b> het weekvolume (inclusief warming-up en cooldown) stijgt hoogstens ongeveer 10% per belastingsweek. Dat is een veelgebruikte vuistregel; onderzoek laat vooral zien dat grote sprongen (meer dan ~30% in een week) riskant zijn (Nielsen e.a., 2014).</li>' +
    '<li><b>Herstelweek:</b> elke vierde week gaat het volume ongeveer 30% omlaag, zodat je lichaam de training kan verwerken. Zo eindigt de opbouw altijd met drie belastingsweken voor de afbouw.</li>' +
    '<li><b>Afbouw (taper):</b> het volume daalt in de laatste ~2 weken met ongeveer 20–60%, terwijl frequentie en een beetje intensiteit blijven. Dit is de best onderzochte aanpak (Mujika en Padilla, 2003; Bosquet e.a., 2007).</li>' +
    '<li><b>Intensiteitsverdeling:</b> het grootste deel van je tijd is rustig, hooguit ~20% pittig (heuvels en tempo), de “polariserende” aanpak uit duursportonderzoek (Seiler, 2010). Zware dagen liggen nooit aaneengesloten als je agenda dat toelaat.</li>' +
    '<li><b>Lange duurloop:</b> streefwaarde is ongeveer 60% (beginner) of 80% (gevorderd) van de wedstrijdafstand, begrensd op circa 3,5 uur. Je hoeft de volle afstand niet te trainen.</li>' +
    '<li><b>Heuvels:</b> eerst korte heuvelsprints (kracht en pezen, weinig stofwisselingsbelasting), daarna klimintervallen van 1,5 tot 3,5 minuten op RPE 7–8 met even lang herstel. Bij gebrek aan heuvels werken trappen of een loopband op 6–8%.</li>' +
    '<li><b>Kracht:</b> basis (techniek, volume), dan opbouw (zwaarder, minder herhalingen, sprongen), en in de afbouw licht en vlot. Zwaardere krachttraining verbetert de loopeconomie (Blagrove e.a., 2018; Balsalobre-Fernández e.a., 2016). Excentrisch werk bereidt je voor op afdalingen.</li>' +
    '<li><b>Tijdschatting:</b> afstand × jouw tempo plus 1 minuut per 10 hoogtemeters (naar de regel van Naismith). Het blijft een schatting.</li></ul></div></details>' +
    '<details><summary>Inspanning en hartslagzones</summary><div><p class="small muted" style="margin-bottom:8px">RPE is je gevoelde inspanning op een schaal van 1 tot 10 (Borg). Bergop en bij warmte is RPE betrouwbaarder dan hartslag.' + (hm ? ' Je maximale hartslag staat op ' + Math.round(hm) + ' slagen per minuut' + (S.cfg.hrmax ? ' (door jou opgegeven).' : ' (208 − 0,7 × leeftijd, Tanaka e.a., 2001; afwijkingen van ± 10 slagen zijn normaal).') : ' Vul je leeftijd of gemeten maximale hartslag in via “Schema opnieuw opstellen” om bpm-bereiken te zien.') + '</p><div class="scroll-x"><table><thead><tr><th>Zone</th><th>% max. hartslag</th><th>RPE</th><th>Gebruik</th></tr></thead><tbody>' + zones + '</tbody></table></div><p class="small muted" style="margin-top:8px">Zones zijn benaderingen van de ventilatiedrempels (Z1–Z2 onder de eerste, Z4 rond de tweede). Praattempo is de eenvoudigste controle: in Z2 kun je volledige zinnen zeggen.</p></div></details>' +
    '<details><summary>Wat als een training niet lukt?</summary><div class="prose"><ul>' +
    '<li><b>Eén rustige loop gemist:</b> geen aanpassing. Niet inhalen en niet dubbelen.</li>' +
    '<li><b>Sleuteltraining gemist</b> (lange duurloop, heuvels, tempo): verplaats hem binnen drie dagen als er een passende dag is. Lukt dat niet, dan herberekent de app je schema vanaf je laatst gelopen niveau, met ongeveer 10% minder belasting.</li>' +
    '<li><b>Dagen zonder hardlopen:</b> tot 4 dagen verandert er niets. Daarna gaat de belasting omlaag: 5–7 dagen naar 90%, 8–14 dagen naar 80%, 15–21 dagen naar 65% en langer dan 21 dagen naar 50%. Dit zijn vuistregels van deze app, geen wetenschappelijke normen.</li>' +
    '<li><b>Minder dan 75% van de geplande kilometers in twee weken:</b> de belasting gaat evenredig omlaag (minimaal 70%).</li>' +
    '<li><b>Vlak voor de wedstrijd:</b> in de laatste dagen wordt niets ingehaald. De afbouw blijft altijd behouden.</li>' +
    '<li><b>Ziek of geblesseerd:</b> bij koorts of klachten onder de nek (spierpijn, borst, buik) rust je. Bij milde klachten boven de nek is een rustige training meestal prima. Pijn die tijdens het lopen erger wordt: stop. Twijfel je, vraag dan je huisarts of sportarts.</li></ul></div></details>' +
    '<details><summary>Belasting bijhouden (sessie-RPE)</summary><div><p class="small muted">Na elke training vraagt de app hoe zwaar het voelde (1–10). Vermenigvuldigd met de duur geeft dat de trainingsbelasting (Foster e.a., 2001). De app waarschuwt bij een plotselinge stijging van meer dan 30% ten opzichte van vorige week, en als je rustige trainingen vaak zwaar voelen. Dit is een hulpmiddel, geen exacte wetenschap (Impellizzeri e.a., 2020 wijzen op beperkingen van de acute:chronische ratio).</p></div></details>' +
    '<details><summary>Voeding tijdens trainen</summary><div><p class="small muted">Vanaf ongeveer 75–90 minuten helpen 30–60 g koolhydraten per uur; bij meer dan 2,5 uur tot 90 g per uur als je maag dat gewend is (Thomas e.a., 2016). Drink naar dorst. Oefen alles in training, niet voor het eerst op wedstrijddag.</p></div></details>' +
    '<details><summary>Bronnen</summary><div><ul class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">' +
    '<li>Tanaka H, Monahan KD, Seals DR (2001). Age-predicted maximal heart rate revisited. J Am Coll Cardiol 37(1):153–156.</li>' +
    '<li>Seiler S (2010). What is best practice for training intensity and duration distribution in endurance athletes? Int J Sports Physiol Perform 5(3):276–291.</li>' +
    '<li>Mujika I, Padilla S (2003). Scientific bases for precompetition tapering strategies. Med Sci Sports Exerc 35(7):1182–1187.</li>' +
    '<li>Bosquet L e.a. (2007). Effects of tapering on performance: a meta-analysis. Med Sci Sports Exerc 39(8):1358–1365.</li>' +
    '<li>Nielsen RØ e.a. (2014). Excessive progression in weekly running distance and risk of running-related injuries. J Orthop Sports Phys Ther 44(10):739–747.</li>' +
    '<li>Blagrove RC, Howatson G, Hayes PR (2018). Effects of strength training on the physiological determinants of middle- and long-distance running performance. Sports Med 48(5):1117–1149.</li>' +
    '<li>Balsalobre-Fernández C, Santos-Concejero J, Grivas GV (2016). Effects of strength training on running economy in highly trained runners. J Strength Cond Res 30(8):2361–2368.</li>' +
    '<li>Foster C e.a. (2001). A new approach to monitoring exercise training. J Strength Cond Res 15(1):109–115.</li>' +
    '<li>Impellizzeri FM e.a. (2020). Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. Int J Sports Physiol Perform 15(6):907–913.</li>' +
    '<li>Thomas DT, Erdman KA, Burke LM (2016). Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the ACSM: Nutrition and athletic performance. Med Sci Sports Exerc 48(3):543–568.</li>' +
    '<li>Borg G (1982). Psychophysical bases of perceived exertion. Med Sci Sports Exerc 14(5):377–381.</li></ul>' +
    '<p class="small muted" style="margin-top:10px">Dit schema is een algemene richtlijn en geen medisch advies. Heb je gezondheidsklachten, een blessure of twijfel je of je mag trainen? Overleg met je huisarts of sportarts.</p></div></details>';
}

/* ---------- vensters ---------- */
const HILLS_LABEL = { heuvels:'Heuvels of bergen', klimmetjes:'Een paar klimmetjes', vlak:'Trap of loopband', geen:'Geen: intervallen op vlak terrein' };
function schemaInfoHtml(){
  const v = PLAN.verdict, vb = v === 'goed' ? '<span class="badge ok">Goed haalbaar</span>' : v === 'strak' ? '<span class="badge warn">Haalbaar, maar strak</span>' : '<span class="badge bad">Zeer ambitieus</span>';
  const adv = intakeAdvice(S.cfg, PLAN, TODAY);
  const hist = S.history.slice(-4).reverse();
  return '<div class="card"><div class="card-h"><h3>Over je schema</h3>' + vb + '</div>' +
    '<div class="stats" style="margin-bottom:10px">' + stat(num1(PLAN.peakLR), 'langste duurloop (km)') + stat(num1(PLAN.lrIdeal), 'ideaal (km)') + stat(Math.round(PLAN.peakWeek.km || 0), 'piekweek (km)') + '</div>' +
    '<div class="prose">' + adv.map(t => '<p>' + esc(t) + '</p>').join('') + '</div>' +
    '<details style="margin-top:8px"><summary>Wijzigingen in je schema</summary><div class="stack small">' + hist.map(e => '<div><span class="muted">' + esc(fmtDate(e.at, {short:true})) + '</span> · ' + esc(e.text) + '</div>').join('') + (S.rebases.length ? '<button class="btn sm" data-act="undo-rebase">Laatste herberekening ongedaan maken</button>' : '') + '</div></details></div>';
}
function modalHtml(){
  const m = UI.modal;
  if (!m) return '';
  if (m.type === 'prestart') return prestartHtml(m);
  if (m.type === 'summary') return summaryHtml(m);
  if (m.type === 'resume') return resumeHtml(m);
  if (m.type === 'act') return actHtml(m);
  if (m.type === 'stopq') return stopqHtml();
  const s = findSession(m.id);
  if (!s) return '';
  const mode = m.mode, id = esc(s.id);
  let act = '', body = sessionBody(s);
  if (s.status === 'planned'){
    if (mode === 'done'){
      act = '<div class="stack"><div class="two">' + (s.type !== 'strength' ? '<div class="fld"><label for="d-km">Gelopen afstand (km)</label><input type="number" inputmode="decimal" id="d-km" step="0.1" min="0" value="' + s.km + '"></div>' : '') + '<div class="fld"><label for="d-note">Notitie (mag leeg)</label><input type="text" id="d-note" placeholder="Hoe voelde het?"></div></div><div class="fld"><label>Hoe zwaar voelde het? (1 licht, 10 maximaal)</label><div class="rpe" id="d-rpe">' + [1,2,3,4,5,6,7,8,9,10].map(n => '<button data-act="d-rpe" data-v="' + n + '" aria-pressed="' + (m.rpe === n) + '">' + n + '</button>').join('') + '</div></div><div class="row"><button class="btn primary" data-act="done-save" data-id="' + id + '">Opslaan als gedaan</button><button class="btn" data-act="adjust" data-id="' + id + '">Terug</button></div></div>';
    } else if (mode === 'skip'){
      const reason = m.reason || 'tijd';
      const ill = reason === 'ziek' ? '<div class="note warn small">Bij koorts of klachten onder de nek (spierpijn, borst, buik) rust je. Bij milde klachten boven de nek is een rustige training meestal prima. Pijn die erger wordt tijdens het lopen: stop en overleg met je huisarts of sportarts.</div>' : '';
      act = '<div class="stack"><div class="fld"><label for="sk-reason">Wat is er aan de hand?</label><select id="sk-reason"><option value="tijd"' + (reason === 'tijd' ? ' selected' : '') + '>Geen tijd of andere verplichting</option><option value="ziek"' + (reason === 'ziek' ? ' selected' : '') + '>Ziek of geblesseerd</option><option value="weer"' + (reason === 'weer' ? ' selected' : '') + '>Weer of andere reden</option></select></div>' + ill +
        '<p class="small muted">' + (KEY_TYPES.includes(s.type) ? 'Dit is een belangrijke training: bij overslaan past de app je schema aan.' : 'Eén gemiste rustige training heeft geen effect. Je hoeft niet in te halen.') + '</p><div class="row"><button class="btn primary" data-act="skip-confirm" data-id="' + id + '">Overslaan</button><button class="btn" data-act="adjust" data-id="' + id + '">Terug</button></div></div>';
    } else if (mode === 'adjust'){
      const opts = swapOptions(s, S.cfg), mv = moveOptions(PLAN, s, TODAY, S.cfg.raceDate);
      act = '<div class="stack"><h3>Wat wil je veranderen?</h3>' +
        (opts.length ? '<div class="stack" style="gap:8px"><span class="lab">Andere training doen</span>' + opts.map(o => '<button class="opt" data-act="swap" data-id="' + id + '" data-v="' + o.id + '"><b>' + esc(o.label) + '</b>' + (o.hint ? '<span>' + esc(o.hint) + '</span>' : '') + '</button>').join('') + '</div>' : '') +
        (mv.length ? '<div class="fld"><span class="lab">Op een andere dag</span><div class="chips">' + mv.map(o => '<button class="pchip" data-act="move" data-id="' + id + '" data-v="' + o.date + '">' + esc(fmtDate(o.date, {short:true})) + (o.warn ? ' (dicht bij een zware training)' : '') + '</button>').join('') + '</div></div>' : '') +
        '<div class="row"><button class="btn" data-act="open-done" data-id="' + id + '">Ik heb hem al gedaan</button><button class="btn" data-act="open-skip" data-id="' + id + '">Lukt niet</button></div><button class="btn ghost" data-act="open" data-id="' + id + '">Terug</button></div>';
      body = '<div><div class="eyebrow">Aanpassen</div><h2 style="margin-top:6px">' + esc(s.title) + '</h2></div>';
    } else {
      act = '<div class="stack">' + (s.date <= TODAY ? '<button class="btn primary xl" data-act="prestart" data-id="' + id + '">' + ic('play') + 'Start training</button>' : '') + '<button class="btn" data-act="adjust" data-id="' + id + '">Aanpassen</button></div>';
    }
  } else {
    act = '<div class="row"><button class="btn" data-act="reset" data-id="' + id + '">Terugzetten naar gepland</button>' + (s.moved ? '<button class="btn" data-act="unmove" data-id="' + id + '">Terug naar oorspronkelijke dag</button>' : '') + (s.actual && s.actual.act ? '<button class="btn" data-act="act" data-id="' + esc(s.actual.act) + '">Bekijk activiteit</button>' : '') + '</div>' +
      (s.actual && (s.actual.note || s.actual.rpe) ? '<p class="small muted">' + (s.actual.rpe ? 'RPE ' + s.actual.rpe + '. ' : '') + (s.actual.note ? 'Notitie: ' + esc(s.actual.note) : '') + '</p>' : '');
  }
  if (s.status === 'planned' && s.moved && mode === 'view') act += '<p class="small muted">Verplaatst van ' + esc(fmtDate(s.origDate, {short:true})) + '. <button class="btn sm" data-act="unmove" data-id="' + id + '">Terugzetten</button></p>';
  return '<div class="overlay" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(s.title) + '"><div class="sheet-h"><span class="small muted">' + esc(fmtDate(s.date)) + '</span><button class="x" data-act="close" aria-label="Sluiten">×</button></div>' + body + act + '</div></div>';
}
function renderLayer(){
  $layer.innerHTML = modalHtml() + (UI.toast ? '<div class="toast" role="status">' + esc(UI.toast) + '</div>' : '');
}
function render(){
  let main;
  if (!S || WZ){
    if (!WZ) wzInit();
    main = (!S ? '<div class="note"><b>Welkom</b><span>Beantwoord vier korte vragen. Je krijgt een schema per dag met een kalender dat zich aanpast als een training niet lukt, en een live coach die tijdens het lopen tegen je praat.</span></div>' + installCard(false) : '') + wizardView();
  } else {
    main = UI.tab === 'plan' ? planView() : UI.tab === 'acts' ? actsView() : UI.tab === 'meer' ? meerView() : vandaagView();
  }
  $app.innerHTML = '<div class="app">' + headerHtml() + '<main' + (UI.enter ? ' class="enter"' : '') + '>' + main + '</main></div>' + navHtml();
  UI.enter = false;
  renderLayer();
}

/* ---------- vooraf: controle en start ---------- */
function runWalkDefault(s){
  if (SET.runWalk === 'on') return true;
  if (SET.runWalk === 'off') return false;
  return !!(S && S.cfg.level === 'beginner' && s && (s.type === 'easy' || s.type === 'long'));
}
function prestartHtml(m){
  const s = m.id ? findSession(m.id) : null;
  const title = s ? s.title : 'Vrije loop', isStr = s && s.type === 'strength';
  const g = m.gps;
  const gpsTxt = m.noGps ? 'Uit: ik tel alleen op tijd' : g === 'ok' ? 'Gevonden (± ' + m.acc + ' m)' : g === 'wait' ? 'Zoeken…' : g === 'denied' ? 'Geen toegang. Zet locatie aan in Instellingen › Privacy › Locatievoorzieningen.' : g === 'unavailable' ? 'Nog geen signaal. Je kunt gewoon starten, het signaal komt vanzelf.' : 'Wordt gecontroleerd…';
  const gpsLine = isStr ? '' : '<div class="sw"><div class="t"><b>GPS</b><span>' + gpsTxt + '</span></div><button class="tgl" role="switch" aria-checked="' + !m.noGps + '" aria-label="GPS gebruiken" data-act="pre-nogps"></button></div>';
  const rw = ((s && (s.type === 'easy' || s.type === 'long')) || !s) ? '<div class="sw"><div class="t"><b>Loop-wandelintervallen</b><span>5 minuten lopen, 1 minuut wandelen.</span></div><button class="tgl" role="switch" aria-checked="' + !!m.runWalk + '" aria-label="Loop-wandelen" data-act="pre-rw"></button></div>' : '';
  return '<div class="overlay" data-act="close-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="Start training"><div class="sheet-h"><div><div class="eyebrow">Klaar voor de start</div><h2 style="margin-top:6px">' + esc(title) + '</h2></div><button class="x" data-act="close" aria-label="Sluiten">×</button></div>' +
    (s && s.steps ? profileSvg(s.steps) : '') +
    '<div>' + gpsLine + '<div class="sw"><div class="t"><b>Coach praat</b><span>' + (Voice.ok ? 'Via speaker of je oordopjes' : 'Niet beschikbaar in deze browser') + '</span></div><button class="tgl" role="switch" aria-checked="' + !!SET.voice + '" aria-label="Coach praat" data-act="set-toggle" data-v="voice"></button></div>' + rw + '</div>' +
    '<button class="btn primary xl" data-act="begin">' + ic('play') + 'Start</button>' +
    '<div class="row" style="justify-content:center"><button class="btn sm ghost" data-act="voice-test">' + ic('vol') + 'Test geluid</button></div>' +
    '<p class="small muted" style="text-align:center">Je locatie blijft op je telefoon en wordt met niemand gedeeld. Je kunt GPS tijdens het lopen uitzetten.</p></div></div>';
}
function resumeHtml(m){
  const sn = m.snap, mins = Math.round(sn.el / 60000);
  return '<div class="overlay"><div class="sheet" role="dialog" aria-modal="true"><div><div class="eyebrow">Onderbroken training</div><h2 style="margin-top:6px">' + esc(sn.session.title || 'Vrije loop') + '</h2></div><p class="muted">Je training is onderbroken (' + mins + ' min, ' + num1(sn.dist / 1000) + ' km). Wil je verder gaan?</p><div class="stack"><button class="btn primary xl" data-act="resume-run">Verder gaan</button><button class="btn" data-act="resume-finish">Afronden en opslaan</button><button class="btn danger" data-act="resume-discard">Weggooien</button></div></div></div>';
}
function stopqHtml(){
  return '<div class="overlay" style="z-index:130"><div class="sheet" role="dialog" aria-modal="true"><div><div class="eyebrow">Training stoppen?</div><h2 style="margin-top:6px">Wil je afronden?</h2></div><p class="muted">Je kunt de training opslaan met alles wat je tot nu toe gedaan hebt.</p><div class="stack"><button class="btn primary xl" data-act="finish">Afronden en opslaan</button><button class="btn" data-act="stopq-no">Doorgaan met trainen</button><button class="btn danger" data-act="discard">Weggooien</button></div></div></div>';
}
function summaryHtml(m){
  const d = m.draft, T = TYPES[d.type] || { color:'easy', label:'Vrije loop' };
  const s = d.sessionId ? findSession(d.sessionId) : null;
  const run = d.mode !== 'strength';
  const stats = [stat(fmtClock(d.dur), 'tijd')];
  if (run && d.gps) stats.push(stat(num1(d.dist / 1000), 'kilometer'), stat(d.avgPace ? fmtPaceSec(d.avgPace) : '–', 'gem. tempo /km'), stat('↑ ' + d.ascent, 'hoogtemeters omhoog'), stat('↓ ' + d.descent, 'omlaag'));
  const manual = run && !d.gps ? '<div class="fld"><label for="s-km">Afstand (km)</label><input type="number" inputmode="decimal" id="s-km" step="0.1" min="0" value="' + (s ? s.km : '') + '"><span class="hint">Geen GPS-meting: vul de afstand in (loopband of schatting).</span></div>' : '';
  const splits = d.splits && d.splits.length ? '<div class="scroll-x"><table><thead><tr><th>km</th><th>Tijd</th><th>Tempo</th><th>↑ m</th></tr></thead><tbody>' + d.splits.map(x => '<tr><td>' + x.km + '</td><td class="num">' + fmtClock(x.sec) + '</td><td class="num">' + fmtPaceSec(x.sec) + '</td><td class="num">' + x.asc + '</td></tr>').join('') + '</tbody></table></div>' : '';
  const rpeTxt = { 1:'heel licht', 2:'licht', 3:'makkelijk', 4:'redelijk', 5:'stevig', 6:'pittig', 7:'zwaar', 8:'erg zwaar', 9:'bijna maximaal', 10:'maximaal' };
  return '<div class="overlay" style="z-index:130"><div class="sheet t-' + T.color + '" role="dialog" aria-modal="true"><div class="sheet-h"><div><div class="eyebrow" style="color:var(--tc)">Training klaar</div><h2 style="margin-top:6px">' + esc(d.title) + '</h2></div></div>' +
    (d.track && d.track.length > 3 ? routeSvg(d.track) + elevSvg(d.track) : '') + '<div class="stats">' + stats.join('') + '</div>' + manual + splits +
    '<div class="fld"><label>Hoe zwaar voelde dit? (RPE)</label><div class="rpe">' + [1,2,3,4,5,6,7,8,9,10].map(n => '<button data-act="s-rpe" data-v="' + n + '" aria-pressed="' + (m.rpe === n) + '">' + n + '</button>').join('') + '</div><span class="hint">' + (m.rpe ? m.rpe + ': ' + rpeTxt[m.rpe] : 'Kies een cijfer van 1 (heel licht) tot 10 (maximaal).') + '</span></div>' +
    '<div class="fld"><label for="s-note">Notitie (optioneel)</label><input type="text" id="s-note" placeholder="Hoe voelde het?" value="' + esc(m.note || '') + '"></div>' +
    (s && s.status === 'planned' ? '<p class="small muted">Deze training wordt in je schema als gedaan afgevinkt.</p>' : '') +
    '<div class="stack"><button class="btn primary xl" data-act="save-act">Opslaan</button><button class="btn danger" data-act="discard-draft">Weggooien</button></div></div></div>';
}
function actHtml(m){
  const a = (S.acts || []).find(x => x.id === m.id);
  if (!a) return '';
  const T = TYPES[a.type] || { color:'easy', label:'Vrije loop' };
  const tr = m.track || [];
  const stats = [stat(fmtClock(a.dur), 'tijd')];
  if (a.dist) stats.push(stat(num1(a.dist / 1000), 'kilometer'), stat(a.avgPace ? fmtPaceSec(a.avgPace) : '–', 'gem. tempo /km'), stat('↑ ' + (a.ascent || 0), 'hoogtemeters'));
  const splits = a.splits && a.splits.length ? '<div class="scroll-x"><table><thead><tr><th>km</th><th>Tijd</th><th>Tempo</th><th>↑ m</th></tr></thead><tbody>' + a.splits.map(x => '<tr><td>' + x.km + '</td><td class="num">' + fmtClock(x.sec) + '</td><td class="num">' + fmtPaceSec(x.sec) + '</td><td class="num">' + x.asc + '</td></tr>').join('') + '</tbody></table></div>' : '';
  return '<div class="overlay" data-act="close-bg"><div class="sheet t-' + T.color + '"><div class="sheet-h"><div><div class="eyebrow" style="color:var(--tc)">' + esc(fmtDate(a.at)) + '</div><h2 style="margin-top:6px">' + esc(a.title) + '</h2></div><button class="x" data-act="close" aria-label="Sluiten">×</button></div>' +
    (tr.length > 3 ? routeSvg(tr) + elevSvg(tr) : '') + '<div class="stats">' + stats.join('') + '</div>' + splits + (a.rpe || a.note ? '<p class="small muted">' + (a.rpe ? 'RPE ' + a.rpe + '. ' : '') + (a.note ? esc(a.note) : '') + '</p>' : '') +
    '<div class="row">' + (tr.length > 3 ? '<button class="btn" data-act="gpx" data-id="' + esc(a.id) + '">GPX exporteren</button>' : '') + '<button class="btn danger" data-act="act-del" data-id="' + esc(a.id) + '">Verwijderen</button></div></div></div>';
}

/* ---------- live training ---------- */
function buildLive(){
  const s = RUN.session, T = TYPES[s.type] || { color:'long' }, str = RUN.mode === 'strength';
  $live.className = 'live t-' + T.color;
  $live.hidden = false;
  document.body.style.overflow = 'hidden';
  const tiles = str
    ? ['<div class="metric"><b id="m1">0:00</b><span>Tijd</span></div>', '<div class="metric"><b id="m2">–</b><span>Oefening</span></div>', '<div class="metric"><b id="m3">–</b><span>Set</span></div>']
    : ['<div class="metric"><b id="m1">0:00</b><span>Tijd</span></div>', '<div class="metric"><b id="m2">0,00</b><span>Km</span></div>', '<div class="metric"><b id="m3">–</b><span>Tempo nu</span></div>',
       '<div class="metric"><b id="m4">–</b><span>Gem. tempo</span></div>', '<div class="metric"><b id="m5">0</b><span>↑ meter</span></div>', '<div class="metric"><b id="m6">–</b><span>' + (s.hr && s.type !== 'hills' ? 'Hartslagdoel' : 'Inspanning') + '</span></div>'];
  $live.innerHTML = '<div class="live-top"><button class="iconbtn" id="lv-mute" data-act="lv-mute" aria-label="Geluid aan of uit">' + ic(SET.voice ? 'vol' : 'mute') + '</button><div class="ttl"><b>' + esc(s.title || 'Vrije loop') + '</b><span id="lv-sub"></span></div>' +
    (str ? '' : '<button class="iconbtn" id="lv-gps" data-act="lv-gps" aria-label="GPS aan of uit">' + ic(RUN.gps ? 'pin' : 'pinoff') + '</button>') +
    '<button class="iconbtn" data-act="lv-repeat" aria-label="Herhaal laatste melding">' + ic('repeat') + '</button><button class="iconbtn" data-act="lv-dim" aria-label="Scherm dimmen">' + ic('moon') + '</button></div>' +
    '<div class="stepbox"><div class="bigring" id="lv-ring"><div><div class="t num" id="lv-t">0:00</div><div class="s" id="lv-s">verstreken</div></div></div><div class="stepname" id="lv-step"></div><div class="stepsay" id="lv-say"></div><div class="next" id="lv-next"></div></div>' +
    '<div class="metrics">' + tiles.join('') + '</div>' + (s.steps || RUN.steps.length > 1 ? profileSvg(RUN.steps) : '') +
    '<div class="ctrls"><button class="btn stopbtn" data-act="lv-stop" aria-label="Stoppen">' + ic('stop') + 'Stop</button>' +
    (str ? '<button class="btn pausebtn" id="lv-main" data-act="lv-next">' + ic('check') + 'Klaar</button>' : '<button class="btn pausebtn" id="lv-main" data-act="lv-pause">' + ic('pause') + 'Pauze</button>') +
    '<button class="btn" data-act="lv-skip" aria-label="Volgende stap">' + ic('skip') + 'Stap</button></div>';
  updateLive();
}
function updateLive(){
  if (!RUN || $live.hidden) return;
  const v = RUN.view(), st = v.step, str = RUN.mode === 'strength';
  const $ = id => document.getElementById(id), set = (id, t) => { const e = $(id); if (e && e.textContent !== String(t)) e.textContent = t; };
  const paused = v.state === 'paused';
  const ring = $('lv-ring');
  let big, sub, p;
  if (st && v.remain != null && (st.sec && !st.manual)){ big = fmtClock(Math.ceil(v.remain)); sub = paused ? 'gepauzeerd' : 'resterend'; p = v.frac * 100; }
  else if (str && st && st.manual){ big = st.reps ? st.reps : (st.k === 'warm' ? '5:00' : '✓'); sub = st.reps ? 'herhalingen' : (st.k === 'warm' ? 'warming-up' : ''); p = 0; }
  else { big = fmtClock(v.el); sub = paused ? 'gepauzeerd' : (v.reached ? 'doel bereikt' : 'verstreken'); p = RUN.free ? (v.el % 60) / 60 * 100 : v.frac * 100; }
  set('lv-t', big); set('lv-s', sub);
  if (ring) ring.style.setProperty('--p', Math.round(p * 10) / 10);
  set('lv-step', st ? st.label : (v.reached ? 'Klaar!' : ''));
  const nxt = RUN.steps[v.stepIdx + 1];
  const left = st && st.toKm && v.gps ? 'Nog ' + num1(Math.max(0, st.toKm - v.dist / 1000)) + ' km' + (nxt ? ' · ' : '') : '';
  set('lv-next', st ? left + (nxt ? 'Straks: ' + nxt.label : '') : (v.reached ? 'Loop rustig uit of stop de training.' : ''));
  const sayEl = $('lv-say'); if (sayEl && RUN.c.lastSay && sayEl.dataset.t !== RUN.c.lastSay){ sayEl.dataset.t = RUN.c.lastSay; sayEl.textContent = RUN.c.lastSay; }
  const sub2 = str ? 'Krachttraining' : (v.gps ? '<span class="gpsdot ok"></span>GPS' : (RUN.gps ? '<span class="gpsdot wait"></span>GPS zoeken…' : 'Zonder GPS')) + ' · stap ' + Math.min(v.stepIdx + 1, v.stepCount) + '/' + v.stepCount;
  const subEl = $('lv-sub'); if (subEl && subEl.dataset.h !== sub2){ subEl.dataset.h = sub2; subEl.innerHTML = sub2; }
  if (str){
    set('m1', fmtClock(v.el)); set('m2', st && st.k === 'ex' ? st.label : '–'); set('m3', st && st.set ? st.set + '/' + st.of : '–');
  } else {
    set('m1', fmtClock(v.el)); set('m2', num1d(v.dist / 1000)); set('m3', v.pace ? fmtPaceSec(v.pace) : '–'); set('m4', v.avgPace ? fmtPaceSec(v.avgPace) : '–'); set('m5', Math.round(v.ascent));
    const sess = RUN.session; set('m6', sess.type === 'hills' ? 'RPE 7–8' : sess.hr ? sess.hr[0] + '–' + sess.hr[1] : (sess.rpe || '3–4'));
  }
  const main = $('lv-main');
  if (main && !str){ const want = paused ? 'play' : 'pause'; if (main.dataset.s !== want){ main.dataset.s = want; main.dataset.act = paused ? 'lv-resume' : 'lv-pause'; main.innerHTML = ic(want) + (paused ? 'Hervat' : 'Pauze'); } }
  const bars = $live.querySelectorAll('.pb');
  bars.forEach(b => { const i = +b.dataset.i, o = i < v.stepIdx ? 0.3 : i === v.stepIdx ? 1 : 0.75; if (b.getAttribute('opacity') != o) b.setAttribute('opacity', o); });
  const dim = document.getElementById('dimmer'); if (dim){ const t = dim.querySelector('b'); if (t) t.textContent = fmtClock(v.el); }
}
function num1d(x){ return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }

function liveTick(){
  if (!RUN) return;
  const now = Date.now();
  RUN.tick(now);
  updateLive();
  if (now - LIVE.snapT > 5000){ LIVE.snapT = now; try { lsSet(LS_ACTIVE, JSON.stringify(RUN.snapshot())); } catch(e){} }
}
function startLiveLoop(){ clearInterval(LIVE.timer); LIVE.timer = setInterval(liveTick, 500); }
function runnerOpts(extra){
  return Object.assign({ say:(t, p) => Voice.say(t, p), beep:k => Voice.beep(k), pace:S ? S.cfg.pace : 6, cueEvery:SET.cueEvery, verbose:SET.verbose, tips:SET.tips, tooFast:SET.tooFast, fuel:SET.fuel, autoPause:SET.autoPause }, extra || {});
}
async function beginWorkout(){
  const m = UI.modal, s = m.id ? findSession(m.id) : null;
  const useGps = !m.noGps && !(s && s.type === 'strength');
  Voice.unlock(); applyVoiceSettings();
  const session = s || { id:null, type:'free', title:'Vrije loop', rpe:'3–4' };
  RUN = new Runner(runnerOpts({ session, gps:useGps, runWalk:!!m.runWalk }));
  UI.modal = null; renderLayer();
  Awake.enable({ background:SET.bg });
  if (SET.bg) setMediaSession(session.title || 'Training', { pause:() => togglePause(), play:() => togglePause(), nexttrack:() => RUN && RUN.status(), previoustrack:() => RUN && RUN.repeat() });
  if (useGps) Geo.start(p => { if (RUN) RUN.pos(p); });
  buildLive();
  // aftellen 3-2-1
  $layer.insertAdjacentHTML('beforeend', '<div class="countdown" id="cd">3</div>');
  for (let n = 3; n >= 1; n--){
    const cd = document.getElementById('cd'); if (cd) cd.textContent = n;
    Voice.beep('tick'); await new Promise(r => setTimeout(r, 1000));
  }
  const cd = document.getElementById('cd'); if (cd) cd.remove();
  Voice.beep('go');
  RUN.start(Date.now());
  LIVE.snapT = 0; startLiveLoop(); liveTick();
}
function togglePause(){ if (!RUN) return; if (RUN.state === 'running') RUN.pause(Date.now()); else if (RUN.state === 'paused') RUN.resume(Date.now()); updateLive(); }
function teardownLive(){
  clearInterval(LIVE.timer); LIVE.timer = null;
  Geo.stop(); Awake.disable(); Voice.stop();
  $live.hidden = true; $live.innerHTML = ''; document.body.style.overflow = '';
  const dim = document.getElementById('dimmer'); if (dim) dim.remove();
}
function finishRun(){
  const sum = RUN.stop(Date.now());
  sum.startedAt = RUN.startedAt;
  lsSet(LS_ACTIVE, JSON.stringify({ finished:true, draft:sum }));
  teardownLive();
  RUN = null;
  UI.modal = { type:'summary', draft:sum, rpe:null, note:'' };
  render();
}
async function saveActivity(){
  const m = UI.modal, d = m.draft;
  const noteEl = document.getElementById('s-note'); const note = noteEl ? noteEl.value.trim().slice(0, 200) : (m.note || '');
  const kmEl = document.getElementById('s-km');
  let distM = d.dist;
  if (kmEl && kmEl.value !== '') distM = Math.round(Math.max(0, Number(kmEl.value)) * 1000);
  const id = 'a' + d.startedAt;
  const act = { id, ts:d.startedAt, at:dateOfTs(d.startedAt), sessionId:d.sessionId, type:d.type, title:d.title, mode:d.mode, dur:d.dur, dist:distM, ascent:d.ascent, descent:d.descent, avgPace: distM > 50 ? d.dur / (distM / 1000) : null, rpe:m.rpe, note, splits:d.splits, trk:(d.track || []).length > 3 };
  const n = clone(S);
  n.acts = (n.acts || []).filter(a => a.id !== id).concat([act]);
  if (d.sessionId){
    const s = findSession(d.sessionId);
    if (s && s.status === 'planned'){
      const e = { status:'done', at:TODAY, min:Math.round(d.dur / 60), act:id };
      if (d.mode !== 'strength') { e.km = Math.round(distM / 100) / 10; if (d.ascent) e.vert = d.ascent; }
      if (m.rpe) e.rpe = m.rpe; if (note) e.note = note;
      n.log[d.sessionId] = e;
    }
  }
  if (act.trk) await TrackDB.put(id, d.track);
  setState(n); lsDel(LS_ACTIVE);
  UI.modal = null; UI.tab = 'vandaag';
  render(); toast('Opgeslagen. Goed gedaan!');
}
function dateOfTs(ts){ const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dimOn(){
  if (document.getElementById('dimmer')) return;
  const el = document.createElement('div'); el.className = 'dimmer'; el.id = 'dimmer'; el.dataset.act = 'lv-undim';
  el.innerHTML = '<b class="num">' + fmtClock(RUN ? RUN.view().el : 0) + '</b><span>Tik om te ontdekken</span>';
  document.body.appendChild(el);
}

/* ---------- acties ---------- */
function summaryOf(r){
  const rb = r.rebase;
  return 'Schema aangepast vanaf ' + fmtDate(rb.from, {short:true, noDay:true}) + ': belasting op ' + Math.round(rb.factor*100) + '%. Je langste duurloop komt nu uit op ' + fmtKm(rb.peakAfter) + '.';
}
function logSession(id, entry){ const n = clone(S); n.log[id] = entry; return n; }
async function exportGpx(id){
  const a = (S.acts || []).find(x => x.id === id); if (!a) return;
  const tr = await TrackDB.get(id); if (!tr) return toast('Geen route bewaard voor deze activiteit.');
  const xml = toGpx({ track:tr, startedAt:a.ts }, a.title);
  const file = new File([xml], 'trailplanner-' + a.at + '.gpx', { type:'application/gpx+xml' });
  try { if (navigator.canShare && navigator.canShare({ files:[file] })) { await navigator.share({ files:[file], title:a.title }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file); const l = document.createElement('a'); l.href = url; l.download = file.name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadBackup(){
  const blob = new Blob([JSON.stringify(S)], { type:'application/json' });
  const file = new File([blob], 'trailplanner-reservekopie-' + TODAY + '.json', { type:'application/json' });
  (async () => {
    try { if (navigator.canShare && navigator.canShare({ files:[file] })) { await navigator.share({ files:[file], title:'Trailplanner reservekopie' }); return; } } catch(e){ if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob); const l = document.createElement('a'); l.href = url; l.download = file.name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  })();
}

function applyCfg(k, v){
  const n = clone(S);
  if (k === 'strength') n.cfg.strength = Number(v);
  else if (k === 'strengthHome') n.cfg.strengthHome = v === 'true';
  else if (k === 'hills') n.cfg.hills = v;
  else return;
  n.history.push({ at:TODAY, text:'Voorkeuren aangepast.' });
  setState(n); render(); toast('Schema aangepast.');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  const R = () => render();
  if (act === 'adjust'){ UI.modal = { id, mode:'adjust' }; return R(); }
  if (act === 'swap'){
    const s = findSession(id), n = clone(S); n.swap = n.swap || {};
    if (v === 'reset') delete n.swap[id]; else n.swap[id] = v;
    n.history.push({ at:TODAY, text:(v === 'reset' ? 'Oorspronkelijke training teruggezet: ' : 'Training gewisseld: ') + s.title + ' (' + fmtDate(s.date, {short:true}) + ').' });
    setState(n); UI.modal = { id, mode:'view' }; R(); toast(v === 'reset' ? 'Terug naar het oorspronkelijke schema.' : 'Training gewisseld.'); return;
  }
  if (act === 'wiz-tempo'){ wzCollect(); WZ.d.tempo = (WZ.d.tempo === false); return R(); }
  if (act === 'wiz-home'){ wzCollect(); WZ.d.strengthHome = !WZ.d.strengthHome; return R(); }
  if (act === 'cfg-toggle'){
    const n = clone(S);
    if (v === 'tempo') n.cfg.tempo = (n.cfg.tempo === false); else n.cfg[v] = !n.cfg[v];
    n.history.push({ at:TODAY, text:'Voorkeuren aangepast.' });
    setState(n); R(); toast('Schema aangepast.'); return;
  }
  if (act === 'lv-gps'){
    if (!RUN || RUN.mode === 'strength') return;
    if (RUN.gps){ RUN.gps = false; Geo.stop(); toast('GPS staat uit. Er wordt nu alleen op tijd geteld.'); }
    else { RUN.gps = true; RUN.lastPt = null; Geo.start(p => { if (RUN) RUN.pos(p); }); toast('GPS staat weer aan.'); }
    const b = document.getElementById('lv-gps'); if (b) b.innerHTML = ic(RUN.gps ? 'pin' : 'pinoff');
    updateLive(); return;
  }
  if (act === 'wipe-tracks'){
    TrackDB.clear().then(() => { const n = clone(S); (n.acts || []).forEach(a => { a.trk = false; }); setState(n); render(); toast('Alle opgeslagen routes zijn van je telefoon gewist.'); });
    return;
  }
  if (act === 'close-bg'){ if (e.target !== el) return; UI.modal = null; return R(); }
  if (act === 'close'){ UI.modal = null; return R(); }
  if (act === 'tab'){ UI.tab = v; UI.modal = null; UI.enter = true; window.scrollTo(0, 0); return R(); }
  if (act === 'plantab'){ UI.planTab = v; UI.enter = true; return R(); }
  if (act === 'open'){ UI.modal = { id, mode:'view' }; return R(); }
  if (act === 'open-done'){ UI.modal = { id, mode:'done', rpe:null }; return R(); }
  if (act === 'open-skip'){ UI.modal = { id, mode:'skip', reason:'tijd' }; return R(); }
  if (act === 'd-rpe'){ UI.modal.rpe = Number(v); const k = document.getElementById('d-km'), nt = document.getElementById('d-note'); const keep = { k:k && k.value, n:nt && nt.value }; R(); const k2 = document.getElementById('d-km'), n2 = document.getElementById('d-note'); if (k2 && keep.k != null) k2.value = keep.k; if (n2 && keep.n != null) n2.value = keep.n; return; }
  if (act === 'cal-prev'){ UI.month = shiftMonth(UI.month, -1); return R(); }
  if (act === 'cal-next'){ UI.month = shiftMonth(UI.month, 1); return R(); }
  if (act === 'week'){ UI.openWeek = (UI.openWeek === v) ? '-' : v; return R(); }
  if (act === 'install'){ if (installEvt){ installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; R(); }); } return; }
  if (act === 'hide-install'){ SET.hideInstall = true; saveSet(); return R(); }
  if (act === 'done-save'){
    const km = document.getElementById('d-km'), note = document.getElementById('d-note');
    const entry = { status:'done', at:TODAY };
    if (km && km.value !== '') entry.km = Math.max(0, Number(km.value));
    if (note && note.value.trim()) entry.note = note.value.trim().slice(0, 200);
    if (UI.modal && UI.modal.rpe){ entry.rpe = UI.modal.rpe; const ss = findSession(id); if (ss && ss.minutes) entry.min = ss.minutes; } // duur: geplande duur als schatting
    setState(logSession(id, entry)); UI.modal = null; R(); toast('Opgeslagen. Goed bezig!'); return;
  }
  if (act === 'skip-confirm'){
    const s = findSession(id), reasonEl = document.getElementById('sk-reason');
    const reason = reasonEl ? reasonEl.value : 'tijd';
    let n = logSession(id, { status:'skipped', reason, at:TODAY });
    n.history.push({ at:TODAY, text:'Overgeslagen: ' + s.title + ' van ' + fmtDate(s.date, {short:true}) + '.' });
    setState(n);
    const r = applyRebase(S, TODAY);
    UI.modal = null;
    if (r.changed){ setState(r.state); R(); toast(summaryOf(r)); }
    else { R(); toast('Overgeslagen. Geen aanpassing nodig: ' + (isRunType(s.type) && !KEY_TYPES.includes(s.type) ? 'één gemiste rustige loop heeft geen effect.' : 'je schema blijft zoals gepland.')); }
    return;
  }
  if (act === 'move'){
    const s = findSession(id), n = clone(S); n.over[id] = v;
    n.history.push({ at:TODAY, text:s.title + ' verplaatst van ' + fmtDate(s.date, {short:true}) + ' naar ' + fmtDate(v, {short:true}) + '.' });
    setState(n); UI.modal = null; R(); toast('Verplaatst naar ' + fmtDate(v) + '.'); return;
  }
  if (act === 'unmove'){ const n = clone(S); delete n.over[id]; setState(n); UI.modal = { id, mode:'view' }; return R(); }
  if (act === 'reset'){ const n = clone(S); delete n.log[id]; setState(n); UI.modal = { id, mode:'view' }; return R(); }
  if (act === 'rebase-now'){
    const r = applyRebase(S, TODAY);
    if (r.changed){ setState(r.state); R(); toast(summaryOf(r)); } else toast('Er is nu geen aanpassing nodig.');
    return;
  }
  if (act === 'undo-rebase'){ setState(undoRebase(S)); R(); toast('Laatste herberekening ongedaan gemaakt.'); return; }
  if (act === 'backup'){
    UI.backup = JSON.stringify(S);
    try { navigator.clipboard.writeText(UI.backup).then(() => toast('Reservekopie gekopieerd.'), () => {}); } catch(err){}
    return R();
  }
  if (act === 'backup-file') return downloadBackup();
  if (act === 'restore'){
    const t = document.getElementById('bk-in');
    try { const st = migrateState(JSON.parse(t.value)); if (!st || !st.cfg.raceDate) throw 0; setState(st); R(); toast('Reservekopie teruggezet.'); } catch(err){ toast('Dit lijkt geen geldige reservekopie.'); }
    return;
  }
  if (act === 'redo'){ wzInit(S.cfg); R(); window.scrollTo(0, 0); return; }
  if (act === 'wipe'){ UI.wipe = true; return R(); }
  if (act === 'wipe-no'){ UI.wipe = false; return R(); }
  if (act === 'wipe-yes'){ S = null; PLAN = null; UI.wipe = false; UI.backup = ''; lsDel(LS_KEY); lsDel(LS_ACTIVE); WZ = null; wzInit(); return R(); }
  /* instellingen */
  if (act === 'set-toggle'){ SET[v] = !SET[v]; saveSet(); if (v === 'voice' && $live && !$live.hidden){ const b = document.getElementById('lv-mute'); if (b) b.innerHTML = ic(SET.voice ? 'vol' : 'mute'); } return R(); }
  if (act === 'voice-test'){ Voice.unlock(); applyVoiceSettings(); const was = Voice.enabled; Voice.enabled = true; Voice.say('Hoi! Ik ben je trailcoach. Zo klink ik tijdens je training. Kilometer drie, zes minuten dertig per kilometer.', 'hi'); Voice.enabled = was; Voice.beep('force'); return; }
  /* start */
  if (act === 'prestart'){
    const s = id ? findSession(id) : null;
    UI.modal = { type:'prestart', id: id || null, gps:null, acc:null, noGps:false, runWalk: runWalkDefault(s) };
    R(); probeGps(); return;
  }
  if (act === 'gps-probe'){ probeGps(); return; }
  if (act === 'pre-nogps'){ UI.modal.noGps = !UI.modal.noGps; return R(); }
  if (act === 'pre-rw'){ UI.modal.runWalk = !UI.modal.runWalk; return R(); }
  if (act === 'begin'){ beginWorkout(); return; }
  /* live */
  if (act === 'lv-pause' || act === 'lv-resume'){ togglePause(); return; }
  if (act === 'lv-skip'){ if (RUN){ RUN.skip(Date.now()); updateLive(); } return; }
  if (act === 'lv-next'){ if (RUN){ RUN.skip(Date.now()); updateLive(); } return; }
  if (act === 'lv-repeat'){ if (RUN) RUN.repeat(); return; }
  if (act === 'lv-mute'){ SET.voice = !SET.voice; saveSet(); const b = document.getElementById('lv-mute'); if (b) b.innerHTML = ic(SET.voice ? 'vol' : 'mute'); if (!SET.voice) Voice.stop(); return; }
  if (act === 'lv-dim'){ dimOn(); return; }
  if (act === 'lv-undim'){ const d = document.getElementById('dimmer'); if (d) d.remove(); return; }
  if (act === 'lv-stop'){ if (RUN && RUN.state === 'running') RUN.pause(Date.now()); UI.modal = { type:'stopq' }; renderLayer(); updateLive(); return; }
  if (act === 'stopq-no'){ UI.modal = null; renderLayer(); if (RUN && RUN.state === 'paused') RUN.resume(Date.now()); updateLive(); return; }
  if (act === 'finish'){ finishRun(); return; }
  if (act === 'discard'){ if (RUN){ RUN.state = 'finished'; } teardownLive(); RUN = null; lsDel(LS_ACTIVE); UI.modal = null; return R(); }
  if (act === 's-rpe'){ const nt = document.getElementById('s-note'), km = document.getElementById('s-km'); UI.modal.note = nt ? nt.value : ''; const kv = km ? km.value : null; UI.modal.rpe = Number(v); R(); const k2 = document.getElementById('s-km'); if (k2 && kv != null) k2.value = kv; return; }
  if (act === 'save-act'){ saveActivity(); return; }
  if (act === 'discard-draft'){ lsDel(LS_ACTIVE); UI.modal = null; return R(); }
  if (act === 'resume-run'){ const sn = UI.modal.snap; RUN = Runner.restore(sn, runnerOpts({ gps:sn.mode !== 'strength' && Geo.supported() })); UI.modal = null; renderLayer(); Voice.unlock(); applyVoiceSettings(); Awake.enable({ background:SET.bg }); if (RUN.gps) Geo.start(p => { if (RUN) RUN.pos(p); }); buildLive(); startLiveLoop(); updateLive(); return; }
  if (act === 'resume-finish'){ const sn = UI.modal.snap; const r = Runner.restore(sn, runnerOpts({ gps:false })); r.state = 'paused'; const sum = r.stop(Date.now()); sum.startedAt = r.startedAt; sum.gps = sn.dist > 0; UI.modal = { type:'summary', draft:sum, rpe:null, note:'' }; return R(); }
  if (act === 'resume-discard'){ lsDel(LS_ACTIVE); UI.modal = null; return R(); }
  /* activiteiten */
  if (act === 'act'){ UI.modal = { type:'act', id, track:[] }; R(); TrackDB.get(id).then(t => { if (UI.modal && UI.modal.type === 'act' && UI.modal.id === id){ UI.modal.track = t || []; renderLayer(); } }); return; }
  if (act === 'gpx'){ exportGpx(id); return; }
  if (act === 'act-del'){ const n = clone(S); n.acts = n.acts.filter(a => a.id !== id); for (const k in n.log) if (n.log[k].act === id) delete n.log[k].act; TrackDB.del(id); setState(n); UI.modal = null; R(); toast('Verwijderd.'); return; }
  /* wizard */
  if (act === 'wiz-vert'){ wzCollect(); WZ.d.vert = Number(v); return R(); }
  if (act === 'wiz-level'){
    wzCollect();
    const d = WZ.d, def = WIZ_DEF[v];
    d.level = v;
    if (!d.v0 || WZ.auto){ d.v0 = def.v0; d.lr0 = def.lr0; d.pace = def.pace; d.runsPerWeek = Math.min(def.runs, d.availDays.length); WZ.auto = true; }
    return R();
  }
  if (act === 'wiz-day'){
    wzCollect();
    const d = WZ.d, n = Number(v);
    d.availDays = d.availDays.includes(n) ? d.availDays.filter(x => x !== n) : d.availDays.concat([n]).sort((a, b) => a - b);
    if (!d.availDays.includes(Number(d.longDow))) d.longDow = d.availDays[d.availDays.length - 1];
    return R();
  }
  if (act === 'wiz-hills'){ wzCollect(); WZ.d.hills = v; return R(); }
  if (act === 'wiz-next'){
    wzCollect();
    if (WZ.step === 1 && WZ.auto){ const lv = WIZ_DEF[WZ.d.level]; if (Number(WZ.d.v0) !== lv.v0 || Number(WZ.d.lr0) !== lv.lr0) WZ.auto = false; }
    WZ.errs = wzValidate(WZ.step);
    if (!WZ.errs.length) WZ.step++;
    R(); window.scrollTo(0, 0); return;
  }
  if (act === 'wiz-back'){ wzCollect(); WZ.errs = []; WZ.step--; return R(); }
  if (act === 'wiz-cancel'){ WZ = null; return R(); }
  if (act === 'wiz-finish'){
    wzCollect();
    for (let i = 0; i < STEP_TITLES.length; i++){
      const er = wzValidate(i);
      if (er.length){ WZ.step = i; WZ.errs = er; R(); window.scrollTo(0, 0); return; }
    }
    const cfg = normalizeCfg(Object.assign({}, WZ.d, { startDate: TODAY }));
    const st = newState(cfg);
    if (S && WZ.redo){ st.history = S.history.concat([{ at:TODAY, text:'Schema opnieuw opgesteld met nieuwe gegevens.' }]); st.acts = S.acts || []; }
    WZ = null; UI.tab = 'vandaag'; UI.month = null; UI.openWeek = null;
    setState(st); R();
    toast('Je schema staat klaar.'); window.scrollTo(0, 0); return;
  }
});
function probeGps(){
  const m = UI.modal; if (!m || m.type !== 'prestart') return;
  if (!Geo.supported()){ m.gps = 'unavailable'; return renderLayer(); }
  m.gps = 'wait'; renderLayer();
  Geo.probe().then(r => { if (!UI.modal || UI.modal.type !== 'prestart') return; UI.modal.gps = r.ok ? 'ok' : (r.reason === 'denied' ? 'denied' : 'unavailable'); UI.modal.acc = r.ok ? Math.round(r.acc) : null; renderLayer(); });
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'sk-reason' && UI.modal){ UI.modal.reason = t.value; renderLayer(); }
  if (t.dataset.cfg){ applyCfg(t.dataset.cfg, t.value); return; }
  if (t.dataset.actChange === 'set-voice'){ SET.voiceURI = t.value; saveSet(); }
  if (t.dataset.actChange === 'set-cue'){ SET.cueEvery = t.value; saveSet(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.actInput === 'set-rate'){ SET.rate = Number(t.value); saveSet(); }
  if (t.dataset.actInput === 'set-vol'){ SET.vol = Number(t.value); saveSet(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && UI.modal && UI.modal.type !== 'stopq' && UI.modal.type !== 'summary'){ UI.modal = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.chip[data-act]')){ e.preventDefault(); e.target.click(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible'){
    const t = todayIso(); if (t !== TODAY){ TODAY = t; recompute(); render(); }
    if (RUN){ liveTick(); Awake.reacquire(); }
  } else if (RUN){ try { lsSet(LS_ACTIVE, JSON.stringify(RUN.snapshot())); } catch(e){} }
});
window.addEventListener('pagehide', () => { if (RUN){ try { lsSet(LS_ACTIVE, JSON.stringify(RUN.snapshot())); } catch(e){} } });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!RUN) render(); });
window.addEventListener('appinstalled', () => { installEvt = null; render(); toast('Geïnstalleerd!'); });

/* ---------- opstarten ---------- */
function checkActive(){
  const raw = lsGet(LS_ACTIVE);
  if (!raw) return;
  try {
    const o = JSON.parse(raw);
    if (o.finished && o.draft){ UI.modal = { type:'summary', draft:o.draft, rpe:null, note:'' }; return; }
    if (o && o.v === 1 && (o.el > 20000 || o.dist > 100)) UI.modal = { type:'resume', snap:o };
    else lsDel(LS_ACTIVE);
  } catch(e){ lsDel(LS_ACTIVE); }
}
function registerSw(){
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]sw\b/.test(location.search)) return; // tijdens ontwikkelen geen cache
  navigator.serviceWorker.register('sw.js').then(reg => {
    let first = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (first){ first = false; return; } toast('Nieuwe versie geladen.'); });
    reg.update().catch(() => {});
  }).catch(() => {});
}
UI.enter = true;
Voice.onVoices = () => { if (!RUN && S && UI.tab === 'meer') render(); };
Voice.init(); loadLocal(); applyVoiceSettings();
if (S) checkActive();
render();
registerSw();
window.__tp = { ENV, installCard, get S(){ return S; }, get PLAN(){ return PLAN; }, get RUN(){ return RUN; }, get UI(){ return UI; }, setTODAY(d){ TODAY = d; recompute(); render(); }, SET, Voice, Geo, render };
