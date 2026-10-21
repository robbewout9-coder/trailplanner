/* ============ ENGINE: schema, wetenschap, herplanning (geen DOM) ============ */
const DAG = 86400000;
const WD = ['ma','di','wo','do','vr','za','zo'];
const WD_LANG = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'];
const MAANDEN = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];

function isoToDate(s){ return new Date(s + 'T00:00:00Z'); }
function dateToIso(d){ return d.toISOString().slice(0,10); }
function addDays(s,n){ return dateToIso(new Date(isoToDate(s).getTime() + n*DAG)); }
function diffDays(a,b){ return Math.round((isoToDate(a) - isoToDate(b)) / DAG); }
function dow(s){ return (isoToDate(s).getUTCDay() + 6) % 7; }
function mondayOf(s){ return addDays(s, -dow(s)); }
function todayIso(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function fmtDate(s, opt){
  const d = isoToDate(s);
  const o = opt || {};
  const dag = o.short ? WD[dow(s)] : WD_LANG[dow(s)];
  const txt = d.getUTCDate() + ' ' + (o.short ? MAANDEN[d.getUTCMonth()].slice(0,3) : MAANDEN[d.getUTCMonth()]);
  return o.noDay ? txt : dag + ' ' + txt;
}
const r05 = x => Math.round(x*2)/2;
const r10 = x => Math.round(x/10)*10;
function fmtMin(m){
  m = Math.round(m);
  if (m < 60) return m + ' min';
  const h = Math.floor(m/60), r = m % 60;
  return h + 'u' + (r ? String(r).padStart(2,'0') : '');
}
function fmtKm(k){ return (Math.round(k*10)/10).toString().replace('.', ',') + ' km'; }
function num1(x){ return (Math.round(x*10)/10).toString().replace('.', ','); }

/* ============ RICHTLIJNEN (constanten met bronvermelding in de Uitleg) ============ */
const GROWTH = 0.10;          // max. ~10% stijging per belastingsweek (vuistregel; zie Nielsen 2014)
const RECOVERY = 0.70;        // herstelweek: ~30% minder volume
const MAX_LR_MIN = 210;       // lange duurloop zelden langer dan ~3,5 uur
const SHARE_MAX = {2:0.60, 3:0.50, 4:0.45, 5:0.40};
const SHARE_IDEAL = {2:0.60, 3:0.50, 4:0.42, 5:0.38};
const HILL_FACTOR = {heuvels:1, klimmetjes:0.6, vlak:0.3, geen:0};
const LEVELS = {
  beginner:  { label:'Beginner',  maxRuns:4, defRuns:3, lrFrac:0.60, pace:7.5, minV0:8,  minLR0:4, minRun:2.5 },
  gevorderd: { label:'Gevorderd', maxRuns:5, defRuns:4, lrFrac:0.80, pace:6.0, minV0:15, minLR0:8, minRun:3 }
};
/* Hartslagzones als % van HRmax, grofweg aansluitend op het drie-zonesmodel van Seiler:
   Z1-Z2 onder de eerste ventilatiedrempel (~75-80% HRmax), Z4 rond de tweede drempel (~85-92%). */
const HR_ZONES = [
  { z:'Z1', lo:0.50, hi:0.65, rpe:'1–2',  use:'Herstel, warming-up, cooldown' },
  { z:'Z2', lo:0.65, hi:0.78, rpe:'3–4',  use:'Rustige duurloop, lange duurloop (praattempo)' },
  { z:'Z3', lo:0.78, hi:0.85, rpe:'5',    use:'Stevig doorlopen: de "grijze zone", zo min mogelijk' },
  { z:'Z4', lo:0.85, hi:0.92, rpe:'6–7',  use:'Tempoloop (drempel)' },
  { z:'Z5', lo:0.92, hi:1.00, rpe:'8–10', use:'Korte, harde klimmen' }
];
const TYPES = {
  long:     { label:'Lange duurloop',   code:'L', rpe:'4–5',           zone:'Z2 (Z3 op het eind)', z:[0.65,0.80], color:'long' },
  hills:    { label:'Heuveltraining',   code:'H', rpe:'7–8 op de klim',zone:'Z4–Z5 op de klim (RPE leidend)', z:null, color:'hills' },
  tempo:    { label:'Tempoloop',        code:'T', rpe:'6–7',           zone:'Z4', z:[0.85,0.90], color:'tempo' },
  easy:     { label:'Rustige duurloop', code:'R', rpe:'3–4',           zone:'Z2', z:[0.65,0.78], color:'easy' },
  shakeout: { label:'Activatieloop',    code:'A', rpe:'2–3',           zone:'Z1–Z2', z:[0.55,0.72], color:'easy' },
  strength: { label:'Krachttraining',   code:'K', rpe:'6–7',           zone:'', z:null, color:'str' },
  race:     { label:'Wedstrijd',        code:'★', rpe:'5–6',           zone:'Z2–Z4', z:[0.70,0.88], color:'race' }
};
const KEY_TYPES = ['long','hills','tempo'];
const isRunType = t => t !== 'strength';
/* Relatieve inspanning (0-1) voor de trainingsgrafiek en voor de intensiteitsverdeling */
const EFFORT = { warm:0.35, steady:0.5, long:0.55, tempo:0.82, work:0.95, rec:0.28, walk:0.15, stride:0.9, cool:0.3, ex:0.6, rest:0.1, sprint:1 };

function estMin(km, vert, pace){ return km*pace + vert/10; } // Naismith: ~1 min per 10 hm extra
function hrMax(cfg){
  if (!cfg) return null;
  if (cfg.hrmax) return cfg.hrmax;
  return cfg.age ? 208 - 0.7*cfg.age : null; // Tanaka e.a. (2001); afwijking ± 10 slagen is normaal
}
function hrRange(cfg, type){
  const m = hrMax(cfg), t = TYPES[type];
  if (!m || !t || !t.z) return null;
  return [Math.round(m*t.z[0]), Math.round(m*t.z[1])];
}

/* ============ SESSIE-OPBOUW (dagen en rollen) ============ */
function rolesFor(R, level, noTempo){
  let r;
  if (R <= 2) r = ['long','hills'];
  else if (R === 3) r = ['long','hills','easy'];
  else if (R === 4) r = level === 'beginner' ? ['long','hills','easy','easy'] : ['long','hills','tempo','easy'];
  else r = ['long','hills','tempo','easy','easy'];
  return noTempo ? r.map(x => x === 'tempo' ? 'easy' : x) : r;
}
/* Kies de looppdagen en geef de zware rollen een plek zodat zware dagen (lang, heuvels, tempo) nooit
   aaneengesloten zijn als dat te vermijden is, en de dag voor de lange loop rustig blijft. */
function planDays(avail, longDow, R, roles){
  const circ = (a,b) => { const d = Math.abs(a-b); return Math.min(d, 7-d); };
  const others = avail.filter(d => d !== longDow);
  const need = Math.max(0, R - 1);
  const hardRoles = roles.filter(r => r === 'hills' || r === 'tempo');
  const combos = [];
  (function rec(i, cur){
    if (cur.length === need){ combos.push(cur.slice()); return; }
    for (let j = i; j < others.length; j++){ cur.push(others[j]); rec(j+1, cur); cur.pop(); }
  })(0, []);
  let best = null, bestScore = -Infinity;
  combos.forEach(days => {
    const perms = [];
    (function p(i, used){
      if (i === hardRoles.length){ perms.push(used.slice()); return; }
      days.forEach(d => { if (used.includes(d)) return; used.push(d); p(i+1, used); used.pop(); });
    })(0, []);
    perms.forEach(pm => {
      const hard = [longDow].concat(pm), all = [longDow].concat(days);
      let hg = 7, sum = 0, rg = 7;
      for (let i = 0; i < hard.length; i++) for (let j = i+1; j < hard.length; j++){ const c = circ(hard[i], hard[j]); hg = Math.min(hg, c); sum += Math.min(c, 3); }
      for (let i = 0; i < all.length; i++) for (let j = i+1; j < all.length; j++) rg = Math.min(rg, circ(all[i], all[j]));
      let pen = 0;
      if (pm.includes((longDow + 6) % 7)) pen += 1;
      if (pm.includes((longDow + 1) % 7)) pen += 0.5;
      const score = Math.min(hg, 3) * 10000 - pen * 1000 + Math.min(rg, 2) * 100 + sum;
      if (score > bestScore){ bestScore = score; best = { days, pm }; }
    });
  });
  const runDays = [longDow].concat(best ? best.days : []).sort((a,b) => a-b);
  const map = {}; map[longDow] = 'long';
  (best ? best.days : []).forEach(d => { map[d] = 'easy'; });
  if (best) hardRoles.forEach((r, i) => { map[best.pm[i]] = r; });
  return { runDays, roleMap: map };
}
function pickStrengthDays(avail, runDays, longDow, n, runMap){
  const out = [];
  const circ = (a,b) => { const d = Math.abs(a-b); return Math.min(d, 7-d); };
  const open = avail.filter(d => !runDays.includes(d));
  const dayBeforeLong = (longDow + 6) % 7;
  while (out.length < n){
    let best = null, bs = -99;
    open.forEach(d => {
      if (out.some(o => o.dow === d)) return;
      let s = Math.min(circ(d,longDow), ...out.map(o => circ(o.dow,d)));
      if (d === dayBeforeLong) s -= 2;
      if (s > bs){ bs = s; best = d; }
    });
    if (best === null) break;
    out.push({dow:best, combo:false});
  }
  // overige krachtsessies koppelen aan een looptraining: eerst rustige loopdagen, dan heuvels/tempo (na de run)
  const pri = { easy:0, hills:1, tempo:2 };
  while (out.length < n){
    const cand = Object.keys(runMap).map(Number)
      .filter(d => pri[runMap[d]] !== undefined && !out.some(o => o.dow === d) && !(runMap[d] !== 'easy' && d === dayBeforeLong))
      .sort((x, y) => pri[runMap[x]] - pri[runMap[y]] || x - y);
    if (!cand.length) break;
    out.push({dow:cand[0], combo:true, after: runMap[cand[0]] !== 'easy'});
  }
  return out;
}

function taperFactors(total){
  return {1:[0.6], 2:[0.75,0.5], 3:[0.8,0.6,0.4]}[Math.min(total,3)] || [];
}
function taperLR(total){
  return {1:[0.5], 2:[0.65,0.45], 3:[0.7,0.5,0.35]}[Math.min(total,3)] || [];
}

/* ============ KRACHTPROGRAMMA (fase-gebonden, loopspecifiek) ============ */
/* Basis: techniek en spieruithoudingsvermogen. Opbouw: zwaarder, minder herhalingen (Blagrove 2018, Balsalobre 2016).
   Taper: volume omlaag, intensiteit blijft licht-vlot. Excentrisch werk (zakken van een trede, kuitheffen) bereidt op afdalingen voor. */
function homeProgram(phase, variant){
  const E = (n, sets, reps, rest, note, o) => Object.assign({ n, sets, reps, rest, note: note || '' }, o || {});
  const hold = (n, sets, sec, rest, note) => E(n, sets, 0, rest, note, { hold: sec });
  if (phase === 'taper') return variant === 0
    ? [E('Squat (eigen gewicht)', 2, '8', 45, 'Vlot omhoog.'), E('Step-up op een stoel of trap', 2, '6 per been', 45), E('Kuitheffen op een trede', 2, '10', 45, 'Traag zakken.'), hold('Plank', 2, 30, 45)]
    : [E('Reverse lunge', 2, '6 per been', 45), E('Eenbenige Roemeense deadlift', 2, '6 per been', 45, 'Zonder gewicht, evenwicht.'), E('Heupbrug', 2, '10', 45), hold('Zijplank', 2, 25, 45, 'Per zijde.')];
  if (phase === 'build') return variant === 0
    ? [E('Squat met pauze onderin', 4, '12', 75, 'Zak in 3 seconden, 2 seconden pauze onderin, krachtig omhoog. Eventueel met een rugzak met boeken.'),
       E('Step-up met rugzak', 3, '10 per been', 75, 'Hoge stoel of trede: bergopspecifiek.'),
       E('Eenbenige Roemeense deadlift', 3, '8–10 per been', 60, 'Met een gevulde rugzak voor extra gewicht.'),
       E('Eenbenig kuitheffen op een trede', 3, '10', 60, 'Omhoog in 1 seconde, zakken in 3 seconden.'),
       hold('Plank', 3, 50, 45)]
    : [E('Bulgarian split squat', 3, '10 per been', 75, 'Achterste voet op een stoel.'),
       E('Excentrische step-down', 3, '8 per been', 60, 'Zak in 4 seconden van een trede: voorbereiding op afdalingen.'),
       E('Eenbenige heupbrug', 3, '10 per been', 60),
       E('Squatsprongen', 3, '8', 75, 'Explosief omhoog, zacht landen.'),
       hold('Zijplank', 3, 40, 45, 'Per zijde.')];
  return variant === 0
    ? [E('Squat (eigen gewicht)', 3, '12', 45, 'Zak in 3 seconden, borst omhoog.'), E('Step-up op een stoel of trap', 3, '10 per been', 45), E('Eenbenige Roemeense deadlift', 2, '10 per been', 45, 'Zonder gewicht, rechte rug.'), E('Kuitheffen op een trede', 3, '12', 45, 'Traag zakken, 3 seconden.'), hold('Plank', 3, 30, 30)]
    : [E('Reverse lunge', 3, '10 per been', 45), E('Heupbrug', 3, '12', 45, 'Knijp bovenin je billen.'), E('Kuitheffen (gebogen knie)', 3, '12', 45), E('Pogo-sprongetjes', 2, '20', 45, 'Kleine, snelle sprongetjes op de voorvoet.'), hold('Zijplank', 3, 25, 30, 'Per zijde.')];
}
function strengthProgram(phase, variant, beg, home){
  if (home) return homeProgram(phase, variant);
  const E = (n, sets, reps, rest, note, o) => Object.assign({ n, sets, reps, rest, note: note || '' }, o || {});
  const hold = (n, sets, sec, rest, note) => E(n, sets, 0, rest, note, { hold: sec });
  if (phase === 'taper'){
    return variant === 0
      ? [E('Goblet squat', 2, '6', 60, 'Licht en explosief omhoog, rustig omlaag.'), E('Step-up op een bank', 2, '6 per been', 60, 'Vlot en gecontroleerd.'), E('Kuitheffen (rechte knie)', 2, '8', 45, 'Traag zakken, 3 seconden.'), hold('Plank', 2, 30, 45, 'Strak lichaam.')]
      : [E('Reverse lunge', 2, '6 per been', 60, 'Licht en vlot.'), E('Eenbenige Roemeense deadlift', 2, '6 per been', 60, 'Rechte rug, heupen naar achteren.'), E('Heupbrug', 2, '8', 45, 'Knijp bovenin je billen.'), hold('Zijplank', 2, 25, 45, 'Per zijde.')];
  }
  if (phase === 'build'){
    const reps = beg ? '8–10' : '5–6', sets = beg ? 3 : 4, rest = beg ? 90 : 120;
    return variant === 0
      ? [E('Squat (goblet of barbell)', sets, reps, rest, 'Zwaar genoeg dat je nog 2 herhalingen over hebt (RPE 8). Traag zakken, krachtig omhoog.'),
         E('Step-up met gewicht', 3, beg ? '8 per been' : '6 per been', 90, 'Hoge trede: bergopspecifiek. Duw met het bovenste been.'),
         E('Eenbenige Roemeense deadlift', 3, beg ? '8 per been' : '6–8 per been', 90, 'Hamstrings en billen: bescherming bij afdalen.'),
         E('Kuitheffen met gewicht (rechte knie)', 3, '8–10', 75, 'Omhoog in 1 seconde, zakken in 3 seconden.'),
         hold('Plank', 3, beg ? 45 : 60, 45, 'Strak lichaam, geen holle rug.')]
      : [E('Split squat (bulgarian)', 3, beg ? '8 per been' : '6–8 per been', 90, 'Achterste voet op een bank.'),
         E('Excentrische step-down', 3, '8 per been', 75, 'Zak in 4 seconden van een trede: voorbereiding op lange afdalingen.'),
         E('Heupbrug met gewicht', 3, beg ? '10' : '8', 75, 'Bovenin 1 seconde vasthouden.'),
         E('Kuitheffen (gebogen knie, soleus)', 3, '10', 60, 'Zittend of met licht gebogen knie.'),
         beg ? E('Pogo-sprongetjes', 2, '15', 45, 'Kleine, snelle sprongetjes op de voorvoet, korte grondcontact.')
             : E('Box jumps of bounds', 3, '5', 90, 'Explosief, rustig landen. Plyometrie verbetert loopeconomie.'),
         hold('Zijplank', 3, 40, 45, 'Per zijde.')];
  }
  // basis
  return variant === 0
    ? [E('Goblet squat', 3, '10–12', 60, 'Traag zakken (3 seconden), borst omhoog.'),
       E('Step-up op een bank', 3, '8–10 per been', 60, 'Hele voet op de bank, duw door de hiel.'),
       E('Eenbenige Roemeense deadlift', 2, '8–10 per been', 60, 'Rechte rug, heup naar achteren, evenwicht.'),
       E('Kuitheffen (rechte knie)', 3, '12', 45, 'Traag zakken, 3 seconden: sterke achillespezen.'),
       hold('Plank', 3, 30, 30, 'Stevig, rustig ademen.')]
    : [E('Reverse lunge', 3, '8–10 per been', 60, 'Stap naar achteren, romp rechtop.'),
       E('Heupbrug (eenbenig als het makkelijk gaat)', 3, '10–12', 60, 'Knijp bovenin je billen.'),
       E('Kuitheffen (gebogen knie, soleus)', 3, '12', 45, 'Zittend of met licht gebogen knie.'),
       beg ? E('Zijwaartse stap met band', 2, '10 per kant', 45, 'Heupstabiliteit, knieën naar buiten.') : E('Pogo-sprongetjes', 2, '20', 45, 'Kleine, snelle sprongetjes op de voorvoet.'),
       hold('Zijplank', 3, 25, 30, 'Per zijde.')];
}
function strengthMinutes(ex){
  let sec = 300; // warming-up en mobiliteit
  ex.forEach(e => { const w = e.hold || 3.5 * (parseInt(e.reps) || 8) * (/per been/.test(e.reps) ? 2 : 1); sec += e.sets * (w + e.rest); });
  return Math.round(sec / 60);
}

/* ============ SESSIE-STAPPEN (voor de live coach en voor de grafiek) ============ */
function stp(k, sec, label, say, o){ return Object.assign({ k, sec:Math.round(sec), label, say:say || '' }, o || {}); }
function stepsMin(steps){ return steps.reduce((a,s) => a + (s.sec || 0), 0) / 60; }
function stepsKm(steps, pace){
  let km = 0;
  steps.forEach(s => {
    const m = (s.sec || 0) / 60;
    const f = s.k === 'tempo' ? 0.9 : s.k === 'walk' ? 1.6 : s.k === 'stride' || s.k === 'sprint' ? 0.5 : 1;
    km += m / (pace * f);
  });
  return km;
}
function hillSets(n, cm, label, upSay){
  const out = [];
  for (let i = 1; i <= n; i++){
    out.push(stp('work', cm*60, label + ' ' + i + ' van ' + n, upSay.replace('{i}', i).replace('{n}', n), { set:i, of:n }));
    if (i < n) out.push(stp('rec', cm*60, 'Herstel', 'Rustig terug naar beneden en herstel.', { set:i, of:n }));
  }
  return out;
}

function sessionMeta(ctx){
  // ctx: {role,type,km,vert,cfg,loadIdx,kind,late,combo,k,weekNo,phase}
  const { cfg, type, km, loadIdx, kind } = ctx;
  const lv = LEVELS[cfg.level];
  const pace = cfg.pace;
  const beg = cfg.level === 'beginner';
  const blocks = [], tips = [];
  let title = TYPES[type].label, vert = ctx.vert || 0, minutes = 0, kmOut = km, steps = [];
  const light = kind === 'recovery' || kind === 'taper' || kind === 'race';
  let hardMin = 0, label = null;

  if (type === 'easy'){
    const min = estMin(km, vert, pace);
    steps = [ stp('steady', min*60, 'Rustig lopen', 'Rustige duurloop van ' + num1(km) + ' kilometer. Loop op praattempo. Je kunt hele zinnen praten.', { toKm:km, fx:'easy' }) ];
    blocks.push({l:'Opzet', t: fmtKm(km) + ' op gesprekstempo (RPE 3–4): je kunt hele zinnen praten. Tempo is bijzaak, tijd op de benen telt.'});
    if (beg) blocks.push({l:'Pauzes', t:'Heb je pauzes nodig? Wissel bijvoorbeeld 5 minuten lopen af met 1 minuut wandelen (loop-wandelmethode). Dat is een bewezen methode en telt volledig mee. De live coach kan dit voor je aankondigen.'});
    blocks.push({l:'Terrein', t:'Kies waar mogelijk onverhard of glooiend terrein, zodat voeten en enkels aan trail wennen.'});
    tips.push('Te hard lopen op rustige dagen is de meest gemaakte fout: houd het echt rustig. Dat is wat het polariserende patroon werkt.');
  }
  if (type === 'shakeout'){
    const w0 = beg ? 10 : 15, c0 = beg ? 3 : 4;
    steps = [ stp('warm', w0*60, 'Heel rustig lopen', 'Activatieloop. Eerst ' + w0 + ' minuten heel rustig lopen.', { fx:'easy' }) ];
    for (let i = 1; i <= 4; i++){
      steps.push(stp('stride', 20, 'Versnelling ' + i + ' van 4', 'Versnelling ' + i + ' van 4. Vlot en ontspannen, geen sprint.', { set:i, of:4 }));
      steps.push(stp('rec', 70, 'Uitwandelen', 'Rustig uitlopen of wandelen.', { set:i, of:4 }));
    }
    steps.push(stp('cool', c0*60, 'Rustig uitlopen', 'Laatste minuten rustig uitlopen.', { fx:'easy' }));
    blocks.push({l:'Opzet', t: w0 + ' minuten heel rustig lopen, daarna 4 × 20 seconden vlot versnellen met ruime pauze (ongeveer 70 seconden uitwandelen). Doel: de benen wakker maken, niet moe worden.'});
    tips.push('Leg je spullen vandaag al klaar en eet koolhydraatrijk.');
  }
  if (type === 'hills'){
    const flat = cfg.hills === 'geen' || !!ctx.flat;   // geen heuvel of trap beschikbaar: intervallen op vlak terrein
    if (flat) label = 'Intervaltraining';
    const intro = kind === 'build' && loadIdx < 2 && !ctx.forceMin;
    const budget = Math.max(0, km) * pace * 1.1; // beschikbare minuten volgens het weekvolume
    let wu = beg ? 10 : 15, cd = beg ? 5 : 10;
    if (intro){
      const n = beg ? 6 : 8;
      const burst = flat ? 20 : 10, recSec = flat ? 70 : 90, nm = flat ? 'Versnelling' : 'Sprint';
      if (wu + n * (burst + recSec) / 60 + cd > budget){ wu = 10; cd = 5; }
      title = flat ? 'Versnellingen (introductie)' : 'Heuvelsprints (introductie)';
      steps = [ stp('warm', wu*60, 'Warming-up', (flat ? 'Versnellingen, introductie. ' : 'Heuveltraining, introductie. ') + 'Eerst ' + wu + ' minuten heel rustig inlopen.', { fx:'easy' }) ];
      for (let i = 1; i <= n; i++){
        steps.push(stp(flat ? 'stride' : 'sprint', burst, nm + ' ' + i + ' van ' + n, nm + ' ' + i + ' van ' + n + (flat ? '. Vlot en ontspannen, geen sprint.' : '. Snel maar beheerst, bergop!'), { set:i, of:n }));
        steps.push(stp('rec', recSec, flat ? 'Uitlopen' : 'Terugwandelen', flat ? 'Rustig uitlopen.' : 'Wandel rustig terug naar beneden.', { set:i, of:n }));
      }
      steps.push(stp('cool', cd*60, 'Rustig uitlopen', 'Laatste deel: rustig uitlopen.', { fx:'easy' }));
      vert = flat ? 0 : r10(n * 2);
      hardMin = n * burst / 60;
      blocks.push({l:'Warming-up', t: wu + ' minuten heel rustig lopen of mobiel inlopen.'});
      blocks.push({l:'Hoofdset', t: flat
        ? n + ' × 20 seconden vlot versnellen op vlak terrein (snel maar ontspannen, geen sprint), met 70 seconden rustig uitlopen. Dit prikkelt kracht en looptechniek zonder je zwaar te belasten, en bouwt op naar langere intervallen.'
        : n + ' × 8–10 seconden sprinten op een steile helling (6–10%), snel maar beheerst, met 90 seconden terugwandelen. Korte heuvelsprints trainen kracht en pezen met weinig belasting op je stofwisseling. Zo bouw je veilig op naar langere klimmen.'});
      blocks.push({l:'Cooldown', t: cd + ' minuten rustig uitlopen.'});
      tips.push('Eerst kracht en techniek, dan pas langere intervallen: zo went je lichaam geleidelijk aan de prikkel.');
    } else {
      const j = Math.max(0, loadIdx - 2);
      const cmMin = beg ? 1.5 : 2;
      let climbMin = beg ? Math.min(2.5, 1.5 + 0.25*j) : Math.min(3.5, 2 + 0.25*j);
      let n = beg ? Math.min(6, 4 + Math.floor(j/2)) : Math.min(8, 5 + Math.floor(j/2));
      if (light) n = Math.max(3, Math.round(n*0.6));
      if (ctx.forceMin){ n = 3; climbMin = cmMin; }
      let cm = Math.round(climbMin*4)/4;
      const tot = () => wu + (2*n - 1) * cm + cd;
      while (n > 3 && tot() > budget) n--;
      if (tot() > budget){ wu = 10; cd = 5; }
      while (cm > cmMin && tot() > budget) cm -= 0.25;
      const vam = beg ? 9 : 12; // hoogtemeters per minuut klimmen
      vert = flat ? 0 : r10(n * cm * vam);
      if (flat) title = 'Intervaltraining (vlak)';
      const what = flat ? 'Interval' : 'Klim';
      steps = [ stp('warm', wu*60, 'Warming-up', (flat ? 'Intervaltraining. ' : 'Heuveltraining. ') + 'Eerst ' + wu + ' minuten heel rustig inlopen.', { fx:'easy' }) ]
        .concat(hillSets(n, cm, what, what + ' {i} van {n}. ' + (flat ? 'Stevig maar beheerst, vlotte pasjes, rechte houding.' : 'Hard maar beheerst, korte stappen, rechte houding, beuk niet.')))
        .concat([ stp('cool', cd*60, 'Rustig uitlopen', 'Laatste ' + what.toLowerCase() + ' gehad. Nu ' + cd + ' minuten rustig uitlopen.', { fx:'easy' }) ]);
      hardMin = n * cm;
      blocks.push({l:'Warming-up', t: wu + ' minuten heel rustig lopen of mobiel inlopen.'});
      blocks.push({l:'Hoofdset', t: n + ' × ' + String(cm).replace('.',',') + ' minuten ' + (flat ? 'stevig op vlak terrein of een loopband' : 'bergop') + ' op RPE 7–8 (hard maar beheerst, ongeveer 5–10 km-inspanning). ' + (flat ? 'Herstel daarna even lang met rustig lopen.' : 'Loop rustig terug naar beneden en herstel even lang als de klim duurde.')});
      blocks.push({l:'Cooldown', t: cd + ' minuten rustig uitlopen.'});
      tips.push(flat ? 'Houd de inspanning gelijk bij elk interval: het laatste interval moet net zo vlot zijn als het eerste.' : 'Loop op gevoel: de hartslag loopt bergop achter op je inspanning, RPE is hier betrouwbaarder.');
    }
    if (!flat && cfg.hills !== 'heuvels') blocks.push({l:'Geen echte heuvel?', t:'Gebruik een viaduct, dijk, trap of een loopband op 6–8% helling. De prikkel op de kuiten en quadriceps is vergelijkbaar.'});
  }
  if (type === 'tempo'){
    const t = ctx.forceMin ? 10 : Math.max(10, Math.min(30, Math.round((km - 3.5) * pace * 0.85 / 5) * 5));
    let wu = beg ? 10 : 15, cd = beg ? 5 : 10;
    if (wu + t + cd > Math.max(0, km) * pace * 1.1){ wu = 10; cd = 5; }
    steps = [ stp('warm', wu*60, 'Warming-up', 'Tempoloop. Eerst ' + wu + ' minuten rustig inlopen.', { fx:'easy' }),
              stp('tempo', t*60, 'Tempoblok', t + ' minuten tempo. Comfortabel hard: je kunt nog enkele woorden zeggen, geen zinnen. Probeer de inspanning gelijk te houden.', { hr:true }),
              stp('cool', cd*60, 'Rustig uitlopen', 'Tempo klaar. Loop ' + cd + ' minuten rustig uit.', { fx:'easy' }) ];
    hardMin = t;
    blocks.push({l:'Warming-up', t: wu + ' minuten rustig lopen.'});
    blocks.push({l:'Hoofdset', t: t + ' minuten aaneen op RPE 6–7: comfortabel hard, je kunt nog enkele woorden zeggen maar geen zinnen.'});
    blocks.push({l:'Cooldown', t: cd + ' minuten rustig uitlopen.'});
    tips.push('Je tempo-inspanning mag ook licht heuvelachtig zijn; houd de inspanning gelijk, niet het tempo.');
  }
  if (type === 'long'){
    const min = estMin(km, vert, pace);
    const first = Math.min(20, Math.max(10, Math.round(min * 0.15)));
    steps = [ stp('warm', first*60, 'Heel rustig beginnen', 'Lange duurloop van ' + num1(km) + ' kilometer. De eerste ' + first + ' minuten heel rustig. Laat je niet meeslepen.', { fx:'easy' }),
              stp('steady', Math.max(60, (min - first)*60), 'Constant doorlopen', 'Nu rustig doorlopen op een constante inspanning. Wandel de steile stukken.', { toKm:km, fx:'long' }) ];
    blocks.push({l:'Opzet', t: fmtKm(km) + ': eerste 15–20 minuten heel rustig, daarna constant op RPE 4–5. Streef naar tijd op de benen op trailterrein.'});
    blocks.push({l:'Klimmen', t:'Wandel (power hiking) zodra het stijl wordt of je ademhaling uit de hand loopt. Handen op de bovenbenen, korte stappen. Dat bespaart energie en is in trailwedstrijden gebruikelijk.'});
    blocks.push({l:'Dalen', t:'Korte, snelle pasjes, blik enkele meters vooruit, ontspannen schouders. Afdalen belast de spieren excentrisch; bouw het geleidelijk op.'});
    if (min > 75) blocks.push({l:'Voeding', t:'Duurt je training langer dan ongeveer 75–90 minuten: oefen 30–60 g koolhydraten per uur (gel, dadels, sportdrank), bij meer dan 2,5 uur desgewenst tot 90 g per uur als je maag dat went. Drink naar dorst. Probeer dit uit in training, niet pas in de wedstrijd.'});
    tips.push('Draag dezelfde schoenen, vest en voeding als je op wedstrijddag gebruikt.');
  }
  if (type === 'strength'){
    const phase = kind === 'taper' ? 'taper' : (ctx.late && kind === 'build' ? 'build' : 'base');
    const variant = ((ctx.weekNo || 0) + (ctx.role === 'str2' ? 1 : 0)) % 2;
    const home = !!(ctx.home || cfg.strengthHome);
    const ex = strengthProgram(phase, variant, beg, home);
    minutes = strengthMinutes(ex);
    const lbl = { base:'Basis: techniek en volume', build:'Opbouw: zwaarder', taper:'Afbouw: licht en vlot' }[phase];
    title = 'Krachttraining ' + (variant ? 'B' : 'A') + ' (' + lbl.split(':')[0].toLowerCase() + (home ? ', thuis' : '') + ')';
    blocks.push({l:'Doel', t: lbl + '. ' + (phase === 'build' ? 'Zwaarder werken met minder herhalingen verbetert je loopeconomie en pezen. Laat ongeveer 2 herhalingen in reserve.' : phase === 'taper' ? 'Houd je kracht vast zonder spierpijn. Niet tot falen gaan.' : 'Leer de bewegingen goed en bouw spieruithoudingsvermogen op.')});
    blocks.push({l:'Warming-up', t:'5 minuten: heupcirkels, beenzwaaien, lichte squats en kuitheffen.'});
    blocks.push({l:'Oefeningen', t: ex.map(e => e.n + ' ' + e.sets + ' × ' + (e.hold ? e.hold + ' sec' : e.reps)).join(' · ') + '.'});
    blocks.push({l:'Rust', t:'Zware oefeningen: 90–120 seconden rust. Lichtere oefeningen: 45–75 seconden.'});
    if (ctx.combo) blocks.push({l:'Combineren', t: ctx.after ? 'Je hebt geen aparte dag over: doe dit na je looptraining (liefst een paar uur later, bijvoorbeeld in de avond). Zo blijven je rustige dagen echt rustig.' : 'Je hebt geen aparte dag over: doe dit na je rustige loop of op een ander moment van de dag, nooit vlak voor een zware training.'});
    tips.push('Het langzaam laten zakken (excentrisch) bereidt je quadriceps en kuiten voor op lange afdalingen en beschermt tegen blessures.');
    return { title, km:0, vert:0, minutes, blocks, tips, ex, steps:null, hardMin:0, phase, label:null };
  }
  if (type === 'race'){
    title = cfg.name || 'Wedstrijd';
    kmOut = cfg.distance; vert = cfg.vert;
    const min = estMin(kmOut, vert, pace);
    steps = [ stp('steady', min*60, 'Wedstrijd', 'Wedstrijd van ' + num1(kmOut) + ' kilometer. De eerste vijf kilometer bewust rustiger dan het voelt. Succes!', { toKm:kmOut, fx:'race' }) ];
    blocks.push({l:'Start', t:'De eerste 5 km bewust trager dan je goed voelt. Wie te snel start, betaalt dat op de laatste klimmen.'});
    blocks.push({l:'Klimmen en dalen', t:'Wandel steile stukken, bespaar je benen voor het einde en daal gecontroleerd.'});
    blocks.push({l:'Eten en drinken', t:'Begin na ongeveer 45 minuten en neem daarna elke 30–45 minuten iets: 30–60 g koolhydraten per uur, bij meer dan 2,5 uur wedstrijdduur desgewenst tot 90 g per uur als je dat getraind hebt. Drink naar dorst.'});
    blocks.push({l:'Dag ervoor', t:'Koolhydraatrijk eten, niets nieuws proberen, spullen klaarleggen en verplichte uitrusting controleren.'});
    minutes = Math.round(min);
    return { title, km:kmOut, vert, minutes, blocks, tips, steps, ex:null, hardMin:0, label:null };
  }
  if (steps.length && type !== 'easy' && type !== 'long'){
    minutes = Math.round(stepsMin(steps));
    kmOut = r05(stepsKm(steps, pace));
  } else {
    kmOut = Math.round((kmOut || 0) * 10) / 10;
    minutes = Math.round(estMin(kmOut, vert, pace));
  }
  return { title, km:kmOut, vert, minutes, blocks, tips, steps, ex:null, hardMin, label };
}

/* ============ SCHEMA-GENERATIE ============ */
/* Weekvolume wordt stap voor stap opgebouwd uit wat er daadwerkelijk gepland staat (inclusief warming-up en
   cooldown), zodat groei (max. ~10%), herstelweken (-30%) en taper (-20/-40/-60%) echt kloppen. */
function minKmFor(cfg, type, loadIdx){
  return sessionMeta({ role:type, type, km:0.1, vert:0, cfg, loadIdx, kind:'build', late:false, weekNo:0, forceMin:true }).km;
}
function generateSegment(cfg, from, v0, lr0){
  const lv = LEVELS[cfg.level];
  const race = cfg.raceDate;
  const raceMon = mondayOf(race);
  const raceWeekDays = diffDays(race, raceMon);
  const R = Math.max(2, Math.min(cfg.runsPerWeek, cfg.availDays.length, lv.maxRuns));
  const longDow = cfg.availDays.includes(cfg.longDow) ? cfg.longDow : cfg.availDays[cfg.availDays.length-1];
  const ratio = cfg.vert / cfg.distance;
  const hillF = HILL_FACTOR[cfg.hills] || 0.6;

  let lrIdeal = Math.max(lv.minLR0, lv.lrFrac * cfg.distance);
  while (lrIdeal > lv.minLR0 && estMin(lrIdeal, lrIdeal*ratio*0.8*hillF, cfg.pace) > MAX_LR_MIN) lrIdeal -= 0.5;
  const vIdeal = lrIdeal / SHARE_IDEAL[R];

  v0 = Math.max(lv.minV0, v0 || 0);
  lr0 = Math.max(lv.minLR0, lr0 || 0);

  const weeks = [];
  for (let m = mondayOf(from); m < raceMon; m = addDays(m, 7)) weeks.push(m);
  const T = weeks.length;
  const base = T >= 6 ? 2 : (T >= 3 ? 1 : 0);
  const taperN = Math.max(0, base - (raceWeekDays >= 4 ? 1 : 0));
  const B = T - taperN;
  const hasRaceWeek = raceWeekDays >= 2;

  const skel = [];
  for (let i = 0; i < B; i++){
    const p = B - 1 - i;
    skel.push({ monday:weeks[i], kind: (i > 0 && p % 4 === 3) ? 'recovery' : 'build', late: i >= B - 2, weekNo: i });
  }
  const taperTotal = taperN + (hasRaceWeek ? 1 : 0);
  const tf = taperFactors(taperTotal), tl = taperLR(taperTotal);
  weeks.slice(B).concat(hasRaceWeek ? [raceMon] : []).forEach((m, i) => {
    skel.push({ monday:m, kind: m === raceMon ? 'race' : 'taper', late:true, taperIdx:i, taperTotal, weekNo:B + i });
  });

  function makeWeek(w, vol, lrT, loadIdx, relax){
    const kind = w.kind;
    const keepFreq = kind === 'taper' || kind === 'race';
    const lrUsed = r05(Math.max(lv.minRun, kind === 'build' ? Math.min(lrT, SHARE_MAX[R] * vol) : lrT));
    // aantal looptrainingen: begin met minder als het volume te laag is voor de volledige structuur
    const minE = lv.minRun;
    const minOf = r => rolesFor(r, cfg.level, cfg.tempo === false).filter(x => x !== 'long').reduce((a, x) => a + (x === 'easy' ? minE : minKmFor(cfg, x, loadIdx)), lrUsed);
    let Rw = R;
    if (!keepFreq) while (Rw > 2 && minOf(Rw) > vol * 1.08 + 0.5) Rw--;
    const roles = rolesFor(Rw, cfg.level, cfg.tempo === false);
    const { runDays, roleMap } = planDays(cfg.availDays, longDow, Rw, roles);
    const items = [];
    items.push({ dow:longDow, role:'long', type:'long' });
    let easyN = 0;
    Object.keys(roleMap).map(Number).sort((a,b)=>a-b).forEach(d => {
      const r = roleMap[d]; if (r === 'long') return;
      if ((relax >= 1 || (kind === 'build' && loadIdx === 0)) && r === 'tempo'){ easyN++; items.push({ dow:d, role:'easy' + easyN, type:'easy' }); return; }
      easyN += r === 'easy' ? 1 : 0;
      items.push({ dow:d, role: r === 'easy' ? 'easy' + easyN : r, type:r });
    });
    let S = cfg.strength || 0;
    if (kind === 'taper' && w.taperIdx === 0 && w.taperTotal >= 2) S = Math.min(S, 1);
    else if (kind === 'taper' || kind === 'race') S = (w.taperIdx === 0 && w.taperTotal === 1) ? Math.min(S,1) : 0;
    pickStrengthDays(cfg.availDays, runDays, longDow, S, roleMap).forEach((s, i) => items.push({ dow:s.dow, role:'str' + (i+1), type:'strength', combo:s.combo, after:s.after }));

    // eindtype per dag bepalen (laatste dagen voor de wedstrijd)
    const live = [];
    items.forEach(it => {
      const date = addDays(w.monday, it.dow);
      if (date >= race) return;
      const k = diffDays(race, date);
      let type = it.type;
      if (type === 'strength' && k <= 3) return;
      if (k === 1) return;
      if (isRunType(type)){
        if (k === 2) type = 'shakeout';
        else if (k <= 4 && (type === 'hills' || type === 'tempo')) type = 'easy';
        else if (kind === 'race' && type === 'tempo') type = 'easy';   // wedstrijdweek: hooguit één korte prikkel
        else if (k <= 6 && type === 'long') type = 'easy';
      }
      live.push(Object.assign({}, it, { date, k, type }));
    });
    const rem = Math.max(vol - lrUsed, 0);
    const wts = { hills:0.9, tempo:1.1, easy:1.0 };
    const others = live.filter(it => it.type !== 'strength' && it.role !== 'long');
    const sumW = others.reduce((a, it) => a + (wts[it.type] || 1), 0) || 1;
    const vertOf = (type, km) => type === 'long' ? r10(km*ratio*0.8*hillF) : (type === 'easy' ? r10(km*ratio*0.35*hillF) : 0);
    const metaOf = (it, km) => sessionMeta({ role:it.role, type:it.type, km, vert:vertOf(it.type, km), cfg, level:cfg.level, loadIdx, kind: kind === 'build' ? 'build' : kind, late:w.late, combo:it.combo, after:it.after, k:it.k, weekNo:w.weekNo, forceMin: relax >= 2 && (it.type === 'hills' || it.type === 'tempo') });
    // 1. gestructureerde sessies (heuvels, tempo, activatie) eerst, op de omvang die hun opzet nodig heeft
    let structKm = 0;
    live.forEach(it => {
      if (it.type === 'hills' || it.type === 'tempo' || it.type === 'shakeout'){
        const alloc = rem * (wts[it.type] || 1) / sumW;
        it.meta = metaOf(it, it.type === 'shakeout' ? 4 : Math.max(lv.minRun, alloc));
        structKm += it.meta.km;
      }
    });
    // 2. rustige loopjes verdelen de rest
    const easies = live.filter(it => it.type === 'easy' && it.role !== 'long');
    const restKm = Math.max(rem - structKm, 0);
    const eachEasy = easies.length ? Math.max(minE, Math.min(restKm / easies.length, Math.max(lrUsed * 0.8, minE))) : 0;
    live.forEach(it => {
      if (it.meta) return;
      if (it.type === 'strength') it.meta = metaOf(it, 0);
      else if (it.role === 'long') it.meta = metaOf(it, lrUsed);
      else if (it.type === 'easy') it.meta = metaOf(it, r05(eachEasy));
    });
    const fullKm = live.reduce((a, it) => a + (it.type === 'strength' ? 0 : it.meta.km), 0);
    return { live, fullKm, lrUsed, Rw, relax };
  }

  const sessions = [];
  let buildN = 0, prevA = null, prevLRused = null, llr = Math.min(lr0, lrIdeal);
  let peakVol = 0, peakLR = 0;
  skel.forEach(w => {
    let vol, lrT, loadIdx;
    if (w.kind === 'build'){
      if (prevA === null){ vol = Math.min(v0, vIdeal); lrT = Math.min(lr0, lrIdeal); }
      else { vol = Math.min(prevA * (1+GROWTH), vIdeal); llr = Math.min(llr * (1+GROWTH), lrIdeal); lrT = llr; }
      loadIdx = buildN;
    } else if (w.kind === 'recovery'){
      vol = prevA * RECOVERY; lrT = prevLRused * RECOVERY; loadIdx = buildN;
    } else {
      const i = w.taperIdx;
      vol = (peakVol || prevA || v0) * tf[i]; lrT = (peakLR || prevLRused || lr0) * tl[i]; loadIdx = Math.max(0, buildN - 1);
    }
    let res = makeWeek(w, vol, lrT, loadIdx, 0);
    // herstel en taper horen echt lichter te zijn: eventueel tempo -> rustig en minimale heuvelopzet
    if (w.kind !== 'build'){
      for (let relax = 1; relax <= 2 && res.fullKm > vol * 1.15 + 0.5; relax++) res = makeWeek(w, vol, lrT, loadIdx, relax);
    }
    if (w.kind === 'build'){
      buildN++; prevA = res.fullKm; prevLRused = res.lrUsed;
      peakVol = Math.max(peakVol, res.fullKm); peakLR = Math.max(peakLR, res.lrUsed);
    }
    res.live.forEach(it => {
      if (it.date < from) return;
      sessions.push(Object.assign({
        id: w.monday + '-' + it.role, role:it.role, type:it.type, date:it.date, weekMonday:w.monday, kind: w.kind === 'build' ? 'build' : w.kind,
        rpe: TYPES[it.type].rpe, zone: TYPES[it.type].zone, hr: hrRange(cfg, it.type),
        _c: { loadIdx, late:w.late, weekNo:w.weekNo, combo:it.combo, after:it.after, k:it.k }
      }, it.meta));
    });
  });
  // wedstrijddag
  const rm = sessionMeta({ role:'race', type:'race', km:cfg.distance, vert:cfg.vert, cfg, level:cfg.level, loadIdx:0, kind:'race' });
  sessions.push(Object.assign({ id: raceMon + '-race', role:'race', type:'race', date:race, weekMonday:raceMon, kind:'race', rpe:TYPES.race.rpe, zone:TYPES.race.zone, hr:hrRange(cfg,'race') }, rm));
  sessions.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (!peakVol){ peakVol = Math.min(v0, vIdeal); peakLR = Math.min(lr0, lrIdeal); }
  return { sessions, lrIdeal, vIdeal, peakLR, peakVol, B, taperN, T, R };
}

/* ============ TRAINING WISSELEN ============ */
function swapOptions(s, cfg){
  const o = [];
  if (s.swapped) o.push({ id:'reset', label:'Terug naar het oorspronkelijke schema', hint:'' });
  if (s.type === 'hills' && !s.swapped && cfg.hills !== 'geen') o.push({ id:'flat', label:'Intervallen op vlak terrein', hint:'Geen heuvel of trap nodig' });
  if ((s.type === 'hills' || s.type === 'tempo') && s.swapped !== 'easy') o.push({ id:'easy', label:'Rustige duurloop', hint:'Makkelijk lopen op praattempo' });
  if (s.type === 'strength' && !s.swapped && !cfg.strengthHome) o.push({ id:'home', label:'Thuis zonder materiaal', hint:'Alleen je eigen lichaam, een stoel en een trap' });
  return o;
}
function applySwap(s, mode, cfg){
  if (!mode || !s._c) return;
  const c = s._c, ratio = cfg.vert / cfg.distance;
  const base = { role:s.role, cfg, level:cfg.level, loadIdx:c.loadIdx, kind:s.kind === 'build' ? 'build' : s.kind, late:c.late, weekNo:c.weekNo, combo:c.combo, after:c.after, k:c.k };
  let meta = null, type = s.type;
  if (mode === 'flat' && s.type === 'hills') meta = sessionMeta(Object.assign({}, base, { type:'hills', km:Math.max(3, s.km), vert:0, flat:true }));
  else if (mode === 'easy' && (s.type === 'hills' || s.type === 'tempo')){ type = 'easy'; meta = sessionMeta(Object.assign({}, base, { type:'easy', km:s.km, vert:r10(s.km * ratio * 0.35 * (HILL_FACTOR[cfg.hills] || 0.6)) })); }
  else if (mode === 'home' && s.type === 'strength') meta = sessionMeta(Object.assign({}, base, { type:'strength', home:true }));
  if (!meta) return;
  Object.assign(s, meta, { type, rpe:TYPES[type].rpe, zone:TYPES[type].zone, hr:hrRange(cfg, type), swapped:mode });
}

/* ============ PLAN OPBOUWEN (config + herplanningen + logboek) ============ */
function newState(cfg){
  return { v:2, cfg, rebases:[], log:{}, over:{}, swap:{}, acts:[], history:[{ at:cfg.startDate, text:'Schema aangemaakt.' }] };
}
function migrateState(st){
  if (!st || !st.cfg) return null;
  st.v = 2; st.rebases = st.rebases || []; st.log = st.log || {}; st.over = st.over || {};
  st.acts = st.acts || []; st.history = st.history || []; st.swap = st.swap || {};
  return st;
}
function buildPlan(state){
  const cfg = state.cfg;
  const segs = [{ from:cfg.startDate, v0:cfg.v0, lr0:cfg.lr0 }].concat((state.rebases||[]).map(r => ({ from:r.from, v0:r.v0, lr0:r.lr0 })));
  let all = [], last = null;
  segs.forEach((sg, i) => {
    if (sg.from > cfg.raceDate) return;
    const g = generateSegment(cfg, sg.from, sg.v0, sg.lr0);
    const until = i + 1 < segs.length ? segs[i+1].from : '9999-12-31';
    all = all.concat(g.sessions.filter(s => s.date >= sg.from && s.date < until));
    last = g;
  });
  const over = state.over || {}, swap = state.swap || {};
  all.forEach(s => {
    if (swap[s.id]) applySwap(s, swap[s.id], cfg);
    const o = over[s.id];
    if (o && o < cfg.raceDate && s.type !== 'race'){ s.origDate = s.date; s.date = o; s.moved = true; }
    const lg = (state.log || {})[s.id];
    s.status = lg ? lg.status : 'planned';
    s.actual = lg || null;
  });
  all.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.type === 'strength' ? 1 : -1));
  const weeks = {};
  all.forEach(s => {
    const w = weeks[s.weekMonday] || (weeks[s.weekMonday] = { monday:s.weekMonday, sessions:[], km:0, vert:0, min:0, doneKm:0, load:0, hardMin:0, kind:s.kind });
    w.sessions.push(s);
    if (s.type !== 'race' && s.status !== 'skipped'){ w.km += s.km; w.vert += s.vert; w.min += s.minutes; w.hardMin += s.hardMin || 0; }
    if (s.status === 'done' && s.type !== 'strength') w.doneKm += (s.actual && s.actual.km != null) ? s.actual.km : s.km;
    if (s.status === 'done' && s.actual && s.actual.rpe && s.actual.min) w.load += s.actual.rpe * s.actual.min;
    if (s.kind !== 'build' && w.kind === 'build') w.kind = s.kind;
  });
  const weekList = Object.keys(weeks).sort().map(k => weeks[k]);
  const lrIdeal = last ? last.lrIdeal : 0;
  const peakLR = last ? last.peakLR : 0;
  const ratio = lrIdeal ? peakLR / lrIdeal : 1;
  const verdict = ratio >= 0.9 ? 'goed' : (ratio >= 0.7 ? 'strak' : 'ambitieus');
  const peakWeek = weekList.reduce((m,w) => (w.kind !== 'race' && w.km > m.km) ? w : m, { km:0, vert:0 });
  return { sessions:all, weeks:weekList, lrIdeal, peakLR, ratio, verdict, peakVol:last ? last.peakVol : 0, peakWeek, R:last ? last.R : 0 };
}

