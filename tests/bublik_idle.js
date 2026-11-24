// Test Bublíkovy nečinnosti (v0.9.59):
//   bublikIdleStage()     — úrovně podle délky nečinnosti
//   bublikBagNext()       — pytlík bez opakování
//   bublikIdleFacts()     — hlášky z rozpisu
//   bublikIdleThoughts()  — myšlenky podle úrovně
//   bublikReturnMessage() — pointa po návratu
// Spuštění: node tests/bublik_idle.js   (exit 1 = některá kontrola padla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name){
  const i = html.indexOf('function ' + name + '(');
  if(i < 0){ console.error('funkce nenalezena: ' + name); process.exit(1); }
  let depth = 0, j = html.indexOf('{', i);
  for(let k = j; k < html.length; k++){
    if(html[k] === '{') depth++;
    else if(html[k] === '}'){ depth--; if(depth === 0) return html.slice(i, k + 1); }
  }
  console.error('nedohledán konec funkce ' + name); process.exit(1);
}
function extractBlock(name){
  const i = html.indexOf('const ' + name + ' =');
  if(i < 0){ console.error('konstanta nenalezena: ' + name); process.exit(1); }
  let depth = 0, j = html.indexOf('{', i), k2 = html.indexOf('[', i);
  const open = (k2 >= 0 && k2 < j) ? '[' : '{', close = open === '[' ? ']' : '}';
  j = html.indexOf(open, i);
  for(let k = j; k < html.length; k++){
    if(html[k] === open) depth++;
    else if(html[k] === close){ depth--; if(depth === 0) return html.slice(i, k + 1) + ';'; }
  }
  console.error('nedohledán konec ' + name); process.exit(1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  extract('czNameDays'), extract('bubFirstName'), extract('bubDaysWord'), extract('bubWordForm'),
  extractBlock('BUB_MONTHS_GEN'), extractBlock('BUB_MONTHS_LOC'),
  extractBlock('BUB_IDLE_MILESTONES'), extractBlock('BUB_IDLE_LINES'), extractBlock('BUB_CREW_LINES'),
  extract('bublikIdleStage'), extract('bublikBagNext'), extract('bublikIdleFacts'),
  extract('bublikIdleThoughts'), extract('bubJoinCz'), extract('bublikReturnMessage'), extract('bublikVillagePhase'), extractBlock('BUB_VILLAGE_LINES'), extractBlock('BUB_ERAS'), extract('bublikPickEra'), extract('bublikNewspaper'), extract('bublikCareKey'), extract('bublikIsFem'), extract('bubDayList'), extract('bublikTabThoughts'),
  'this.ST = bublikIdleStage; this.BAG = bublikBagNext; this.F = bublikIdleFacts; this.TH = bublikIdleThoughts; this.R = bublikReturnMessage; this.M = BUB_IDLE_MILESTONES; this.L = BUB_IDLE_LINES; this.CL = BUB_CREW_LINES; this.VP = bublikVillagePhase; this.VL = BUB_VILLAGE_LINES; this.PE = bublikPickEra; this.NP = bublikNewspaper; this.CK = bublikCareKey; this.TT = bublikTabThoughts;',
].join('\n'), ctx);

let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

// úrovně
check('stage 0 do 1 min', ctx.ST(59999) === 0);
check('stage 1 od 1 min', ctx.ST(60000) === 1 && ctx.ST(179999) === 1);
check('stage 2 od 3 min', ctx.ST(180000) === 2);
check('stage 3 od 5 min', ctx.ST(300000) === 3);
check('stage 4 od 15 min', ctx.ST(900000) === 4);
check('stage 5 od 30 min', ctx.ST(1800000) === 5 && ctx.ST(9e7) === 5);
check('milníky pro 2–5', [2, 3, 4, 5].every(k => ctx.M[k] && ctx.M[k].length >= 3));

// pytlík
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const items = ['a', 'b', 'c', 'd', 'e'], used = [], got = [];
for(let i = 0; i < 5; i++) got.push(ctx.BAG(items, used, rnd));
check('pytlík: 5 tahů = 5 různých', new Set(got).size === 5, got.join(','));
const sixth = ctx.BAG(items, used, rnd);
check('pytlík: po vyčerpání začne znovu', items.includes(sixth) && used.length === 1);
check('pytlík: prázdný seznam = null', ctx.BAG([], [], rnd) === null);

