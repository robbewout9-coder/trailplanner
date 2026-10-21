/* ============ COACH: live training, GPS, stem, scherm-aan ============ */
/* Alles wat tijdens het lopen gebeurt. De Runner is puur (tijd en posities gaan erin, tekst komt eruit), zodat hij
   los van de browser te testen is. Voice, Geo en Awake zijn dunne laagjes om browser-API's. */

function fmtClock(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  const p = n => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
}
function fmtPaceSec(spk){
  if (!spk || !isFinite(spk) || spk <= 0 || spk > 3600) return '–';
  const m = Math.floor(spk/60), s = Math.round(spk%60);
  return (s === 60 ? (m+1) + ':00' : m + ':' + String(s).padStart(2,'0'));
}
function spokenTime(sec){
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  const parts = [];
  if (h) parts.push(h + ' uur');
  if (m) parts.push(m + (m === 1 ? ' minuut' : ' minuten'));
  if (s && !h) parts.push(s + (s === 1 ? ' seconde' : ' seconden'));
  if (!parts.length) return '0 seconden';
  return parts.join(' en ');
}
function spokenPace(spk){
  if (!spk || !isFinite(spk)) return '';
  const m = Math.floor(spk/60), s = Math.round(spk%60);
  return m + ' minuten ' + (s ? s : '') + (s ? '' : 'precies') + ' per kilometer';
}
function haversine(a, b){
  const R = 6371000, rad = Math.PI/180;
  const dLat = (b.lat - a.lat)*rad, dLon = (b.lon - a.lon)*rad;
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(x)));
}

const FORM_TIPS = [
  'Houd je schouders ontspannen en je blik een paar meter vooruit.',
  'Korte, snelle pasjes werken beter op trail dan lange stappen.',
  'Ontspan je handen, alsof je een chipje vasthoudt dat niet mag breken.',
  'Loop rechtop vanuit je heupen, kijk niet naar je voeten.',
  'Houd je ademhaling rustig. Kun je nog praten? Dan is het goed.',
  'Op een klim: wandel als je ademhaling uit de hand loopt. Dat is slim, geen zwakte.',
  'Afdalen: korte pasjes, knieën zacht, laat je zwaartepunt licht naar voren staan.'
];

/* ---------- strength: oefeningen omzetten naar stappen ---------- */
function strengthSteps(ex){
  const steps = [ { k:'warm', sec:300, label:'Warming-up', say:'Krachttraining. Eerst vijf minuten warmmaken: heupcirkels, beenzwaaien en lichte squats. Tik op klaar als je begint met de eerste oefening.', manual:true } ];
  ex.forEach((e, ei) => {
    for (let s = 1; s <= e.sets; s++){
      const last = ei === ex.length - 1 && s === e.sets;
      const what = e.hold ? e.hold + ' seconden vasthouden' : e.reps + ' herhalingen';
      steps.push({ k:'ex', sec: e.hold || 0, manual: !e.hold, label: e.n, sub:'Set ' + s + ' van ' + e.sets + ' · ' + (e.hold ? e.hold + ' sec' : e.reps),
        say: e.n + '. Set ' + s + ' van ' + e.sets + '. ' + what + '.' + (s === 1 && e.note ? ' ' + e.note : ''), set:s, of:e.sets, reps: e.hold ? '' : e.reps, note:e.note });
      if (!last){
        const nxt = s < e.sets ? e.n : ex[ei+1].n;
        steps.push({ k:'rest', sec:e.rest, label:'Rust', sub:'Straks: ' + nxt, say:'Rust. ' + e.rest + ' seconden. Hierna ' + nxt + '.' });
      }
    }
  });
  return steps;
}

