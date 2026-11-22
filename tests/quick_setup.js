// Test rychlého nastavení (v0.9.44):
//   1) buildQuickSetupPlan() — čistá funkce: co se založí pro režimy flex / pevné 6/8/12/24 h
//      (kódy typů, časy, fond hodin podle § 79 ZP, limity zaměstnanců, kapacita)
//   2) generátor: nad vzorovými daty z plánu vygeneruje rozpis — nikdo nemá 2 směny
//      v jednom dni, nikdo nepřekročí max směn, používají se jen typy založené
//      plánem a při dostatku lidí je obsazenost vysoká.
// Spuštění: node tests/quick_setup.js   (exit 1 = některá kontrola padla)
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


let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

const sb0 = makeSandbox(1);
const plan = inp => vm.runInContext('buildQuickSetupPlan(' + JSON.stringify(inp) + ')', sb0);

// ── 1) plán ──────────────────────────────────────────────────────────────
{
  const p = plan({ employees: 4, mode: 'flex', perDay: 2 });
  check('flex: žádné typy směn', p.types.length === 0);
  check('flex: pobočka chce 2 lidi každý den', [0,1,2,3,4,5,6].every(d => p.branch.weekly_pattern[d].min === 2 && p.branch.weekly_pattern[d].max === 2));
  check('flex: 4 zaměstnanci, všichni smí na pobočku A', p.employees.length === 4 && p.employees.every(e => e.branch_limits.A && e.name.startsWith('Zaměstnanec ')));
  check('flex: fond 40 h týdně', p.stats.weeklyHours === 40);
  check('flex: akorát lidí → výchozí limity jako ve formuláři (12/15/17)', p.employees[0].min_shifts === 12 && p.employees[0].target_shifts === 15 && p.employees[0].max_shifts === 17);
}
{
  const p = plan({ employees: 2, mode: 'fixed', length: 8, night: false });
  check('8 h bez noci: Ranní + Odpolední', p.types.map(t => t.code).join() === 'AR,AO' && p.types[0].label === 'Ranní 6–14');
  check('8 h bez noci: dvousměnný fond 38,75 h', p.stats.weeklyHours === 38.75);
  check('8 h: pobočka chce obsadit oba typy denně', p.branch.weekly_pattern[3].min === 2 && p.branch.weekly_pattern[3].max === 2);
  check('8 h: plný úvazek ~21 směn, max o 2 víc', p.employees[0].target_shifts === 21 && p.employees[0].max_shifts === 23);
}
{
  // regrese: 10 lidí a 2 denně dá za měsíc jen ~60 směn, tj. ~6 na člověka. Výchozí minimum 12
  // by nešlo splnit nikdy (první rozpis nové firmy pak měl červenou tvrdou podmínku).
  const p = plan({ employees: 10, mode: 'flex', perDay: 2 });
  const e = p.employees[0], dem28 = 2 * 28;
  check('flex: přebytek lidí → minimum jde splnit', e.min_shifts * 10 <= dem28, 'min ' + e.min_shifts);
  check('flex: přebytek lidí → cíl odpovídá reálnému podílu (6)', e.target_shifts === 6 && e.min_shifts <= e.target_shifts && e.target_shifts <= e.max_shifts);
  check('flex: přebytek lidí je v souhrnu označen', p.stats.overstaffed === true && p.stats.actualPerPerson === 6 && p.stats.perPerson === 15);
}
{
  const p = plan({ employees: 6, mode: 'fixed', length: 8, night: true });
  check('8 h s nocí: R, O, N', p.types.map(t => t.code).join() === 'AR,AO,AN');
  check('8 h s nocí: nepřetržitý fond 37,5 h', p.stats.weeklyHours === 37.5);
  check('8 h s nocí: noční označená v shiftMeta', p.shiftMeta.AN.night === true && p.shiftMeta.AR.night === false);
  check('8 h s nocí: 3 směny denně ≈ 5 lidí', p.stats.needPeople === 5 && p.stats.enough === true);
}
{
  const p = plan({ employees: 4, mode: 'fixed', length: 12, night: true });
  check('12 h s nocí: Denní + Noční 19–7', p.types.map(t => t.label).join('|') === 'Denní 7–19|Noční 19–7');
  check('12 h: max 3 dny v kuse', p.employees[0].max_consec === 3);
}
{
  const p = plan({ employees: 3, mode: 'fixed', length: 24, night: false });
  check('24 h: jedna služba, noc vždy zahrnutá', p.types.length === 1 && p.night === true && p.types[0].night === true);
  check('24 h: max 1 den v kuse a 2 dny volna', p.employees[0].max_consec === 1 && p.employees[0].min_rest === 2);
  check('24 h: 3 lidé nestačí (díry)', p.stats.enough === false);
}
{
  const p = plan({ employees: 0, mode: 'nesmysl', length: 7, perDay: -3 });
  check('nesmyslný vstup: aspoň 1 člověk, flex, 1 denně', p.employees.length === 1 && p.mode === 'flex' && p.stats.perDay === 1);
}