// myšlenky
const t1 = ctx.TH(1), t3 = ctx.TH(3), t4 = ctx.TH(4);
check('myšlenek je hodně (≥ 35 na úrovni 1)', t1.length >= 35, String(t1.length));
check('úroveň 3 přidá osamělé', t3.length > t1.length && t3.some(t => ctx.L.lonely.includes(t)));
check('úroveň 4 přidá šílené', t4.length > t3.length && t4.some(t => ctx.L.silly.includes(t)));
check('úroveň 0 nic', ctx.TH(0).length === 0);
const all = [].concat(...Object.values(ctx.L));
check('žádná hláška dvakrát', new Set(all).size === all.length);
check('hlášky Bublíčků (≥ 10, bez duplicit, ne v ostatních)', ctx.CL.length >= 10 && new Set(ctx.CL).size === ctx.CL.length && ctx.CL.every(t => !all.includes(t)));
check('žádná hláška s "…" na konci místo textu', all.every(t => t.length > 15));

// fakta z rozpisu
const team = [{ id: 'a', name: 'Monika Mancová' }, { id: 'b', name: 'Lucie Bednářová' }, { id: 'c', name: 'Martin Cikán' }];
const sh = [];
for(let d = 1; d <= 9; d++) sh.push({ emp: 'a', date: `2026-11-${String(d).padStart(2, '0')}`, code: 'M1' });
for(let d = 10; d <= 13; d++) sh.push({ emp: 'b', date: `2026-11-${d}`, code: 'U' });
sh.push({ emp: 'c', date: '2026-11-14', code: 'U' }, { emp: 'a', date: '2026-11-14', code: 'M2' });
const facts = ctx.F({ now: new Date('2026-11-14T10:00:00'), y: 2026, m0: 10, team, shifts: sh, xCount: 6, branchOf: { M1: 'Majestic', M2: 'Majestic', U: 'Ungelt' } });
check('fakt: kdo má nejvíc směn', facts.some(f => f.startsWith('Monika má v listopadu 10 směn')), facts.join(' | '));
check('fakt: kdo má nejmíň', facts.some(f => f.startsWith('Martin má zatím jen 1 směnu')));
check('fakt: víkendový hrdina (Monika, so+ne)', facts.some(f => f.includes('víkendový hrdina')));
check('fakt: nejvíc lidí v jeden den', facts.some(f => f.includes('Nejvíc lidí je v práci 14. listopadu: 2')));
check('fakt: pobočka s nejvíc směnami', facts.some(f => f.includes('Majestic (10)')));
check('fakt: volna', facts.some(f => f.includes('6×')));
check('fakt: dnes v práci', facts.some(f => f.startsWith('Dnes v práci:')));
const evil = ctx.F({ now: new Date('2026-11-14T10:00:00'), y: 2026, m0: 10, team: [{ id: 'x', name: '<b>Zlý</b>' }, { id: 'y', name: 'Eva' }], shifts: [{ emp: 'x', date: '2026-11-01', code: 'U' }, { emp: 'x', date: '2026-11-02', code: 'U' }, { emp: 'y', date: '2026-11-03', code: 'U' }], xCount: 0, branchOf: {} });
check('jména jsou escapovaná', evil.every(f => !f.includes('<b>Zlý')), evil.join(' | '));
check('prázdný rozpis = žádná fakta o směnách', ctx.F({ now: new Date(), y: 2026, m0: 10, team, shifts: [], xCount: 0, branchOf: {} }).every(f => f.startsWith('Psst')));