/* ---------- Runner ---------- */
class Runner {
  constructor(o){
    this.opts = Object.assign({ say:()=>{}, beep:()=>{}, pace:6, gps:true, runWalk:false, rwRun:300, rwWalk:60, cueEvery:'km', tips:true, tooFast:true, fuel:true, autoPause:false, verbose:true, ageHrMax:null }, o);
    const sess = o.session || {};
    this.session = sess;
    this.mode = o.mode || (sess.ex ? 'strength' : 'run');
    this.steps = o.steps || (this.mode === 'strength' ? strengthSteps(sess.ex) : (sess.steps || [{ k:'steady', sec:0, label:'Vrije loop', say:'Vrije loop. Veel plezier!' }]));
    this.free = !sess.steps && this.mode !== 'strength';
    this.gps = this.opts.gps && this.mode !== 'strength';
    this.state = 'idle';
    this.el = 0; this.lastT = 0; this.startedAt = null; this.endedAt = null;
    this.dist = 0; this.ascent = 0; this.descent = 0;
    this.lastPt = null; this.altS = null; this.altRef = null;
    this.track = []; this.splits = []; this.kmMark = 1; this.lastSplitEl = 0; this.lastSplitAsc = 0;
    this.recent = [];
    this.fixAt = 0; this.fixes = 0; this.badFixes = 0; this.acc = null; this.rejects = 0;
    this.stepIdx = -1; this.stepStartEl = 0; this.stepStartDist = 0;
    this.reachedTarget = false;
    this.c = { half:false, last1k:false, fuelN:0, tipAt:0, tooFastAt:-1e9, fast:0, rwPhase:-1, stepFlags:{}, gpsWarn:false, statusAt:0, lastSay:'' };
    this.log = [];
    this.moveT = 0; this.autoPaused = false;
    this.plannedKm = (sess.km || 0);
    this.plannedMin = sess.minutes || 0;
  }
  say(text, prio){ if (!text) return; this.c.lastSay = text; this.log.push({ at:this.el, text }); this.opts.say(text, prio || 'lo'); }
  /* --- levenscyclus --- */
  start(now){
    this.state = 'running'; this.startedAt = now; this.lastT = now; this.moveT = now;
    const intro = this.free ? 'Vrije loop gestart.' : '';
    this.stepIdx = -1;
    this._enterStep(0, true, intro);
  }
  pause(now, auto){
    if (this.state !== 'running') return;
    this.tick(now); this.state = 'paused'; this.autoPaused = !!auto; this.lastPt = null;
    this.say(auto ? 'Automatische pauze.' : 'Gepauzeerd.', 'hi');
  }
  resume(now){
    if (this.state !== 'paused') return;
    this.state = 'running'; this.lastT = now; this.lastPt = null; this.autoPaused = false; this.moveT = now;
    this.say('Hervat.', 'hi');
  }
  stop(now){
    if (this.state === 'running') this.tick(now);
    const was = this.state;
    this.state = 'finished'; this.endedAt = now;
    if (was !== 'idle') this.say(this.mode === 'strength' ? 'Training klaar. Goed gedaan!' : 'Training gestopt. ' + this._totals(), 'hi');
    return this.summary();
  }
  skip(now){
    if (this.state === 'idle' || this.state === 'finished') return;
    if (this.state === 'running') this.tick(now);
    this._nextStep(true);
  }
  back(now){ // vorige stap (alleen bij handmatige stappen nuttig)
    if (this.stepIdx > 0){ this.stepIdx -= 2; this._nextStep(true); }
  }
  /* --- stappen --- */
  get step(){ return this.steps[this.stepIdx] || null; }
  _enterStep(i, first, prefix){
    this.stepIdx = i;
    const st = this.steps[i];
    this.c.stepFlags = {};
    this.c.rwPhase = -1;
    if (!st){
      this.reachedTarget = true;
      if (this.mode !== 'strength' && !this.free) this.say('Je doel is bereikt. Loop rustig uit, of stop de training als je klaar bent.', 'hi');
      else if (this.mode === 'strength') this.say('Alle oefeningen gedaan. Stop de training om op te slaan.', 'hi');
      return;
    }
    this.stepStartEl = this.el;
    this.stepStartDist = this.dist;
    if (!first && (st.k === 'work' || st.k === 'sprint' || st.k === 'stride' || st.k === 'tempo')) this.opts.beep('go');
    this.say((prefix ? prefix + ' ' : '') + st.say, 'hi');
  }
  _nextStep(manual){
    const st = this.step;
    if (st && !manual && !st.toKm && st.sec){
      const idx = this.stepIdx + 1;
      const carry = this.stepStartEl + st.sec*1000;
      this._enterStep(idx, false);
      this.stepStartEl = carry; // geen drift bij late ticks
    } else this._enterStep(this.stepIdx + 1, false);
  }
  gpsOk(){ return this.gps && this.fixes > 0 && (this.lastT - this.fixAt) < 30000; }
  _stepDone(st){
    const stepEl = this.el - this.stepStartEl;
    if (st.manual) return false;
    if (st.toKm && this.gpsOk()) return this.dist >= st.toKm*1000;
    if (st.sec) return stepEl >= st.sec*1000;
    return false;
  }
  /* --- tijd --- */
  tick(now){
    if (this.state === 'idle' || this.state === 'finished') return;
    if (this.state === 'paused'){ this.lastT = now; return; }
    const dt = Math.max(0, now - this.lastT);
    this.lastT = now;
    this.el += dt;
    let guard = 0;
    while (guard++ < 30 && this.step && this._stepDone(this.step)) this._nextStep(false);
    if (this.stepIdx >= this.steps.length && !this.reachedTarget) this._enterStep(this.stepIdx, false);
    this._cues(now);
    if (this.gps && this.opts.autoPause && this.fixes > 3 && now - this.moveT > 15000 && !(this.step && (this.step.k === 'rec' || this.step.k === 'rest'))) this.pause(now, true);
  }
  _cues(now){
    const st = this.step, c = this.c, secEl = this.el/1000;
    const stepEl = st ? (this.el - this.stepStartEl)/1000 : 0;
    if (st && st.sec && !st.manual && !st.toKm){
      const rem = st.sec - stepEl;
      const f = c.stepFlags;
      if (st.sec >= 90 && rem <= 30 && rem > 29 && !f.r30){ f.r30 = 1; this.say('Nog dertig seconden.', 'hi'); }
      if (st.sec >= 40 && rem <= 10 && rem > 9 && !f.r10){ f.r10 = 1; this.say('Nog tien seconden.', 'hi'); }
      if (st.sec >= 40 && rem <= 3 && rem > 2 && !f.b3){ f.b3 = 1; this.opts.beep('tick'); }
      if (st.sec >= 40 && rem <= 2 && rem > 1 && !f.b2){ f.b2 = 1; this.opts.beep('tick'); }
      if (st.sec >= 40 && rem <= 1 && rem > 0 && !f.b1){ f.b1 = 1; this.opts.beep('tick'); }
      if (st.k === 'work' && st.sec >= 120 && stepEl >= st.sec/2 && stepEl < st.sec/2 + 2 && !f.half){ f.half = 1; this.say('Halverwege de klim. Houd je houding.', 'lo'); }
      if (st.k === 'tempo' && st.sec >= 600){
        const q = Math.floor(stepEl/300);
        if (q >= 1 && !f['q' + q] && stepEl < st.sec - 40){ f['q' + q] = 1; this.say('Nog ' + spokenTime(st.sec - stepEl) + ' tempo. Constante inspanning.', 'lo'); }
      }
    }
    if (st && st.manual && st.k === 'warm') { /* wacht op de gebruiker */ }
    if (this.mode === 'strength') return;
    /* afstandsgebonden cues */
    if (st && st.toKm){
      const targetM = st.toKm * 1000;
      if (this.gpsOk() && !c.half && this.dist >= targetM/2 && targetM >= 3000){ c.half = true; this.say('Halverwege. ' + this._totals(), 'lo'); }
      if (this.gpsOk() && !c.last1k && targetM - this.dist <= 1000 && targetM >= 4000 && this.dist < targetM){ c.last1k = true; this.say('Nog één kilometer.', 'lo'); }
    }
    /* loop-wandel */
    if (this.opts.runWalk && st && (st.k === 'steady' || st.k === 'warm') && (this.session.type === 'easy' || this.session.type === 'long' || this.free)){
      const cyc = this.opts.rwRun + this.opts.rwWalk, ph = Math.floor(secEl / cyc), within = secEl % cyc;
      const idx = ph*2 + (within >= this.opts.rwRun ? 1 : 0);
      if (idx !== c.rwPhase && secEl > 1){
        c.rwPhase = idx;
        if (idx % 2 === 1) this.say('Wandel ' + spokenTime(this.opts.rwWalk) + '.', 'hi'); else if (idx > 0) this.say('Weer rustig lopen.', 'hi');
      }
    }
    /* voeding (alleen echt lange trainingen) */
    if (this.opts.fuel && (this.session.type === 'long' || this.session.type === 'race' || this.free)){
      const planned = this.plannedMin || 0;
      if ((planned > 75 || this.free || secEl > 75*60) ){
        const first = 40*60, every = 35*60;
        const due = secEl >= first ? 1 + Math.floor((secEl - first)/every) : 0;
        if (due > c.fuelN){ c.fuelN = due; this.say('Tijd om iets te eten of te drinken. Streef naar dertig tot zestig gram koolhydraten per uur en drink naar dorst.' + (secEl > 150*60 ? ' Na ruim twee en een half uur mag het richting negentig gram als je dat getraind hebt.' : ''), 'hi'); }
      }
    }
    /* tips: iedere 12 minuten in rustige stappen */
    if (this.opts.tips && st && (st.k === 'steady' || st.k === 'warm') && secEl - c.tipAt >= 12*60 && secEl > 5*60){
      c.tipAt = secEl; this.say(FORM_TIPS[Math.floor(secEl/60/12) % FORM_TIPS.length], 'lo');
    }
    /* te snel op een rustige dag */
    if (this.opts.tooFast && this.gpsOk() && st && (st.fx === 'easy' || st.fx === 'long') && this.session.type !== 'hills' && this.session.type !== 'tempo' && this.session.type !== 'shakeout'){
      const p = this.pace();
      if (p && p < this.opts.pace*60*0.8){ c.fast += 1; } else c.fast = 0;
      if (c.fast >= 45 && secEl - c.tooFastAt > 8*60){ c.tooFastAt = secEl; c.fast = 0; this.say('Je loopt sneller dan een rustige duurloop. Neem gas terug, het hoort makkelijk te voelen.', 'hi'); }
    }
    /* gps-melding */
    if (this.gps && this.state === 'running' && secEl > 15){
      if (!this.gpsOk() && !c.gpsWarn){ c.gpsWarn = true; this.say('Het gps-signaal is zwak. Ik tel verder op tijd.', 'hi'); }
      if (this.gpsOk() && c.gpsWarn){ c.gpsWarn = false; this.say('Gps-signaal terug.', 'lo'); }
    }
  }
  /* --- GPS --- */
  pos(p){
    if (!this.gps || this.state === 'idle' || this.state === 'finished') return;
    const now = p.t || this.lastT;
    this.acc = p.acc;
    if (p.acc != null && p.acc > 35){ this.badFixes++; return; }
    this.fixAt = this.state === 'paused' ? this.fixAt : (p.now || now); this.fixes++;
    if (this.state === 'paused'){
      // bij auto-pauze: beweging detecteren om te hervatten
      if (this.autoPaused && this.lastPt){
        const d = haversine(this.lastPt, p);
        if (d > 6) this.resume(p.now || now);
      }
      if (!this.lastPt) this.lastPt = p;
      return;
    }
    // hoogte
    if (p.alt != null && isFinite(p.alt)){
      this.altS = this.altS == null ? p.alt : this.altS + 0.3*(p.alt - this.altS);
      if (this.altRef == null) this.altRef = this.altS;
      if (this.altS - this.altRef >= 4){ this.ascent += this.altS - this.altRef; this.altRef = this.altS; }
      else if (this.altRef - this.altS >= 4){ this.descent += this.altRef - this.altS; this.altRef = this.altS; }
    }
    if (!this.lastPt){ this.lastPt = p; this._track(p); return; }
    const d = haversine(this.lastPt, p);
    const dt = (p.t - this.lastPt.t) / 1000;
    if (dt <= 0) return;
    if (d / dt > 8.5){ this.rejects++; if (this.rejects > 4){ this.lastPt = p; this.rejects = 0; } return; }
    this.rejects = 0;
    const thr = Math.max(2, Math.min((p.acc || 5) * 0.35, 8));
    if (d < thr) return;
    this.dist += d; this.lastPt = p; this.moveT = p.now || now;
    this.recent.push({ t:this.el, d:this.dist });
    while (this.recent.length > 2 && this.recent[0].t < this.el - 25000) this.recent.shift();
    this._track(p);
    while (this.dist >= this.kmMark*1000){
      const sec = (this.el - this.lastSplitEl)/1000, asc = this.ascent - this.lastSplitAsc;
      this.splits.push({ km:this.kmMark, sec, asc:Math.round(asc) });
      this.lastSplitEl = this.el; this.lastSplitAsc = this.ascent;
      this._kmCue(this.kmMark, sec, asc);
      this.kmMark++;
    }
  }
  _track(p){
    const t = this.track[this.track.length-1];
    if (!t || Math.hypot((t[0]-p.lat)*111000, (t[1]-p.lon)*111000*Math.cos(p.lat*Math.PI/180)) >= 8 || this.el/1000 - t[3] >= 20){
      if (this.track.length < 6000) this.track.push([+p.lat.toFixed(6), +p.lon.toFixed(6), p.alt != null ? Math.round(p.alt) : null, Math.round(this.el/1000), Math.round(this.dist)]);
    }
  }
  _kmCue(km, sec, asc){
    const ev = this.opts.cueEvery;
    if (ev === 'off' || ev === 'time5' ) return;
    if (this.step && (this.step.k === 'work' || this.step.k === 'sprint' || this.step.k === 'stride')) return; // niet storen tijdens een interval
    if (ev === 'km2' && km % 2) return;
    const p = this.dist ? this.el/1000/(this.dist/1000) : 0;
    let t = 'Kilometer ' + km + '. Deze kilometer ' + spokenTime(sec) + '.';
    if (this.opts.verbose) t += ' Gemiddeld ' + spokenPace(p) + '.' + (this.ascent >= 10 ? ' ' + Math.round(this.ascent) + ' hoogtemeters omhoog.' : '');
    if (this.step && this.step.toKm && this.plannedKm && this.opts.verbose && km >= 2){ const left = this.step.toKm - this.dist/1000; if (left > 0.5) t += ' Nog ' + String(Math.round(left*10)/10).replace('.', ',') + ' kilometer.'; }
    this.say(t, 'lo');
  }
  /* --- meetwaarden --- */
  pace(){ // tempo van de laatste ~25 seconden in sec/km
    const r = this.recent;
    if (r.length < 2) return null;
    const a = r[0], b = r[r.length-1], dsec = (b.t - a.t)/1000, dm = b.d - a.d;
    if (dsec < 8 || dm < 5) return null;
    return dsec / (dm/1000);
  }
  avgPace(){ return this.dist > 50 ? this.el/1000/(this.dist/1000) : null; }
  _totals(){
    const s = Math.round(this.el/1000);
    let t = 'Totaal ' + spokenTime(s);
    if (this.dist > 100) t += ', ' + String(Math.round(this.dist/100)/10).replace('.', ',') + ' kilometer';
    if (this.ascent >= 10) t += ', ' + Math.round(this.ascent) + ' hoogtemeters omhoog';
    return t + '.';
  }
  status(){ this.say(this._totals() + (this.avgPace() ? ' Gemiddeld ' + spokenPace(this.avgPace()) + '.' : '') + (this.step ? ' Nu: ' + this.step.label + '.' : ''), 'hi'); }
  repeat(){ if (this.c.lastSay) this.opts.say(this.c.lastSay, 'hi'); }
  view(){ // alles wat het scherm nodig heeft
    const st = this.step, stepEl = st ? (this.el - this.stepStartEl)/1000 : 0;
    let remain = null, frac = 0;
    if (st && st.sec && !st.toKm && !st.manual){ remain = Math.max(0, st.sec - stepEl); frac = Math.min(1, stepEl/st.sec); }
    else if (st && st.toKm && this.gpsOk()){ const tot = st.toKm*1000 - this.stepStartDist; frac = tot > 0 ? Math.min(1, (this.dist - this.stepStartDist)/tot) : 0; }
    else if (st && st.sec && st.toKm){ frac = Math.min(1, stepEl/st.sec); }
    const total = this.steps.reduce((a, s) => a + (s.sec || 0), 0);
    let doneSec = 0; for (let i = 0; i < this.stepIdx && i < this.steps.length; i++) doneSec += this.steps[i].sec || 0;
    return { state:this.state, el:this.el/1000, dist:this.dist, pace:this.pace(), avgPace:this.avgPace(), ascent:this.ascent, step:st, stepIdx:this.stepIdx, stepCount:this.steps.length, remain, frac, reached:this.reachedTarget, gps:this.gpsOk(), acc:this.acc,
      progress: total ? Math.min(1, (doneSec + stepEl)/total) : 0, autoPaused:this.autoPaused };
  }
  /* --- afsluiten, bewaren, herstellen --- */
  summary(){
    const dur = Math.round(this.el/1000);
    return { sessionId: this.session.id || null, type: this.session.type || 'free', title: this.session.title || 'Vrije loop', mode:this.mode, startedAt:this.startedAt, endedAt:this.endedAt,
      dur, dist: Math.round(this.dist), ascent: Math.round(this.ascent), descent: Math.round(this.descent), splits:this.splits, track:this.track,
      avgPace: this.avgPace(), stepsDone: Math.max(0, Math.min(this.stepIdx, this.steps.length)), stepsTotal:this.steps.length, gps:this.gps && this.fixes > 0 };
  }
  snapshot(){
    return { v:1, session: { id:this.session.id, type:this.session.type, title:this.session.title, km:this.session.km, minutes:this.session.minutes, ex:this.session.ex || null }, steps:this.steps, mode:this.mode, free:this.free,
      state:this.state, el:this.el, dist:this.dist, ascent:this.ascent, descent:this.descent, stepIdx:this.stepIdx, stepStartEl:this.stepStartEl, stepStartDist:this.stepStartDist,
      kmMark:this.kmMark, lastSplitEl:this.lastSplitEl, lastSplitAsc:this.lastSplitAsc, splits:this.splits, track:this.track, startedAt:this.startedAt, altRef:this.altRef, savedAt:Date.now(),
      c:{ half:this.c.half, last1k:this.c.last1k, fuelN:this.c.fuelN, tipAt:this.c.tipAt }, reached:this.reachedTarget };
  }
  static restore(snap, opts){
    const r = new Runner(Object.assign({}, opts, { session:snap.session, steps:snap.steps, mode:snap.mode }));
    r.free = snap.free;
    ['el','dist','ascent','descent','stepIdx','stepStartEl','stepStartDist','kmMark','lastSplitEl','lastSplitAsc','splits','track','startedAt','altRef'].forEach(k => { r[k] = snap[k]; });
    r.c.half = snap.c.half; r.c.last1k = snap.c.last1k; r.c.fuelN = snap.c.fuelN; r.c.tipAt = snap.c.tipAt;
    r.reachedTarget = !!snap.reached;
    r.state = 'paused'; r.lastPt = null; r.autoPaused = false;
    return r;
  }
}