// ── 2) generátor nad vzorovými daty ──────────────────────────────────────
function runGen(inp, seedN, year, month){
  const p = plan(inp);
  const sb = makeSandbox(seedN);
  const branches = [{ id: 'b1', ...p.branch, sort_order: 0 }];
  const shiftTypes = p.types.map((t, i) => ({ id: 't' + i, branch_id: 'b1', code: t.code, label: t.label, color: t.color, sort_order: t.sort_order }));
  const employees = p.employees.map((e, i) => ({ id: 'e' + i, ...e }));
  vm.runInContext(
    'schedYear = ' + year + '; schedMonth = ' + month + ';\n' +
    'branches = ' + JSON.stringify(branches) + ';\n' +
    'shiftTypes = ' + JSON.stringify(shiftTypes) + ';\n' +
    'employees = ' + JSON.stringify(employees) + ';\n' +
    'shifts = {}; unavail = {};\n' +
    "orgSettings = { weekend_priority:true };", sb, { filename: 'seed' });
  const dim = new Date(year, month + 1, 0).getDate();
  const S = sb.buildSchedule(dim, {});
  const codes = new Set(p.types.length ? p.types.map(t => t.code) : ['A']);
  const perEmp = {}, perDayCode = {}, errs = [];
  Object.values(S).forEach(s => {
    if(!s || s.shift_type_code === 'X') return;
    if(!codes.has(s.shift_type_code)) errs.push('neznámý kód ' + s.shift_type_code);
    perEmp[s.employee_id] = (perEmp[s.employee_id] || 0) + 1;
    const k = s.shift_date + '|' + s.shift_type_code; perDayCode[k] = (perDayCode[k] || 0) + 1;
  });
  employees.forEach(e => { if((perEmp[e.id] || 0) > e.max_shifts) errs.push(e.name + ' má ' + perEmp[e.id] + ' > max ' + e.max_shifts); });
  if(p.types.length) Object.entries(perDayCode).forEach(([k, n]) => { if(n > 1) errs.push('typ obsazen 2×: ' + k); });
  const demand = p.stats.perDay * dim;
  const filled = Object.values(perDayCode).reduce((a, b) => a + b, 0);
  return { p, errs, fill: filled / demand, filled, demand };
}

const GEN = [
  { inp: { employees: 10, mode: 'flex', perDay: 2 },                 min: 0.95, label: 'flex, 10 lidí, 2 denně' },
  { inp: { employees: 8,  mode: 'fixed', length: 8,  night: false }, min: 0.95, label: '8 h R+O, 8 lidí' },
  { inp: { employees: 7,  mode: 'fixed', length: 8,  night: true },  min: 0.90, label: '8 h R+O+N, 7 lidí' },
  { inp: { employees: 6,  mode: 'fixed', length: 12, night: true },  min: 0.90, label: '12 h D+N, 6 lidí' },
  { inp: { employees: 6,  mode: 'fixed', length: 24 },               min: 0.85, label: '24 h služba, 6 lidí' },
  { inp: { employees: 4,  mode: 'fixed', length: 6,  night: false }, min: 0.85, label: '6 h R+O, 4 lidé' },
];
GEN.forEach((g, i) => {
  let r;
  try { r = runGen(g.inp, 21 + i, 2026, 11); }
  catch(e){ check('generátor: ' + g.label, false, 'vyhodil: ' + e.message); return; }
  check('generátor: ' + g.label + ' — bez porušení', r.errs.length === 0, r.errs.slice(0, 3).join('; '));
  check('generátor: ' + g.label + ' — obsazeno ' + Math.round(r.fill * 100) + ' % (≥ ' + Math.round(g.min * 100) + ' %)', r.fill >= g.min, r.filled + '/' + r.demand);
});