// pointa po návratu
check('pod 3 min nic', ctx.R(170000, { moments: ['x'] }, {}) === null);
const r0 = () => 0, r9 = () => .99;
const M3 = ['vylezl po zdi', 'dloubal do směn', 'nalepil ti vzkaz'];
check('4 minuty: alibi místo počítání', ctx.R(240000, { moments: ['vylezl po zdi'] }, {}, r0) === 'Jé, jsi zpátky! Já nic. Jen jsem vylezl po zdi.', ctx.R(240000, { moments: ['vylezl po zdi'] }, {}, r0));
check('4 minuty bez momentů', ctx.R(240000, {}, {}, r0).startsWith('Jé, jsi zpátky!'));
check('žádná čísla kousků', [240000, 600000, 1200000, 2400000].every(ms => [r0, r9].every(r => !/\d/.test(ctx.R(ms, { moments: M3, antics: 12, flights: 4 }, {}, r)))));
check('10 minut: dvě věci', /vylezl po zdi|dloubal do směn|nalepil ti vzkaz/.test(ctx.R(600000, { moments: M3 }, {}, r0)) && / a /.test(ctx.R(600000, { moments: M3 }, {}, r0)), ctx.R(600000, { moments: M3 }, {}, r0));
check('20 minut: tři věci', ctx.R(1200000, { moments: M3 }, {}, r0).split(/, | a /).length >= 3, ctx.R(1200000, { moments: M3 }, {}, r0));
check('Bublíčci v pointě', ctx.R(600000, { clones: 3 }, {}, r0).includes('Chvíli nás bylo víc'));
check('nepořádek v pointě', /uklizeno|jiný Bublík/.test(ctx.R(1200000, { mess: 3 }, {}, r9)), ctx.R(1200000, { mess: 3 }, {}, r9));
check('česká spojka', ctx.R(1200000, { moments: ['a1', 'b2', 'c3'] }, {}, () => .5).match(/a1|b2|c3/g).length === 3);
check('fáze dne', ['noc','noc','rano','rano','prace','prace','obed','prace','vecer','vecer','noc'].join() === [0,5,6,8,9,11,12,16,17,21,22].map(h => ctx.VP(h)).join(), [0,5,6,8,9,11,12,16,17,21,22].map(h => ctx.VP(h)).join());
check('hlášky Bublíkova bez duplicit', ctx.VL.length >= 8 && new Set(ctx.VL).size === ctx.VL.length && ctx.VL.every(t => !all.includes(t) && !ctx.CL.includes(t)));
check('pointa s vesnicí', ctx.R(7200000, {}, {}, r0).includes('Spal jsem') && /Bublíkovo|vesnici/.test(ctx.R(7200000, { village: { houses: 4, fire: true, pop: 9 } }, {}, r0)));
// civilizace (v0.9.64)
{
  let sd = 3; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const cnt = care => { const c = {}; for(let i = 0; i < 2000; i++){ const e = ctx.PE(care, [], r); c[e] = (c[e] || 0) + 1; } return c; };
  const base = cnt({}), thr = cnt({ throws: 20 }), work = cnt({ autofill: 10, publish: 5 }), pets = cnt({ clicks: 60 }), sl = cnt({ sleeps: 15 });
  check('epochy: bez péče vede republika', Object.entries(base).sort((a, b) => b[1] - a[1])[0][0] === 'republika', JSON.stringify(base));
  check('epochy: hody → piráti', Object.entries(thr).sort((a, b) => b[1] - a[1])[0][0] === 'pirati', JSON.stringify(thr));
  check('epochy: práce → věda', Object.entries(work).sort((a, b) => b[1] - a[1])[0][0] === 'veda', JSON.stringify(work));
  check('epochy: kliky → umění', Object.entries(pets).sort((a, b) => b[1] - a[1])[0][0] === 'umeni', JSON.stringify(pets));
  check('epochy: uspávání → olympiáda', Object.entries(sl).sort((a, b) => b[1] - a[1])[0][0] === 'olympiada', JSON.stringify(sl));
  check('epochy: proběhlé se neopakují', [...Array(200)].every(() => !['republika', 'veda'].includes(ctx.PE({}, ['republika', 'veda'], r))));
  check('epochy: všechny proběhly = null', ctx.PE({}, ['republika', 'pirati', 'veda', 'umeni', 'olympiada'], r) === null);
  const np = ctx.NP({ date: 'pátek 20. listopadu 2026', eras: [{ id: 'veda', info: {} }, { id: 'republika', info: { mayor: '<i>Šumák</i>' } }], houses: 4, pop: 9, articles: ['22:10 — Šumák postavil domek č. 2.', 'a', 'b', 'c'], useful: ['2 nepřečtené notifikace'] });
  check('noviny: titulek podle poslední epochy, escapovaný', np.includes('&lt;i&gt;Šumák&lt;/i&gt; novým starostou Bublíkova!'), np);
  check('noviny: podtitulek s epochami', np.includes('Mezitím: věk vědy → republika'));
  check('noviny: max 3 články', (np.match(/<li>/g) || []).length === 3);
  check('noviny: užitečné', np.includes('Mezitím ve Směnách:</b> 2 nepřečtené notifikace'));
  const np0 = ctx.NP({ date: 'x', eras: [], houses: 1, pop: 3, articles: [], useful: [] });
  check('noviny: bez epochy', np0.includes('Bublíkovo slaví: 1 domek a 3 obyvatelé') && !np0.includes('bp-useful') && !np0.includes('<ul'));
  check('noviny: rod (starostka, vyhrála)', ctx.NP({ date: 'x', eras: [{ id: 'republika', info: { mayor: 'Bublinka' } }], houses: 4, pop: 5, articles: [], useful: [] }).includes('Bublinka novou starostkou') && ctx.NP({ date: 'x', eras: [{ id: 'olympiada', info: { champion: 'Kapka' } }], houses: 4, pop: 5, articles: [], useful: [] }).includes('Kapka vyhrála první'));
check('klíč péče podle dne', ctx.CK(new Date(2026, 10, 5)) === 'bublik_care_2026-11-05');
}
check('notifikace a žádosti', ctx.R(600000, {}, { unread: 2, pendingLeaves: 1 }).endsWith('Mimochodem: máš 2 nepřečtené notifikace a 1 žádost o volno.'));

