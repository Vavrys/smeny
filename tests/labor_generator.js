// Test generátoru se zákoníkem práce (v0.9.50):
//   1) Beer Spa (flexibilní pobočky bez časů): výsledek generátoru je bit po bitu
//      stejný, ať je kontrola zákoníku zapnutá, vypnutá, nebo má časy jen u
//      nepoužitého kódu → vrstva zákoníku se bez časů vůbec neuplatní.
//   2) Pevné směny s časy: automaticky doplněný rozpis nemá porušení § 90
//      (odpočinek mezi směnami), § 92 (35 h v týdnu) ani týdenního stropu —
//      ověřeno nezávisle funkcí laborCheck() — a obsazenost zůstává vysoká.
//   3) Ruční směny: po ruční noční nedá generátor ranní ani odpolední.
// Spuštění: node tests/labor_generator.js   (exit 1 = některá kontrola padla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = process.env.SMENY_INDEX || path.join(__dirname, '..', 'index.html');
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


let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

// ── Beer Spa–like data: 4 pobočky, Majestic s M1–M4, Plaza P1/P2, různá oprávnění ──
function beerSpa(){
  const wp = (wd, we) => { const o = {}; for(let d = 0; d < 7; d++){ const n = (d === 0 || d === 6) ? we : wd; o[d] = { min: n, target: n, max: n }; } return o; };
  const branches = [
    { id: 'bM', code: 'M', name: 'Majestic', min_weekday: 3, min_weekend: 3, max_per_day: 4, weekly_pattern: wp(3, 4), sort_order: 0 },
    { id: 'bU', code: 'U', name: 'Ungelt',   min_weekday: 1, min_weekend: 1, max_per_day: 1, weekly_pattern: wp(1, 1), sort_order: 1 },
    { id: 'bK', code: 'K', name: 'Karolína', min_weekday: 1, min_weekend: 1, max_per_day: 1, weekly_pattern: wp(1, 1), sort_order: 2 },
    { id: 'bP', code: 'P', name: 'Plaza',    min_weekday: 2, min_weekend: 2, max_per_day: 2, weekly_pattern: wp(2, 2), sort_order: 3 },
  ];
  const shiftTypes = [
    ...['M1','M2','M3','M4'].map((c, i) => ({ id: 't' + c, branch_id: 'bM', code: c, label: c, sort_order: i })),
    ...['P1','P2'].map((c, i) => ({ id: 't' + c, branch_id: 'bP', code: c, label: c, sort_order: i })),
  ];
  const all = { M: { shiftTypes: {} }, U: { shiftTypes: {} }, K: { shiftTypes: {} } };
  const emp = (id, bl, o = {}) => Object.assign({ id, name: id, is_fixed: false, branch_limits: bl, min_shifts: 12, target_shifts: 15, max_shifts: 17, max_x: 6, max_consec: 4, min_rest: 1, ideal_rest: 2, min_free_weekends: 2, sort_order: 0 }, o);
  const employees = [
    emp('Monika', all), emp('Samuel', all), emp('Frantisek', all), emp('Dominik', all), emp('Lucie', all),
    emp('Kristyna', all), emp('Martin', { M: { shiftTypes: {} } }), emp('Vojtech', { M: { shiftTypes: {} }, U: { shiftTypes: {} } }),
    emp('Vladimir', { K: { shiftTypes: {} } }, { min_shifts: 14, target_shifts: 16 }),
    emp('Hedvika', { P: { shiftTypes: {} } }), emp('Mario', { P: { shiftTypes: {} } }), emp('Veronika', { P: { shiftTypes: {} } }), emp('Dean', { P: { shiftTypes: {} } }),
    emp('Extra1', all, { min_shifts: 6, target_shifts: 8, max_shifts: 10 }),
  ];
  return { branches, shiftTypes, employees };
}
function seed(sb, data, year, month, settings, extra = {}){
  vm.runInContext(
    'schedYear = ' + year + '; schedMonth = ' + month + ';\n' +
    'branches = ' + JSON.stringify(data.branches) + ';\n' +
    'shiftTypes = ' + JSON.stringify(data.shiftTypes) + ';\n' +
    'employees = ' + JSON.stringify(data.employees) + ';\n' +
    'shifts = ' + JSON.stringify(extra.shifts || {}) + ';\n' +
    'unavail = ' + JSON.stringify(extra.unavail || {}) + ';\n' +
    'orgSettings = ' + JSON.stringify(settings) + ';', sb, { filename: 'seed' });
}
function gen(data, year, month, settings, seedN, extra){
  const sb = makeSandbox(seedN);
  seed(sb, data, year, month, settings, extra);
  const dim = new Date(year, month + 1, 0).getDate();
  return { S: sb.buildSchedule(dim, extra && extra.prev || {}), sb, dim };
}
const canon = S => JSON.stringify(Object.keys(S).sort().map(k => [k, S[k].shift_type_code, !!S[k].is_auto]));

