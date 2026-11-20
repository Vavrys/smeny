// Harness pro generátor rozpisu: extrahuje oba inline <script> bloky z index.html,
// nastubuje DOM/Supabase a spustí buildSchedule() nad syntetickými daty. Těžiště je
// v0.9.26 — MĚŘENÍ volných víkendů na páru SO+NE (dřív pá–ne blok). Kontroly:
//   1) buildSchedule() vrací S — objekt {empId:datum → směna}, neprázdný, každá
//      hodnota má shift_date i shift_type_code a klíč souhlasí s obsahem
//   2) collectWeekendPairs(): každý pár je přesně [SOBOTA, NEDĚLE] téhož víkendu,
//      obě půlky uvnitř měsíce, páry jdou vzestupně a nepřekrývají se
//   3) okraj měsíce: osamělá SO na konci ani osamělá NE na začátku netvoří pár
//      (ověřeno napříč 24 měsíci 2026–2027, ne jen na jednom vybraném)
//   4) pátek do měření nezasahuje — v žádném páru není pátek; naopak OBSAZOVÁNÍ
//      zůstává na pá–ne bloku, takže collectWeekendBlocks() pořád začíná pátkem
//      (regrese: kdyby někdo přepnul na páry i obsazování, spadne to tady)
//   5) po vygenerování má každý zaměstnanec ≥ min_free_weekends volných víkendů
//      měřeno přes páry (volno = prázdno, X ve směnách, nebo žádanka v unavail)
//   6) metrika volných víkendů z computeQuality() souhlasí s nezávislým
//      přepočtem přes páry — obě strany appky musí měřit stejně
//   7) nová definice nikdy neměří MÍŇ než stará bloková (volný pá–ne blok je vždy
//      i volný so+ne pár) a v měsíci s víkendem bez pátku měří prokazatelně víc
//   8) žádanky (X) se počítají jako volno — víkend pokrytý žádankou je volný
//
// Spuštění:  node tests/schedule_harness.js        (exit 1 = některá kontrola padla)
// Math.random je seedovaný, takže běhy jsou reprodukovatelné.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

// ── extrakce inline skriptů ────────────────────────────────────────────────
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html))) blocks.push(m[1]);
if (!blocks.length) { console.error('žádný inline <script> v index.html'); process.exit(1); }
if (!blocks.some(b => b.includes('function buildSchedule'))) {
  console.error('buildSchedule() nenalezena — změnila se struktura index.html?'); process.exit(1);
}

// ── minimalistický DOM / browser stub ──────────────────────────────────────
// Appka si při načtení sahá na DOM, který tu není. Nechceme věrný DOM — stačí,
// aby skript proběhl deklaracemi; ty jsou hoistované, takže i když se běh nahoře
// utne na chybějícím elementu, generátor je pak volatelný.
function mkEl() {
  return {
    style: { setProperty() {}, removeProperty() {} }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], value: '', textContent: '', innerHTML: '', checked: false, options: [], files: [],
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, insertBefore(c) { return c; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {}, querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, blur() {}, click() {}, remove() {}, scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 100, height: 100 }; },
    insertAdjacentHTML() {}, cloneNode() { return mkEl(); },
  };
}
function mkStorage() {
  const s = {};
  return {
    getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; },
    key: i => Object.keys(s)[i] ?? null, get length() { return Object.keys(s).length; },
  };
}
// deterministický PRNG (mulberry32) místo Math.random — candidateScore si přidává
// šum, bez seedu by byl každý běh jiný a selhání nereprodukovatelné
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSandbox(seedN) {
  const document = {
    readyState: 'complete', body: mkEl(), documentElement: mkEl(), head: mkEl(), cookie: '',
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return mkEl(); }, createTextNode() { return mkEl(); },
    addEventListener() {}, removeEventListener() {},
  };
  const MathStub = Object.create(Math);
  MathStub.random = seededRandom(seedN);
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, group() {}, groupEnd() {}, table() {}, info() {}, debug() {} },
    Math: MathStub, Date, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    document, localStorage: mkStorage(), sessionStorage: mkStorage(),
    navigator: {
      userAgent: 'node', onLine: true,
      serviceWorker: { register() { return Promise.resolve(); }, addEventListener() {} },
      clipboard: { writeText() { return Promise.resolve(); } },
    },
    location: { href: 'http://localhost/', hostname: 'localhost', search: '', hash: '', origin: 'http://localhost', reload() {} },
    history: { replaceState() {}, pushState() {} },
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    Intl, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: require('crypto').webcrypto,
    Promise, Error, Object, Array, String, Number, Boolean, RegExp, Map, Set, WeakMap, WeakSet,
    Symbol, Proxy, Reflect, isNaN, isFinite, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    // Supabase klient nikdy nic nevrátí — generátor běží čistě nad lokálními poli
    supabase: { createClient: () => new Proxy({}, { get: () => () => new Proxy({}, { get: () => () => Promise.resolve({ data: [], error: null }) }) }) },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  blocks.forEach((b, i) => {
    try { vm.runInContext(b, sandbox, { filename: 'index.html:script' + (i + 1) }); }
    catch (e) { /* běh se utne na DOM stubu; deklarace funkcí ale existují */ }
  });
  return sandbox;
}

