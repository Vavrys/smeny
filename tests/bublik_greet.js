// Test Bublíkových hlášek při přihlášení (v0.9.46):
//   czNameDays()                — kalendář jmen: 366 dní, svátky bez jména, víc jmen
//   bublikGreetingCandidates()  — co by mohl říct (svátek, směny, den, zajímavost)
//   bublikPickGreeting()        — co nakonec řekne (přednosti, 70 % užitečné)
// Spuštění: node tests/bublik_greet.js   (exit 1 = některá kontrola padla)
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
function extractConst(name){
  const i = html.indexOf('const ' + name + ' =');
  if(i < 0){ console.error('konstanta nenalezena: ' + name); process.exit(1); }
  const end = html.slice(i).search(/;\r?\n/); // CRLF i LF pracovní kopie
  return html.slice(i, i + end + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  extract('czNameDays'), extract('bubFirstName'), extract('bubDaysWord'), extract('bubDayList'),
  extractConst('BUB_MONTHS_GEN'), extractConst('BUB_MONTHS_LOC'), extractConst('BUB_MONTHS_NOM'),
  extractConst('BUB_DOW_LOC'), extractConst('BUB_HOLIDAYS'),
  extract('bublikGreetingCandidates'), extract('bublikPickGreeting'),
  extract('bublikAutofillMessage'), extract('bublikPublishMessage'),
  'this.C = bublikGreetingCandidates; this.P = bublikPickGreeting; this.N = czNameDays; this.AF = bublikAutofillMessage; this.PM = bublikPublishMessage;',
].join('\n'), ctx);

let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

// ── kalendář ─────────────────────────────────────────────────
let days = 0, named = 0;
for(let m = 0; m < 12; m++){
  const dim = new Date(2024, m + 1, 0).getDate();
  for(let d = 1; d <= dim; d++){ days++; if(ctx.N(m, d).length) named++; }
  check('měsíc ' + (m + 1) + ': den za koncem měsíce nic nevrací', ctx.N(m, dim + 1).length === 0);
}
check('366 dní, jména skoro všude', days === 366 && named >= 350, named + '/' + days);
check('13. 12. Lucie', ctx.N(11, 13).join() === 'Lucie');
check('18. 11. Romana', ctx.N(10, 18).join() === 'Romana');
check('29. 6. Petr a Pavel', ctx.N(5, 29).join() === 'Petr,Pavel');
check('1. 1. a 25. 12. bez jména', ctx.N(0, 1).length === 0 && ctx.N(11, 25).length === 0);
check('29. 2. bez jména', ctx.N(1, 29).length === 0);
check('23. 4. Vojtěch, 4. 8. Dominik', ctx.N(3, 23).join() === 'Vojtěch' && ctx.N(7, 4).join() === 'Dominik');

// ── kandidáti ────────────────────────────────────────────────
const base = (o = {}) => Object.assign({
  now: new Date(2026, 10, 18, 14, 0), role: 'admin', myName: 'Vavrys Admin',
  team: ['Lucie Nováková', 'Samuel K.', 'Monika'], pendingLeaves: 0,
  month: { y: 2026, m0: 10, shiftCount: 120, holes: [], published: true },
  nextPublished: true, myNext: null,
}, o);
const kinds = c => c.map(x => x.kind);
const has = (c, re) => c.some(x => re.test(x.html));

