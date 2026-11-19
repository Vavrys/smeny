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
  extractBlock('BUB_IDLE_MILESTONES'), extractBlock('BUB_IDLE_LINES'),
  extract('bublikIdleStage'), extract('bublikBagNext'), extract('bublikIdleFacts'),
  extract('bublikIdleThoughts'), extract('bublikReturnMessage'),
  'this.ST = bublikIdleStage; this.BAG = bublikBagNext; this.F = bublikIdleFacts; this.TH = bublikIdleThoughts; this.R = bublikReturnMessage; this.M = BUB_IDLE_MILESTONES; this.L = BUB_IDLE_LINES;',
].join('\n'), ctx);

let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

// úrovně
check('stage 0 do 30 s', ctx.ST(29999) === 0);
check('stage 1 od 30 s', ctx.ST(30000) === 1 && ctx.ST(179999) === 1);
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
check('pod 3 min nic', ctx.R(170000, { antics: 5 }, {}) === null);
check('4 minuty', /^Jé, jsi zpátky! Byl jsi pryč 4 minuty\. Stihl jsem 3 kousky\.$/.test(ctx.R(240000, { antics: 3 }, {})), ctx.R(240000, { antics: 3 }, {}));
check('10 minut', ctx.R(600000, { antics: 12, flights: 4 }, {}).includes('10 minut. Mezitím jsem 12× zablbnul a 4× proletěl'));
check('20 minut', ctx.R(1200000, {}, {}).startsWith('Konečně! 20 minut.'));
check('hodina a půl', ctx.R(5400000, {}, {}).includes('1 hodinu a 30 minut'), ctx.R(5400000, {}, {}));
check('notifikace a žádosti', ctx.R(600000, {}, { unread: 2, pendingLeaves: 1 }).endsWith('Mimochodem: máš 2 nepřečtené notifikace a 1 žádost o volno.'));

if(fail){ console.error(`\n${fail} kontrol selhalo`); process.exit(1); }
console.log('\nVše v pořádku.');