// Data se MUSÍ přiřadit uvnitř vm scope: top-level let/const ve skriptu nejsou
// vlastnosti globálu, takže sandbox.employees = ... by funkce vůbec neviděly.
// branch_limits jsou klíčované KÓDEM pobočky (ne id) a hodnota je objekt s max.
function seedData(sandbox, opts) {
  vm.runInContext(
    'schedYear = ' + opts.year + '; schedMonth = ' + opts.month + ';\n' +
    "branches = [{ id:'b1', code:'A', name:'Pobocka A', min_weekday:1, min_weekend:1, max_per_day:2 }];\n" +
    'shiftTypes = [];\n' +
    'employees = ' + JSON.stringify(opts.employees) + ';\n' +
    'shifts = {};\n' +
    'unavail = ' + JSON.stringify(opts.unavail || {}) + ';\n' +
    "orgSettings = { default_min_free_weekends:'2', weekend_priority:true };",
    sandbox, { filename: 'seed' });
}
const read = (sandbox, expr) => vm.runInContext(expr, sandbox);

function mkEmployees(n, minFreeWeekends) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'e' + i, name: 'Zam ' + i, is_fixed: false,
    branch_limits: { A: { max: 31 } },
    min_shifts: 8, target_shifts: 12, max_shifts: 16, max_x: 5,
    min_free_weekends: minFreeWeekends, max_consecutive: 5, ideal_rest: 1,
  }));
}

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const daysIn = (y, mo) => new Date(y, mo + 1, 0).getDate();
const dowOf = ds => new Date(ds + 'T00:00:00').getDay();

let fail = 0;
function check(label, errs, info) {
  if (errs.length) fail++;
  console.log(label + (info ? ': ' + info : '') + (errs.length ? '  ✗ FAIL: ' + errs.join('; ') : '  ✓'));
}