/* ---------- Spraak ---------- */
const Voice = {
  enabled:true, rate:1.0, volume:1.0, voiceURI:'', voices:[], queue:[], busy:false, ok:false, ac:null, lastSpoken:'',
  init(){
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (!this.ok) return;
    const load = () => { this.voices = speechSynthesis.getVoices() || []; if (this.onVoices) this.onVoices(); };
    load();
    try { speechSynthesis.addEventListener('voiceschanged', load); } catch(e){ speechSynthesis.onvoiceschanged = load; }
  },
  dutch(){ return this.voices.filter(v => /^nl/i.test(v.lang)); },
  pick(){
    const v = this.voices;
    return v.find(x => x.voiceURI === this.voiceURI) || v.find(x => /^nl[-_]NL/i.test(x.lang) && x.localService) || v.find(x => /^nl/i.test(x.lang)) || null;
  },
  unlock(){ // moet vanuit een tik gebeuren (iOS)
    if (!this.ok) return;
    try {
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'nl-NL'; speechSynthesis.speak(u);
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !this.ac) this.ac = new AC();
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    } catch(e){}
  },
  say(text, prio){
    this.lastSpoken = text;
    if (!this.enabled || !this.ok || !text) return;
    if (prio === 'hi'){ this.queue = []; if (this.busy) { try { speechSynthesis.cancel(); } catch(e){} this.busy = false; } }
    else if (this.queue.length >= 2 || (this.busy && this.queue.length >= 1)) return; // verouderde tips niet opstapelen
    this.queue.push(text);
    this._next();
  },
  _next(){
    if (this.busy || !this.queue.length) return;
    const text = this.queue.shift();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pick();
    if (v){ u.voice = v; u.lang = v.lang; } else u.lang = 'nl-NL';
    u.rate = this.rate; u.volume = this.volume; u.pitch = 1;
    this.busy = true;
    let done = false;
    const fin = () => { if (done) return; done = true; this.busy = false; clearTimeout(wd); setTimeout(() => this._next(), 120); };
    u.onend = fin; u.onerror = fin;
    const wd = setTimeout(fin, 3500 + text.length*110); // iOS vergeet soms onend
    try { speechSynthesis.speak(u); } catch(e){ fin(); }
  },
  stop(){ this.queue = []; this.busy = false; try { speechSynthesis.cancel(); } catch(e){} },
  beep(kind){
    if (!this.enabled && kind !== 'force') return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ac) this.ac = new AC();
      const ac = this.ac; if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain();
      const f = kind === 'go' ? 880 : kind === 'tick' ? 660 : 523;
      o.frequency.value = f; o.type = 'sine';
      const t = ac.currentTime, d = kind === 'go' ? 0.35 : 0.12;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35*this.volume, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.02);
    } catch(e){}
  }
};