// ── 3) první rozpis nové firmy musí splnit VŠE ───────────────────────────
// Stejná smyčka jako runAutoSchedule(): až 150 kandidátů, stop při ≥ 95 % bez tvrdých
// selhání. Tvrdé jsou pokrytí, minimum směn i víkendy (nejpřísnější možné nastavení).
function firstRun(inp, seedN, year, month){
  const p = plan(inp);
  const sb = makeSandbox(seedN);
  const branches = [{ id: 'b1', ...p.branch, sort_order: 0 }];
  const shiftTypes = p.types.map((t, i) => ({ id: 't' + i, branch_id: 'b1', code: t.code, label: t.label, color: t.color, sort_order: t.sort_order }));
  const employees = p.employees.map((e, i) => ({ id: 'e' + i, ...e }));
  vm.runInContext(
    'schedYear = ' + year + '; schedMonth = ' + month + ';\n' +
    'branches = ' + JSON.stringify(branches) + ';\n' +
    'shiftTypes = ' + JSON.stringify(shiftTypes) + ';\n' +
    'employees = ' + JSON.stringify(employees) + ';\n' +
    'shifts = {}; unavail = {};\n' +
    "orgSettings = { weekend_priority:true };\n" +
    'hardConstraints = { coverage:true, minshifts:true, weekends:true };', sb, { filename: 'seed' });
  const dim = new Date(year, month + 1, 0).getDate();
  let best = null;
  for(let run = 0; run < 150; run++){
    const cand = sb.buildSchedule(dim, {});
    const q = sb.computeQuality(cand, {});
    if(q.hardFailed.length === 0 && (!best || q.pct > best.pct)) best = q;
    if(best && best.pct >= 95) break;
  }
  return best;
}
const FIRST = [];
[1, 2, 3, 5].forEach(pd => [pd * 2, pd * 3, pd * 5, pd * 8, 20, 30].forEach(n => FIRST.push({ employees: n, mode: 'flex', perDay: pd })));
[6, 8, 12].forEach(len => [false, true].forEach(night => [4, 6, 8, 12, 20].forEach(n => FIRST.push({ employees: n, mode: 'fixed', length: len, night }))));
[[2026, 1], [2026, 10], [2026, 11]].forEach(([y, m]) => {   // únor (28 dní), listopad (30), prosinec (31)
  let bad = [], total = 0;
  FIRST.forEach((inp, i) => {
    const p = plan(inp);
    if(!p.stats.enough) return;                            // nedostatek lidí appka předem hlásí
    total++;
    let q;
    try { q = firstRun(inp, 100 + i, y, m); } catch(e){ bad.push(JSON.stringify(inp) + ' vyhodil ' + e.message); return; }
    if(!q) bad.push(JSON.stringify(inp) + ' → tvrdá podmínka nesplněna');
    else if(q.pct < 95) bad.push(JSON.stringify(inp) + ' → jen ' + q.pct + ' %');
  });
  check('první rozpis ' + (m + 1) + '/' + y + ': ' + total + ' konfigurací bez tvrdého selhání a ≥ 95 %', bad.length === 0, bad.slice(0, 4).join('; '));
});

if(fail){ console.error('\n' + fail + ' kontrol selhalo'); process.exit(1); }
console.log('\nvše v pořádku');