// ══ 2/3/4 — tvar párů napříč 24 měsíci ═════════════════════════════════════
{
  const sb = makeSandbox(1);
  const errs = [];
  let totalPairs = 0, edgeSat = 0, edgeSun = 0, noFridayWE = 0;
  for (let y = 2026; y <= 2027; y++) {
    for (let mo = 0; mo < 12; mo++) {
      seedData(sb, { year: y, month: mo, employees: mkEmployees(1, 0) });
      const dim = daysIn(y, mo);
      const pairs = sb.collectWeekendPairs(dim);
      const wblocks = sb.collectWeekendBlocks(dim);
      const lbl = MONTHS[mo] + ' ' + y;
      totalPairs += pairs.length;

      pairs.forEach(p => {
        if (p.length !== 2) errs.push(lbl + ': pár není dvojice (' + p.length + ')');
        if (dowOf(p[0]) !== 6) errs.push(lbl + ': první den páru ' + p[0] + ' není sobota');
        if (dowOf(p[1]) !== 0) errs.push(lbl + ': druhý den páru ' + p[1] + ' není neděle');
        const d0 = +p[0].slice(-2), d1 = +p[1].slice(-2);
        if (d1 !== d0 + 1) errs.push(lbl + ': ' + p[0] + ' a ' + p[1] + ' nejsou po sobě');
        if (d1 > dim) errs.push(lbl + ': ' + p[1] + ' je mimo měsíc');
        p.forEach(ds => { if (dowOf(ds) === 5) errs.push(lbl + ': pátek ' + ds + ' v páru měření'); });
      });
      for (let i = 1; i < pairs.length; i++) {
        if (pairs[i][0] <= pairs[i - 1][1]) errs.push(lbl + ': páry se překrývají nebo nejdou vzestupně');
      }

      // okraj měsíce: osamělá SO na konci / osamělá NE na začátku se nepočítá
      const flat = pairs.flat();
      const last = sb.isoDate(y, mo + 1, dim), first = sb.isoDate(y, mo + 1, 1);
      if (dowOf(last) === 6) { edgeSat++; if (flat.includes(last)) errs.push(lbl + ': osamělá SO ' + last + ' se počítá jako víkend'); }
      if (dowOf(first) === 0) { edgeSun++; if (flat.includes(first)) errs.push(lbl + ': osamělá NE ' + first + ' se počítá jako víkend'); }
      if (dowOf(first) === 6) noFridayWE++; // víkend bez pátku — přesně to, co stará definice neviděla

      // OBSAZOVÁNÍ se neměnilo: bloky pořád začínají pátkem
      wblocks.forEach(wb => {
        if (dowOf(wb[0]) !== 5) errs.push(lbl + ': pá–ne blok nezačíná pátkem (' + wb[0] + ') — obsazování se nemá měnit');
      });
    }
  }
  check('[2,3,4] tvar SO+NE párů, okraje měsíce, pátek mimo měření (24 měsíců 2026–2027)', errs,
    totalPairs + ' párů, ' + edgeSat + '× osamělá SO na konci, ' + edgeSun + '× osamělá NE na začátku, ' +
    noFridayWE + '× víkend bez pátku');
}

// ══ 1/5/6/7 — běh generátoru ═══════════════════════════════════════════════
// Srpen 2026 začíná SOBOTOU → víkend 1.–2. 8. nemá v měsíci pátek; stará bloková
// definice ho neviděla, nová ho měří. Ostatní měsíce pokrývají zbylé okraje.
const SCEN = [
  { seedN: 11, year: 2026, month: 7, emp: 6, minWE: 2, label: 'srpen 2026 (začíná SO)' },
  { seedN: 12, year: 2026, month: 10, emp: 6, minWE: 2, label: 'listopad 2026 (začíná NE)' },
  { seedN: 13, year: 2026, month: 9, emp: 6, minWE: 2, label: 'říjen 2026 (končí SO)' },
  { seedN: 14, year: 2027, month: 4, emp: 5, minWE: 1, label: 'květen 2027' },
];