/* ---------- GPS ---------- */
const Geo = {
  id:null, status:'off', last:null, onPos:null,
  supported(){ return typeof navigator !== 'undefined' && 'geolocation' in navigator; },
  probe(){ // vraagt toestemming en geeft een eerste meting terug
    return new Promise(res => {
      if (!this.supported()) return res({ ok:false, reason:'unsupported' });
      navigator.geolocation.getCurrentPosition(p => res({ ok:true, acc:p.coords.accuracy }), e => res({ ok:false, reason: e.code === 1 ? 'denied' : 'unavailable' }), { enableHighAccuracy:true, timeout:15000, maximumAge:0 });
    });
  },
  start(cb){
    this.onPos = cb; this.status = 'wait';
    if (!this.supported()) { this.status = 'unsupported'; return false; }
    this.id = navigator.geolocation.watchPosition(p => {
      this.status = 'ok';
      this.last = { lat:p.coords.latitude, lon:p.coords.longitude, alt:p.coords.altitude, acc:p.coords.accuracy, t:p.timestamp, now:Date.now() };
      cb(this.last);
    }, e => { this.status = e.code === 1 ? 'denied' : 'error'; }, { enableHighAccuracy:true, maximumAge:0, timeout:30000 });
    return true;
  },
  stop(){ if (this.id != null && this.supported()) navigator.geolocation.clearWatch(this.id); this.id = null; this.status = 'off'; }
};