/* ============ BELASTINGSCONTROLE (sessie-RPE, Foster 2001) ============ */
function loadInsight(plan, today){
  const cur = mondayOf(today), prev = addDays(cur, -7);
  const cw = plan.weeks.find(w => w.monday === cur), pw = plan.weeks.find(w => w.monday === prev);
  const out = { notes:[], cur: cw ? cw.load : 0, prev: pw ? pw.load : 0, hardShare: null };
  if (cw && cw.min > 0) out.hardShare = cw.hardMin / cw.min;
  if (out.prev > 0 && out.cur > out.prev * 1.3) out.notes.push('Je gevoelsbelasting (RPE × minuten) ligt ' + Math.round((out.cur/out.prev - 1)*100) + '% hoger dan vorige week. Een sprong van meer dan ongeveer 30% in een week hangt samen met meer blessures; neem het rustig aan.');
  const recent = plan.sessions.filter(s => s.status === 'done' && s.actual && s.actual.rpe && diffDays(today, s.date) <= 14 && diffDays(today, s.date) >= 0);
  const easyHot = recent.filter(s => (s.type === 'easy' || s.type === 'long') && s.actual.rpe >= 7);
  if (easyHot.length >= 2) out.notes.push('Je rustige trainingen voelden vaak (RPE 7 of hoger) zwaar. Loop echt rustiger: de meeste training hoort makkelijk te zijn. Houd het praattempo aan.');
  const hard = recent.filter(s => KEY_TYPES.includes(s.type) && s.type !== 'long' && s.actual.rpe >= 9);
  if (hard.length >= 2) out.notes.push('Je harde trainingen voelden erg zwaar (RPE 9 of meer). Overweeg een extra rustdag of een lichtere week als dit aanhoudt of je slecht slaapt.');
  return out;
}