for (const sc of SCEN) {
  const sb = makeSandbox(sc.seedN);
  const employees = mkEmployees(sc.emp, sc.minWE);
  seedData(sb, { year: sc.year, month: sc.month, employees: employees });
  const dim = daysIn(sc.year, sc.month);

  let S = null, buildErr = null;
  try { S = sb.buildSchedule(dim, {}); } catch (e) { buildErr = e; }

  const errs = [];
  if (buildErr) {
    check('[1] ' + sc.label + ' — buildSchedule vrací S', ['buildSchedule vyhodila: ' + buildErr.message]);
    continue;
  }

  // (1) vrací S
  if (!S || typeof S !== 'object' || Array.isArray(S)) errs.push('nevrátila objekt (' + typeof S + ')');
  const keys = S ? Object.keys(S) : [];
  if (!keys.length) errs.push('vrácené S je prázdné — generátor nic nepřiřadil');
  keys.forEach(k => {
    const s = S[k];
    if (!s || !s.shift_date || !s.shift_type_code) { errs.push('klíč ' + k + ' bez shift_date/shift_type_code'); return; }
    if (k !== s.employee_id + ':' + s.shift_date) errs.push('klíč ' + k + ' nesouhlasí s obsahem (' + s.employee_id + ':' + s.shift_date + ')');
  });

  const unavailMap = read(sb, 'unavail');
  const isWorking = (id, ds) => { const s = S[id + ':' + ds]; return !!(s && s.shift_type_code && s.shift_type_code !== 'X'); };
  const pairs = sb.collectWeekendPairs(dim);
  const wblocks = sb.collectWeekendBlocks(dim);
  const freeByPairs = e => pairs.filter(p => p.every(ds => !isWorking(e.id, ds))).length;
  const freeByBlocks = e => wblocks.filter(w => w.length === 3 && w.every(ds => !isWorking(e.id, ds))).length;

  // (5) každý splňuje své minimum volných víkendů
  employees.forEach(e => {
    const f = freeByPairs(e);
    if (f < sc.minWE) errs.push(e.name + ' má ' + f + ' volných víkendů < min ' + sc.minWE);
  });

  // (6) computeQuality měří totéž
  const q = sb.computeQuality(S, unavailMap);
  const weMetric = (q.metrics || []).find(x => x.id === 'weekends' || /víkend/i.test(x.label || ''));
  if (!weMetric) errs.push('computeQuality nevrací metriku volných víkendů');
  else {
    // details = { type:'employees', rows:[{ name, free, min, ok }] }
    ((weMetric.details && weMetric.details.rows) || []).forEach(d => {
      const e = employees.find(x => x.name === d.name);
      if (!e) return;
      const mine = freeByPairs(e);
      if (d.free !== mine) errs.push('computeQuality: ' + d.name + ' free=' + d.free + ', přepočet přes páry=' + mine);
    });
    const expectedOk = employees.filter(e => freeByPairs(e) >= sc.minWE).length;
    if (weMetric.score !== undefined && weMetric.score !== expectedOk) {
      errs.push('computeQuality skóre víkendů ' + weMetric.score + ' ≠ ' + expectedOk + ' splňujících');
    }
  }

  // (7) pár nikdy neměří míň než blok
  let rescued = 0;
  employees.forEach(e => {
    const p = freeByPairs(e), b = freeByBlocks(e);
    if (p < b) errs.push(e.name + ': párů ' + p + ' < bloků ' + b + ' — volný blok musí být i volný pár');
    rescued += p - b;
  });

  check('[1,5,6,7] ' + sc.label, errs,
    'přiřazení ' + keys.length + ', kvalita ' + q.pct + ' % (hardFailed ' + q.hardFailed.length + '), ' +
    'volné víkendy ' + employees.map(freeByPairs).join('/') + ' (min ' + sc.minWE + '), ' +
    'páry ' + pairs.length + ' vs bloky ' + wblocks.length + ', navíc oproti blokům +' + rescued);
}

// ══ 8 — žádanka (X) se počítá jako volno ═══════════════════════════════════
{
  const sb = makeSandbox(21);
  const employees = mkEmployees(6, 2);
  // e0 dostane žádanku na celý víkend 8.–9. 8. 2026 (SO+NE)
  const unavail = {
    'e0:2026-08-08': { employee_id: 'e0', date: '2026-08-08' },
    'e0:2026-08-09': { employee_id: 'e0', date: '2026-08-09' },
  };
  seedData(sb, { year: 2026, month: 7, employees: employees, unavail: unavail });
  const dim = daysIn(2026, 7);
  const S = sb.buildSchedule(dim, {});
  const errs = [];
  const isWorking = (id, ds) => { const s = S[id + ':' + ds]; return !!(s && s.shift_type_code && s.shift_type_code !== 'X'); };
  ['2026-08-08', '2026-08-09'].forEach(ds => {
    if (isWorking('e0', ds)) errs.push('e0 dostal směnu na žádanku ' + ds);
    if (!S['e0:' + ds] || S['e0:' + ds].shift_type_code !== 'X') errs.push(ds + ' není v S označen jako X');
  });
  const pairs = sb.collectWeekendPairs(dim);
  const xPair = pairs.find(p => p[0] === '2026-08-08');
  if (!xPair) errs.push('pár 8.–9. 8. 2026 chybí');
  else if (!xPair.every(ds => !isWorking('e0', ds))) errs.push('víkend pokrytý žádankou se neměří jako volný');
  const free = pairs.filter(p => p.every(ds => !isWorking('e0', ds))).length;
  if (free < 2) errs.push('e0 má ' + free + ' volných víkendů < min 2');
  check('[8] žádanka (X) přes celý víkend se počítá jako volný víkend', errs,
    'e0 volných víkendů ' + free + ', přiřazení celkem ' + Object.keys(S).length);
}