// myšlenky podle záložky (v0.9.70)
{
  const base = { team: ['Lucie', 'Martin', '<b>X'], branches: ['Plaza', 'Ungelt'], holes: [3, 14, 22, 27], rules: { min_rest: 11, max_week: 48, max_shift: 12, weekly_rest: 35 }, pending: 2, m0: 10 };
  const tabs = ['gaps', 'rules', 'employees', 'branches', 'stats', 'leaves', 'myschedule'];
  check('každá záložka má aspoň 1 myšlenku', tabs.every(t => ctx.TT({ ...base, tab: t }).length >= 1));
  check('rozpis a neznámá záložka nic', ctx.TT({ ...base, tab: 'schedule' }).length === 0 && ctx.TT({ ...base, tab: 'xyz' }).length === 0);
  check('mezery: počet a dny', ctx.TT({ ...base, tab: 'gaps' })[0].includes('V listopadu chybí lidi 4 dny (3., 14., 22. a další)'), ctx.TT({ ...base, tab: 'gaps' })[0]);
  check('mezery: bez mezer', ctx.TT({ ...base, tab: 'gaps', holes: [] }).some(t => t.includes('Žádné mezery')));
  check('pravidla z nastavení firmy', ['11 h', '48 h', '12 h', '35 h'].every(v => ctx.TT({ ...base, tab: 'rules' }).join(' ').includes(v)));
  check('žádosti: skloňování', ctx.TT({ ...base, tab: 'leaves' })[0].startsWith('2 žádosti o volno') && ctx.TT({ ...base, tab: 'leaves', pending: 5 })[0].startsWith('5 žádostí'));
  check('zaměstnanci: počet', ctx.TT({ ...base, tab: 'employees' })[0].includes('Je vás tu 3. Se mnou 4.'));
  check('jména escapovaná', !ctx.TT({ ...base, tab: 'employees', team: ['<b>X'] }).join(' ').includes('<b>'));
  check('pobočky: jedna', ctx.TT({ ...base, tab: 'branches', branches: ['Karolína'] })[0].includes('Jedna pobočka, Karolína'));
}

if(fail){ console.error(`\n${fail} kontrol selhalo`); process.exit(1); }
console.log('\nVše v pořádku.');