/* ============ AANPASSEN BIJ GEMISTE TRAININGEN ============ */
function gapFactor(d){
  if (d <= 4) return 1;
  if (d <= 7) return 0.9;
  if (d <= 14) return 0.8;
  if (d <= 21) return 0.65;
  return 0.5;
}
function doneKm(s){ return (s.actual && s.actual.km != null) ? s.actual.km : s.km; }

function analyse(state, plan, today){
  const cfg = state.cfg;
  const handled = new Set();
  (state.rebases || []).forEach(r => (r.handled || []).forEach(id => handled.add(id)));
  const runs = plan.sessions.filter(s => isRunType(s.type) && s.type !== 'race');
  const done = runs.filter(s => s.status === 'done' && s.date <= today);
  const lastDone = done.length ? done[done.length-1].date : null;
  const gap = today < cfg.startDate ? 0 : Math.max(0, diffDays(today, lastDone || cfg.startDate));
  const grace = addDays(today, -1);
  const isMissed = s => s.status === 'skipped' || (s.status === 'planned' && s.date < grace);
  const missedKey = runs.filter(s => KEY_TYPES.includes(s.type) && isMissed(s) && !handled.has(s.id) && diffDays(today, s.date) <= 21).map(s => s.id);
  const win = runs.filter(s => s.date < today && diffDays(today, s.date) <= 14 && s.date >= cfg.startDate && !handled.has(s.id));
  const planned = win.reduce((a,s) => a + s.km, 0);
  const got = win.reduce((a,s) => a + (s.status === 'done' ? doneKm(s) : 0), 0);
  const compliance = planned >= 10 ? got / planned : 1;
  const lowCompliance = planned >= 10 && compliance < 0.75;
  const pending = runs.concat(plan.sessions.filter(s => s.type === 'strength')).filter(s => s.status === 'planned' && s.date < today);
  const reasons = [];
  let factor = 1;
  if (gap >= 5){ factor = Math.min(factor, gapFactor(gap)); reasons.push(gap + ' dagen zonder hardlopen'); }
  if (missedKey.length){ factor = Math.min(factor, 0.9); reasons.push(missedKey.length + (missedKey.length === 1 ? ' sleuteltraining gemist' : ' sleuteltrainingen gemist')); }
  if (lowCompliance){ factor = Math.min(factor, Math.max(0.7, compliance)); reasons.push('slechts ' + Math.round(compliance*100) + '% van de geplande kilometers gelopen'); }
  const daysToRace = diffDays(cfg.raceDate, today);
  const trigger = reasons.length > 0 && daysToRace > 3 && today >= cfg.startDate;
  return { gap, lastDone, missedKey, compliance, lowCompliance, factor, reasons, trigger, pending, daysToRace };
}