// ══ 9 — uzavírky poboček (v0.9.40) ═════════════════════════════════════════
// Zavřená pobočka nemá poptávku: požadavky dne jsou prázdné, generátor tam nikoho
// nenaplánuje (a to bez žádanek X) a ostatní dny se plánují dál.
{
  const sb = makeSandbox(31);
  const employees = mkEmployees(6, 0);
  seedData(sb, { year: 2026, month: 10, employees: employees });          // listopad 2026
  vm.runInContext("orgSettings.branch_closures = [{ id:'t1', branch:'A', from:'2026-11-24', to:'2026-11-26', note:'test' }]; rebuildClosureIndex();", sb);
  const dim = daysIn(2026, 10);
  const errs = [];
  const closed = ['2026-11-24', '2026-11-25', '2026-11-26'];
  closed.forEach(ds => {
    const slots = sb.requiredSlotsForDay(ds);
    if (slots.length) errs.push(ds + ': zavřená pobočka má ' + slots.length + ' požadovaných slotů');
  });
  if (!sb.requiredSlotsForDay('2026-11-23').length) errs.push('2026-11-23: otevřený den nemá žádný požadavek');
  if (!sb.requiredSlotsForDay('2026-11-27').length) errs.push('2026-11-27: otevřený den nemá žádný požadavek');
  const S = sb.buildSchedule(dim, {});
  Object.values(S).forEach(s => {
    if (closed.includes(s.shift_date) && s.shift_type_code && s.shift_type_code !== 'X') {
      errs.push('směna ' + s.shift_type_code + ' na zavřený den ' + s.shift_date);
    }
  });
  const open = Object.values(S).filter(s => s.shift_type_code && s.shift_type_code !== 'X' && !closed.includes(s.shift_date)).length;
  if (!open) errs.push('mimo uzavírku se nenaplánovala žádná směna');
  // celá firma ('*') a jednodenní uzavírka bez "do"
  vm.runInContext("orgSettings.branch_closures = [{ id:'t2', branch:'*', from:'2026-11-10' }]; rebuildClosureIndex();", sb);
  if (sb.requiredSlotsForDay('2026-11-10').length) errs.push("uzavírka '*' bez 'to' neplatí pro jeden den");
  if (!sb.requiredSlotsForDay('2026-11-11').length) errs.push("uzavírka '*' bez 'to' zasáhla i následující den");
  check('[9] uzavírky poboček: zavřený den nemá poptávku a nikdo se tam neplánuje', errs,
    'směn mimo uzavírku ' + open);
}