// ── 1) Beer Spa beze změny ───────────────────────────────────────────────
{
  const bs = beerSpa();
  const base = { default_min_free_weekends: '2', weekend_priority: true, balance_pairs: [['M1', 'M4']] };
  const unavail = { 'Lucie:2026-12-24': true, 'Samuel:2026-12-05': true, 'Samuel:2026-12-06': true };
  let same = 0, total = 0;
  for(const [y, m] of [[2026, 11], [2027, 0], [2027, 1]]){
    for(const sd of [3, 17]){
      const a = canon(gen(bs, y, m, base, sd, { unavail }).S);
      const b = canon(gen(bs, y, m, Object.assign({}, base, { labor_rules: { enabled: true } }), sd, { unavail }).S);
      const c = canon(gen(bs, y, m, Object.assign({}, base, { labor_rules: { enabled: true }, shift_meta: { ZZ: { from: '6', to: '14' } } }), sd, { unavail }).S);
      const d = canon(gen(bs, y, m, Object.assign({}, base, { labor_rules: { enabled: false }, shift_meta: { M1: { from: '9', to: '21' } } }), sd, { unavail }).S);
      total++; if(a === b && a === c && a === d) same++;
    }
  }
  check('Beer Spa bez časů: rozpis stejný se zapnutým / vypnutým zákoníkem (6 běhů)', same === total, same + '/' + total);
}

// ── 2) pevné směny s časy ────────────────────────────────────────────────
function fixedOrg(lenCodes, people, extraBl){
  const n = lenCodes.length;
  const wp = {}; for(let d = 0; d < 7; d++) wp[d] = { min: n, target: n, max: n };
  return {
    branches: [{ id: 'b1', code: 'A', name: 'Pobočka 1', min_weekday: n, min_weekend: n, max_per_day: n, weekly_pattern: wp, sort_order: 0 }],
    shiftTypes: lenCodes.map(([c], i) => ({ id: 't' + c, branch_id: 'b1', code: c, label: c, sort_order: i })),
    employees: Array.from({ length: people.n }, (_, i) => Object.assign({ id: 'e' + i, name: 'Z' + i, is_fixed: false, branch_limits: { A: { shiftTypes: {} } }, max_x: 6, min_free_weekends: 0, sort_order: i }, people.lim)),
    meta: Object.fromEntries(lenCodes.map(([c, f, t]) => [c, { from: f, to: t }])),
  };
}
function laborOf(r, org, rules){
  const people = org.employees.map(e => ({ id: e.id, name: e.name, shifts: Object.values(r.S).filter(s => s.employee_id === e.id && s.shift_type_code !== 'X').map(s => ({ date: s.shift_date, code: s.shift_type_code })) }));
  return vm.runInContext('laborCheck(' + JSON.stringify({ year: 2026, month0: 11, rules, meta: org.meta, people }) + ')', r.sb);
}
const SCEN = [
  { label: '8 h R+O+N, 7 lidí',  codes: [['AR','6','14'],['AO','14','22'],['AN','22','6']], people: { n: 7, lim: { min_shifts: 16, target_shifts: 20, max_shifts: 22, max_consec: 5, min_rest: 1, ideal_rest: 2 } }, rules: {}, min: .90 },
  { label: '8 h R+O+N, 9 lidí',  codes: [['AR','6','14'],['AO','14','22'],['AN','22','6']], people: { n: 9, lim: { min_shifts: 12, target_shifts: 15, max_shifts: 22, max_consec: 5, min_rest: 1, ideal_rest: 2 } }, rules: {}, min: .97 },
  { label: '12 h D+N, 6 lidí',   codes: [['AD','7','19'],['AN','19','7']],                  people: { n: 6, lim: { min_shifts: 10, target_shifts: 13, max_shifts: 15, max_consec: 3, min_rest: 1, ideal_rest: 2 } }, rules: {}, min: .90 },
  { label: '24 h služba, 6 lidí (výjimka § 83a)', codes: [['AS','7','7']],                  people: { n: 6, lim: { min_shifts: 4, target_shifts: 6, max_shifts: 8, max_consec: 1, min_rest: 2, ideal_rest: 2 } }, rules: { long_exception: true }, min: .85 },
  { label: '8 h R+O, 6 lidí',    codes: [['AR','6','14'],['AO','14','22']],                  people: { n: 6, lim: { min_shifts: 14, target_shifts: 18, max_shifts: 21, max_consec: 5, min_rest: 1, ideal_rest: 2 } }, rules: {}, min: .95 },
];
SCEN.forEach((sc, i) => {
  const org = fixedOrg(sc.codes, sc.people);
  const settings = { weekend_priority: true, shift_meta: org.meta, labor_rules: Object.assign({ enabled: true }, sc.rules) };
  let worstFill = 1, bad = [];
  for(const sd of [5, 11, 29]){
    const r = gen(org, 2026, 11, settings, sd + i);
    const lc = laborOf(r, org, settings.labor_rules);
    lc.violations.filter(v => ['rest', 'week_rest', 'week_hours'].includes(v.kind)).forEach(v => bad.push(v.name + ' ' + (v.date || '') + ' ' + v.kind));
    const filled = Object.values(r.S).filter(s => s.shift_type_code !== 'X').length;
    worstFill = Math.min(worstFill, filled / (sc.codes.length * r.dim));
  }
  check(sc.label + ' — bez porušení § 90 / § 92 / stropu (3 běhy)', bad.length === 0, bad.slice(0, 4).join('; '));
  check(sc.label + ' — obsazeno nejhůř ' + Math.round(worstFill * 100) + ' % (≥ ' + Math.round(sc.min * 100) + ' %)', worstFill >= sc.min);
});