function computeRebase(state, plan, an, today){
  const cfg = state.cfg;
  const from = addDays(today, 1) > cfg.startDate ? addDays(today, 1) : cfg.startDate;
  const runs = plan.sessions.filter(s => isRunType(s.type) && s.type !== 'race');
  const monThis = mondayOf(today);
  const wk = plan.weeks.filter(w => w.monday < monThis && w.kind !== 'race');
  const lastTwo = wk.slice(-2).map(w => w.km);
  const volRef = lastTwo.length ? Math.max.apply(null, lastTwo) : cfg.v0;
  const recent = runs.filter(s => s.status === 'done' && s.date <= today && diffDays(today, s.date) <= 14);
  const actualRecent = recent.reduce((a,s) => a + doneKm(s), 0) / 2;
  const hasHistory = lastTwo.length > 0;
  const base = hasHistory ? Math.min(volRef, Math.max(actualRecent, 0.6 * volRef)) : cfg.v0;
  const lrRecent = runs.filter(s => s.status === 'done' && s.date <= today && diffDays(today, s.date) <= 21).reduce((m,s) => Math.max(m, doneKm(s)), 0);
  const lrRef = lrRecent || cfg.lr0;
  const f = an.factor;
  return { from, v0: Math.round(f * base * 2) / 2, lr0: Math.round(f * lrRef * 2) / 2, factor: f, reasons: an.reasons.slice(), at: today, handled: an.missedKey.slice() };
}
function applyRebase(state, today){
  const plan = buildPlan(state);
  const an = analyse(state, plan, today);
  if (!an.trigger) return { state, changed:false, an };
  const rb = computeRebase(state, plan, an, today);
  const before = plan.peakLR;
  const next = JSON.parse(JSON.stringify(state));
  next.rebases.push(rb);
  const after = buildPlan(next);
  rb.peakBefore = before; rb.peakAfter = after.peakLR;
  next.history.push({ at: today, text: 'Schema herberekend vanaf ' + fmtDate(rb.from, {noDay:true}) + ' (' + rb.reasons.join(', ') + '). Belasting op ' + Math.round(rb.factor*100) + '%.' });
  return { state: next, changed:true, an, rebase: rb, after };
}
function undoRebase(state){
  if (!state.rebases.length) return state;
  const next = JSON.parse(JSON.stringify(state));
  next.rebases.pop();
  next.history.push({ at: todayIso(), text: 'Laatste herberekening ongedaan gemaakt.' });
  return next;
}
function moveOptions(plan, s, today, race){
  const out = [];
  for (let d = -3; d <= 3; d++){
    if (!d) continue;
    const date = addDays(s.date, d);
    if (date < today || date >= addDays(race, -2)) continue;
    const same = plan.sessions.filter(x => x.date === date && x.id !== s.id && x.status !== 'skipped');
    if (isRunType(s.type) && same.some(x => isRunType(x.type))) continue;
    if (s.type === 'strength' && same.some(x => x.type === 'long' || x.type === 'hills' || x.type === 'tempo')) continue;
    let warn = false;
    if (KEY_TYPES.includes(s.type)){
      const nb = plan.sessions.filter(x => Math.abs(diffDays(x.date, date)) === 1 && KEY_TYPES.includes(x.type) && x.id !== s.id && x.status !== 'skipped');
      if (nb.length) warn = true;
    }
    out.push({ date, warn });
  }
  const strict = out.filter(o => !o.warn);
  return strict.length ? strict : out;
}