/* ---------- Scherm aan / achtergrond ---------- */
const NOSLEEP_MP4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlZ0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHObWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATlzdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADABA8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAUyAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAo8AAAAKAAAAFHN0Y28AAAAAAAAAAQAAA1sAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAAACGZyZWUAAAKhbWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTIgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAXZYiEBTyYoAA/vycnJ1111111111114AAAAAGQZo4CXhG'; // 1 seconde zwarte video: houdt het scherm aan als de Wake Lock-API ontbreekt
const Awake = {
  lock:null, vid:null, aud:null, on:false, bg:false,
  async enable(opts){
    this.on = true; this.bg = !!(opts && opts.background);
    try { if ('wakeLock' in navigator){ this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch(e){ this.lock = null; }
    if (!this.lock) this._video();
    if (this.bg) this._audio();
  },
  _video(){
    if (this.vid || !NOSLEEP_MP4) return;
    const v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; v.loop = true;
    v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:.01;pointer-events:none';
    v.src = 'data:video/mp4;base64,' + NOSLEEP_MP4;
    document.body.appendChild(v); v.play().catch(() => {}); this.vid = v;
  },
  _audio(){ // stille geluidslus: houdt de app levend op een vergrendeld scherm en geeft oordopjes/lockscreen bediening
    if (this.aud) return;
    const a = document.createElement('audio'); a.loop = true; a.setAttribute('playsinline', '');
    a.src = silentWav(); a.volume = 0.01; document.body.appendChild(a); a.play().catch(() => {}); this.aud = a;
  },
  async reacquire(){
    if (!this.on) return;
    try { if (!this.lock && 'wakeLock' in navigator && document.visibilityState === 'visible') this.lock = await navigator.wakeLock.request('screen'); } catch(e){}
    if (this.vid) this.vid.play().catch(() => {});
    if (this.aud) this.aud.play().catch(() => {});
  },
  disable(){
    this.on = false;
    try { if (this.lock) this.lock.release(); } catch(e){}
    this.lock = null;
    if (this.vid){ this.vid.remove(); this.vid = null; }
    if (this.aud){ this.aud.pause(); this.aud.remove(); this.aud = null; }
    try { if ('mediaSession' in navigator){ navigator.mediaSession.playbackState = 'none'; ['play','pause','nexttrack','previoustrack'].forEach(a => navigator.mediaSession.setActionHandler(a, null)); } } catch(e){}
  }
};
function silentWav(){
  const rate = 8000, n = rate; // 1 seconde stilte
  const buf = new ArrayBuffer(44 + n*2), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o+i, s.charCodeAt(i)); };
  w(0,'RIFF'); dv.setUint32(4, 36 + n*2, true); w(8,'WAVE'); w(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
  dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); w(36,'data'); dv.setUint32(40,n*2,true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i*2, (i % 2 ? 1 : -1), true); // bijna-stilte (±1) zodat iOS het als geluid ziet
  let bin = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}
function setMediaSession(title, handlers){
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist:'Trailplanner', album:'Live coach' });
    navigator.mediaSession.playbackState = 'playing';
    Object.keys(handlers).forEach(a => { try { navigator.mediaSession.setActionHandler(a, handlers[a]); } catch(e){} });
  } catch(e){}
}

/* ---------- GPX ---------- */
function toGpx(sum, name){
  const t0 = sum.startedAt || Date.now();
  const pts = (sum.track || []).map(p => '<trkpt lat="' + p[0] + '" lon="' + p[1] + '">' + (p[2] != null ? '<ele>' + p[2] + '</ele>' : '') + '<time>' + new Date(t0 + p[3]*1000).toISOString() + '</time></trkpt>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Trailplanner" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + String(name || 'Training').replace(/[<&>]/g, '') + '</name><trkseg>' + pts + '</trkseg></trk></gpx>';
}

if (typeof module !== 'undefined') module.exports = { Runner, strengthSteps, fmtClock, fmtPaceSec, spokenTime, spokenPace, haversine, toGpx };