// ── 3) ruční noční ───────────────────────────────────────────────────────
{
  const org = fixedOrg([['AR','6','14'],['AO','14','22'],['AN','22','6']], { n: 8, lim: { min_shifts: 12, target_shifts: 18, max_shifts: 22, max_consec: 5, min_rest: 1, ideal_rest: 2 } });
  const settings = { weekend_priority: true, shift_meta: org.meta, labor_rules: { enabled: true } };
  const manual = {}; ['2026-12-03', '2026-12-10', '2026-12-17'].forEach(ds => { manual['e0:' + ds] = { employee_id: 'e0', shift_date: ds, shift_type_code: 'AN', is_auto: false }; });
  let ok = true;
  for(const sd of [2, 8]){
    const r = gen(org, 2026, 11, settings, sd, { shifts: manual });
    ['2026-12-04', '2026-12-11', '2026-12-18'].forEach(ds => { const s = r.S['e0:' + ds]; if(s && (s.shift_type_code === 'AR' || s.shift_type_code === 'AO')) ok = false; });
  }
  check('po ruční noční (3., 10., 17.) nedá druhý den ranní ani odpolední', ok);
}
// ── 4) přelom měsíce: noční 30. listopadu → 1. prosince žádná ranní ───────
{
  const org = fixedOrg([['AR','6','14'],['AO','14','22'],['AN','22','6']], { n: 8, lim: { min_shifts: 12, target_shifts: 18, max_shifts: 22, max_consec: 5, min_rest: 1, ideal_rest: 2 } });
  const settings = { weekend_priority: true, shift_meta: org.meta, labor_rules: { enabled: true } };
  const prev = {}; org.employees.forEach(e => { prev[e.id + ':2026-11-30'] = { employee_id: e.id, shift_date: '2026-11-30', shift_type_code: 'AN' }; });
  const r = gen(org, 2026, 11, settings, 4, { prev });
  const bad = org.employees.filter(e => { const s = r.S[e.id + ':2026-12-01']; return s && (s.shift_type_code === 'AR' || s.shift_type_code === 'AO'); });
  check('noční 30. 11. (minulý měsíc) → 1. 12. nikdo ranní ani odpolední', bad.length === 0, bad.map(e => e.id).join(','));
}

if(fail){ console.error('\n' + fail + ' kontrol selhalo'); process.exit(1); }
console.log('\nvše v pořádku');