/* ============ INTAKE ============ */
function normalizeCfg(raw){
  const lv = LEVELS[raw.level] || LEVELS.beginner;
  const avail = (raw.availDays || []).map(Number).filter(d => d >= 0 && d <= 6).sort((a,b) => a-b);
  const c = {
    name: (raw.name || '').trim(),
    distance: Math.max(5, Math.min(100, Number(raw.distance) || 30)),
    vert: Math.max(0, Number(raw.vert) || 0),
    raceDate: raw.raceDate,
    level: raw.level in LEVELS ? raw.level : 'beginner',
    v0: Math.max(lv.minV0, Number(raw.v0) || lv.minV0),
    lr0: Math.max(lv.minLR0, Number(raw.lr0) || lv.minLR0),
    availDays: avail,
    runsPerWeek: Math.max(2, Math.min(lv.maxRuns, Number(raw.runsPerWeek) || lv.defRuns)),
    longDow: avail.includes(Number(raw.longDow)) ? Number(raw.longDow) : avail[avail.length-1],
    strength: Math.max(0, Math.min(2, Number(raw.strength) || 0)),
    hills: ['heuvels','klimmetjes','vlak','geen'].includes(raw.hills) ? raw.hills : 'klimmetjes',
    tempo: !(raw.tempo === false || raw.tempo === 'false'),
    strengthHome: raw.strengthHome === true || raw.strengthHome === 'true',
    pace: Math.max(4, Math.min(12, Number(raw.pace) || lv.pace)),
    age: raw.age ? Math.max(14, Math.min(90, Number(raw.age))) : null,
    hrmax: raw.hrmax ? Math.max(120, Math.min(220, Number(raw.hrmax))) : null,
    startDate: raw.startDate
  };
  return c;
}
function validateCfg(raw, today){
  const errs = [];
  if (!raw.raceDate) errs.push('Kies de datum van je wedstrijd.');
  else if (diffDays(raw.raceDate, today) < 7) errs.push('De wedstrijd moet minstens een week in de toekomst liggen.');
  if (!(Number(raw.distance) >= 5)) errs.push('Vul de afstand in (minstens 5 km).');
  if (raw.vert === '' || raw.vert == null || Number(raw.vert) < 0 || isNaN(Number(raw.vert))) errs.push('Vul de hoogtemeters in (0 mag ook).');
  if (!raw.availDays || raw.availDays.length < 2) errs.push('Kies minstens twee dagen waarop je kunt trainen.');
  return errs;
}
function intakeAdvice(cfg, plan, today){
  const lines = [];
  const weeks = Math.max(0, Math.floor(diffDays(cfg.raceDate, today) / 7));
  if (cfg.level === 'beginner' && weeks < 12) lines.push('Voor een lange trailwedstrijd wordt beginners doorgaans een voorbereiding van 12 tot 16 weken aangeraden. Jij hebt ' + weeks + ' weken.');
  if (plan.verdict === 'ambitieus') lines.push('Met jouw startpunt haal je in de beschikbare tijd een langste duurloop van ongeveer ' + fmtKm(plan.peakLR) + ', terwijl ongeveer ' + fmtKm(plan.lrIdeal) + ' ideaal is. Plan wandelpauzes in, beschouw finishen als doel en overweeg een kortere afstand.');
  else if (plan.verdict === 'strak') lines.push('Haalbaar maar strak: je langste duurloop komt uit op ongeveer ' + fmtKm(plan.peakLR) + ' (ideaal ongeveer ' + fmtKm(plan.lrIdeal) + '). Mis liever geen sleuteltrainingen.');
  else lines.push('Goed haalbaar: je bouwt op naar een langste duurloop van ongeveer ' + fmtKm(plan.peakLR) + '.');
  if (cfg.hills === 'geen' && cfg.vert / cfg.distance > 20) lines.push('Je hebt geen heuvels of trappen: het schema vervangt heuveltraining door intervallen op vlak terrein. Wandel in de wedstrijd de steile stukken en doe extra krachttraining voor je benen.');
  if (cfg.hills === 'vlak' && cfg.vert / cfg.distance > 20) lines.push('Je hebt geen heuvels in de buurt: het schema gebruikt trappen, een dijk of een loopband met helling voor de hoogtemeters.');
  if (cfg.distance > 50) lines.push('Bij ultra-afstanden (meer dan 50 km) hoort vaak ook een weekend met twee lange dagen achter elkaar en veel wandeltraining. Dat zit niet in dit schema: gebruik het als basis en overleg met een trainer.');
  if (cfg.vert / cfg.distance > 70) lines.push('Je wedstrijd heeft zeer veel hoogtemeters per kilometer. Plan extra tijd voor bergop wandelen en excentrische krachttraining voor de afdalingen.');
  return lines;
}

if (typeof module !== 'undefined') module.exports = { swapOptions, applySwap, generateSegment, buildPlan, newState, migrateState, normalizeCfg, validateCfg, analyse, computeRebase, applyRebase, undoRebase, moveOptions, intakeAdvice, loadInsight, strengthProgram, strengthMinutes, sessionMeta, stepsMin, hrMax, hrRange, addDays, diffDays, dow, fmtDate, mondayOf, LEVELS, TYPES, HR_ZONES, KEY_TYPES, isRunType, estMin, EFFORT };