{
  const c = ctx.C(base({ pendingLeaves: 2 }));
  check('admin: žádosti o volno', has(c, /2 žádosti o volno/));
}
{
  const c = ctx.C(base({ month: { y: 2026, m0: 10, shiftCount: 120, holes: [9, 17, 23, 28], published: true } }));
  check('admin: díry v rozpisu (4 dny, první 3 vypsané)', has(c, /chybí obsadit <b>4 dny<\/b> \(9\., 17\., 23\. a další\)/));
}
{
  const c = ctx.C(base({ month: { y: 2026, m0: 10, shiftCount: 0, holes: [], published: false } }));
  check('admin: prázdný měsíc → Automaticky doplnit', has(c, /zatím prázdný/));
}
{
  const c = ctx.C(base({ now: new Date(2026, 10, 25, 9), nextPublished: false }));
  check('admin: po 20. upozorní na nezveřejněný další měsíc', has(c, /Za 6 dní začíná prosinec/));
}
{
  const c = ctx.C(base());
  check('admin: všechno hotové → kafe', has(c, /Můžeš si dát kafe/));
  check('svátek dne mimo tým', has(c, /Dnes má svátek Romana\. Z týmu nikdo/));
}
{
  const c = ctx.C(base({ now: new Date(2026, 11, 13, 12) }));
  check('svátek člena týmu dnes', has(c, /Dnes má svátek <b>Lucie<\/b> z vašeho týmu/));
}
{
  const c = ctx.C(base({ now: new Date(2026, 11, 10, 12) }));
  check('svátek člena týmu za 3 dny', has(c, /Za 3 dny má svátek <b>Lucie<\/b>/));
}
{
  const c = ctx.C(base({ role: 'employee', myName: 'Lucie Nováková', now: new Date(2026, 11, 13, 12), myNext: { inDays: 1, dateStr: '2026-12-14', label: 'M1 · Majestic' } }));
  const p = ctx.P(c, () => .99);
  check('můj svátek má vždy přednost a stydí se', p.kind === 'me' && p.shy === true);
  check('zaměstnanec: zítřejší směna', has(c, /Zítra máš <b>M1 · Majestic<\/b>/));
  check('zaměstnanec: nevidí věci pro admina', !has(c, /žádost|chybí obsadit|kafe/));
}
{
  const c = ctx.C(base({ role: 'employee', myName: 'Samuel', myNext: { inDays: 3, dateStr: '2026-11-21', label: 'Karolína' } }));
  check('zaměstnanec: směna za 3 dny „V sobotu 21.“', has(c, /V sobotu 21\. máš <b>Karolína<\/b>/));
}
{
  const c = ctx.C(base({ role: 'employee', myName: 'Samuel', month: { y: 2026, m0: 10, shiftCount: 50, holes: [], published: false } }));
  check('zaměstnanec: nezveřejněný měsíc', has(c, /ještě není zveřejněný/));
}
{
  const c = ctx.C(base({ now: new Date(2026, 9, 28, 10) }));
  const p = ctx.P(c, () => .99);
  check('státní svátek má přednost', p.kind === 'holiday' && /Den vzniku samostatného Československa/.test(p.html));
}
{
  const c = ctx.C(base({ now: new Date(2026, 11, 24, 10) }));
  check('Štědrý den', ctx.P(c, () => .5).html.startsWith('Štědrý den'));
}
{
  const c = ctx.C(base({ pendingLeaves: 1 }));
  check('výběr: rnd < 0,7 → užitečné', ctx.P(c, () => .1).kind === 'useful');
  check('výběr: rnd ≥ 0,7 → něco pro radost', ctx.P(c, () => .95).kind !== 'useful');
}
{
  // nikdy nevyčítá
  const all = [];
  for(let m = 0; m < 12; m++) for(const h of [7, 14, 23]) ctx.C(base({ now: new Date(2026, m, 15, h), pendingLeaves: 3 })).forEach(c => all.push(c.html));
  check('žádná hláška nevyčítá', !all.some(t => /měl bys|zase jsi|nezapomeň|proč jsi/i.test(t)));
}

// ── reakce na appku (v0.9.47) ────────────────────────────────
{
  const a = ctx.AF(true, 92, []);
  check('doplnění bez děr → oslava + Publikovat', a.kind === 'celebrate' && /92 % a žádná díra/.test(a.html) && /Publikovat/.test(a.html));
  const b = ctx.AF(true, 88, [3, 9, 17, 23, 30]);
  check('doplnění s dírami → tip, 5 dní, první 3 vypsané', b.kind === 'nudge' && /<b>5 dní<\/b> \(3\., 9\., 17\. a další\)/.test(b.html));
  const c = ctx.AF(false, 71, [1, 2]);
  check('nesplnitelné → starost + Proč?', c.kind === 'worry' && /Proč\?/.test(c.html));
  check('publikování → plácnem si', /prosinec 2026 je venku!.*Plácnem si\?/.test(ctx.PM('prosinec 2026', false)));
  check('publikování bez doručení → dej vědět', /nepodařilo doručit/.test(ctx.PM('prosinec 2026', true)));
}

if(fail){ console.error('\n' + fail + ' kontrol selhalo'); process.exit(1); }
console.log('\nvše v pořádku');