// ══ 10 — „Otevřít tento den": rozdělení uzavírky a rozbalení '*' ════════════
{
  const sb = makeSandbox(41);
  const errs = [];
  const call = (list, code, ds) => JSON.parse(vm.runInContext(
    'JSON.stringify(closuresWithoutDay(' + JSON.stringify(list) + ',' + JSON.stringify(code) + ',' + JSON.stringify(ds) + ",['U','K','M']))", sb));
  const days = list => { const o = {}; list.forEach(c => { let d = c.from; const to = c.to || c.from;
    for (let i = 0; i < 60 && d <= to; i++) { (o[c.branch] = o[c.branch] || []).push(d); d = vm.runInContext('closureShiftDay("' + d + '",1)', sb); } }); return o; };
  // jedna pobočka, víc dnů → uprostřed se rozdělí
  let r = days(call([{ id: 'a', branch: 'U', from: '2026-12-24', to: '2026-12-26' }], 'U', '2026-12-25'));
  if (JSON.stringify(r.U) !== JSON.stringify(['2026-12-24', '2026-12-26'])) errs.push('rozdělení U: ' + JSON.stringify(r.U));
  // první / poslední den a jednodenní uzavírka
  r = days(call([{ id: 'a', branch: 'U', from: '2026-12-24', to: '2026-12-26' }], 'U', '2026-12-24'));
  if (JSON.stringify(r.U) !== JSON.stringify(['2026-12-25', '2026-12-26'])) errs.push('otevření prvního dne: ' + JSON.stringify(r.U));
  r = call([{ id: 'a', branch: 'U', from: '2026-12-24' }], 'U', '2026-12-24');
  if (r.length) errs.push('jednodenní uzavírka měla po otevření zmizet');
  // '*' → ostatní pobočky zůstanou zavřené, otevřená je jen ta jedna a jen ten den
  r = days(call([{ id: 'a', branch: '*', from: '2026-12-24', to: '2026-12-25' }], 'K', '2026-12-24'));
  if (JSON.stringify(r.U) !== JSON.stringify(['2026-12-24', '2026-12-25'])) errs.push("'*' → U: " + JSON.stringify(r.U));
  if (JSON.stringify(r.M) !== JSON.stringify(['2026-12-24', '2026-12-25'])) errs.push("'*' → M: " + JSON.stringify(r.M));
  if (JSON.stringify(r.K) !== JSON.stringify(['2026-12-25'])) errs.push("'*' → K: " + JSON.stringify(r.K));
  // cizí den a jiná pobočka zůstanou beze změny
  r = call([{ id: 'a', branch: 'M', from: '2026-12-24' }], 'U', '2026-12-24');
  if (r.length !== 1 || r[0].id !== 'a') errs.push('uzavírka jiné pobočky se změnila');
  check('[10] otevření jednoho dne: rozdělení víc-denní uzavírky a rozbalení „všechny pobočky"', errs, '5 scénářů');
}

// ══ 11 — režim „Jen doplnit": stávající směny zůstanou, doplní se jen nové ═══
{
  const errs = [];
  let added = 0, kept = 0;
  for (const seedN of [51, 52, 53]) {
    const sb = makeSandbox(seedN);
    seedData(sb, { year: 2026, month: 10, employees: mkEmployees(6, 2) });
    const dim = daysIn(2026, 10);
    const S1 = sb.buildSchedule(dim, {});
    // ulož výsledek jako stávající auto směny a přidej nového zaměstnance
    const existing = {};
    Object.entries(S1).forEach(([k, v]) => { if (v && v.is_auto) existing[k] = { ...v }; });
    const emps = mkEmployees(7, 2);
    seedData(sb, { year: 2026, month: 10, employees: emps });
    // pobočka má nad minimem rezervu (max 3) — jen tam má nový člověk kam; jinak by šlo jen přesouvat
    vm.runInContext('branches[0].max_per_day = 3; shifts = ' + JSON.stringify(existing) + '; autoFillOnly = true;', sb);
    const S2 = sb.buildSchedule(dim, {});
    Object.entries(existing).forEach(([k, v]) => {
      const n = S2[k];
      if (!n || n.shift_type_code !== v.shift_type_code) errs.push('seed ' + seedN + ': stávající směna ' + k + ' se změnila/zmizela');
      else if (n.is_auto) errs.push('seed ' + seedN + ': stávající směna ' + k + ' by se uložila znovu (is_auto)');
      else kept++;
    });
    Object.entries(S2).forEach(([k, v]) => { if (v && v.is_auto && !existing[k]) added++; });
    const newEmpShifts = Object.values(S2).filter(v => v && v.is_auto && v.employee_id === 'e6').length;
    if (!newEmpShifts) errs.push('seed ' + seedN + ': nový zaměstnanec nedostal žádnou směnu');
    // bez příznaku se chová jako dřív — stávající auto směny se zahodí a rozdělí znovu
    vm.runInContext('autoFillOnly = false;', sb);
    const S3 = sb.buildSchedule(dim, {});
    if (!Object.values(S3).some(v => v && v.is_auto)) errs.push('seed ' + seedN + ': režim „Začít znovu" nic nevygeneroval');
  }
  check('[11] „Jen doplnit": stávající směny beze změny, nový člověk dostane směny', errs, kept + ' zachováno, ' + added + ' doplněno');
}

console.log(fail ? '\n' + fail + ' kontrol(a) selhalo' : '\nvšechny kontroly prošly');
process.exit(fail ? 1 : 0);
