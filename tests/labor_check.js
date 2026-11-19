// Test kontroly zákoníku práce (v0.9.49): laborCheck() a pomocné funkce
//   § 83 délka směny, § 90 odpočinek mezi směnami, § 92 odpočinek v týdnu,
//   § 94 noční pracovník, týdenní strop hodin. Bez časů (flex) = nic se nekontroluje.
// Spuštění: node tests/labor_check.js   (exit 1 = některá kontrola padla)
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
  const m = /;\r?\n/.exec(html.slice(i));
  return html.slice(i, i + m.index + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext([extractConst('LABOR_DEFAULTS'), extract('laborParseHM'), extract('laborSpan'), extract('laborNightMinutes'),
  extract('laborHours'), extract('laborFmtH'), extract('laborCheck'),
  'this.L = laborCheck; this.P = laborParseHM; this.S = laborSpan; this.N = laborNightMinutes;'].join('\n'), ctx);

let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

// pomocné
check('čas 6 / 06:00 / 22:30 / 24', ctx.P('6') === 360 && ctx.P('06:00') === 360 && ctx.P('22:30') === 1350 && ctx.P('24') === 1440);
check('nesmysl → null', ctx.P('25') === null && ctx.P('abc') === null && ctx.P('') === null && ctx.P('7:75') === null);
{ const s = ctx.S('2026-12-01', { from: '22', to: '6' }); check('noční přes půlnoc = 8 h', s.end - s.start === 480); check('noční 22–6 = 480 min noci', ctx.N(s) === 480); }
{ const s = ctx.S('2026-12-01', { from: '7', to: '7' }); check('stejný čas = 24 h', s.end - s.start === 1440); check('24h služba 7–7 má 8 h noci', ctx.N(s) === 480); }
{ const s = ctx.S('2026-12-01', { from: '6', to: '14' }); check('ranní 6–14 bez noci', ctx.N(s) === 0); }
{ const s = ctx.S('2026-12-01', { from: '19', to: '7' }); check('noční 19–7: 8 h v noční době', ctx.N(s) === 480); }

const META = { AR: { from: '6', to: '14' }, AO: { from: '14', to: '22' }, AN: { from: '22', to: '6' }, AD: { from: '7', to: '19' }, NN: { from: '19', to: '7' }, S24: { from: '7', to: '7' }, L13: { from: '6', to: '19' } };
const run = (shifts, rules = {}, meta = META) => ctx.L({ year: 2026, month0: 11, rules, meta, people: [{ id: 'e1', name: 'Lucie', shifts }] });
const D = d => `2026-12-${String(d).padStart(2, '0')}`;
const kinds = r => r.violations.map(v => v.kind);

// bez časů → nic
{
  const r = ctx.L({ year: 2026, month0: 11, rules: {}, meta: {}, people: [{ id: 'e1', name: 'X', shifts: Array.from({ length: 31 }, (_, i) => ({ date: D(i + 1), code: 'M1' })) }] });
  check('flex bez časů (Beer Spa): nekontroluje se, žádné upozornění', r.checked === false && r.violations.length === 0);
}
{
  const r = run([{ date: D(1), code: 'AR' }], { enabled: false });
  check('vypnutá kontrola → nic', r.checked === false && r.violations.length === 0);
}
// § 90 odpočinek
{
  const r = run([{ date: D(1), code: 'AN' }, { date: D(2), code: 'AR' }]);
  check('noční → hned ranní: 0 h odpočinku', kinds(r).includes('rest') && r.violations.find(v => v.kind === 'rest').date === D(2));
}
{
  const r = run([{ date: D(1), code: 'AN' }, { date: D(2), code: 'AO' }]);
  check('noční (do 6) → odpolední (od 14): 8 h < 11 h', r.violations.some(v => v.kind === 'rest' && /jen 8 h/.test(v.text)));
}
{
  const r = run([{ date: D(1), code: 'AO' }, { date: D(2), code: 'AR' }]);
  check('odpolední (do 22) → ranní (od 6): 8 h < 11 h', kinds(r).includes('rest'));
}
{
  const r = run([{ date: D(1), code: 'AR' }, { date: D(2), code: 'AR' }, { date: D(3), code: 'AO' }]);
  check('ranní → ranní → odpolední: vše ≥ 11 h', !kinds(r).includes('rest'), JSON.stringify(r.violations));
}
{
  const r = run([{ date: D(1), code: 'AN' }, { date: D(2), code: 'AO' }], { min_rest: 8 });
  check('nastavené minimum 8 h → 8 h projde', !kinds(r).includes('rest'));
}
// § 83 délka
{
  const r = run([{ date: D(1), code: 'L13' }]);
  check('13h směna > 12 h', r.violations.some(v => v.kind === 'shift' && /13 h/.test(v.text)));
}
{
  const r = run([{ date: D(1), code: 'S24' }]);
  check('24h služba bez výjimky → upozornění', kinds(r).includes('shift'));
  const r2 = run([{ date: D(1), code: 'S24' }], { long_exception: true });
  check('24h služba s výjimkou § 83a → OK', !kinds(r2).includes('shift'));
}
{
  const r = run([{ date: D(1), code: 'AD' }]);
  check('12h směna je přesně na limitu → OK', !kinds(r).includes('shift'));
}
// § 92 odpočinek v týdnu — prosinec 2026: pondělí 7., 14., 21., 28.; plné týdny 7–13, 14–20, 21–27
{
  const sh = []; for(let d = 7; d <= 13; d++) sh.push({ date: D(d), code: 'AR' });
  const r = run(sh);
  check('7 ranních v týdnu po sobě → chybí 35 h volna', r.violations.some(v => v.kind === 'week_rest' && v.date === D(7)));
}
{
  const sh = []; for(let d = 7; d <= 11; d++) sh.push({ date: D(d), code: 'AR' });  // po–pá ranní, so+ne volno
  const r = run(sh);
  check('po–pá ranní, víkend volno → OK', !kinds(r).includes('week_rest'), JSON.stringify(r.violations));
}
{
  // pá 11. odpolední (končí 22:00), so volno, ne 13. ranní (6:00) → volno 32 h; jinak týden plný
  const sh = [7, 8, 9, 10].map(d => ({ date: D(d), code: 'AR' })).concat([{ date: D(11), code: 'AO' }, { date: D(13), code: 'AR' }]);
  const r = run(sh);
  check('jen 32 h volna o víkendu → upozornění § 92', r.violations.some(v => v.kind === 'week_rest' && /32 h/.test(v.text)));
}
{
  // neúplný týden na začátku měsíce (1.–6.) se na § 92 nehodnotí
  const sh = [1, 2, 3, 4, 5, 6].map(d => ({ date: D(d), code: 'AR' }));
  const r = run(sh);
  check('neúplný týden na kraji měsíce se nehodnotí', !kinds(r).includes('week_rest'));
}
// týdenní strop
{
  const sh = [7, 8, 9, 10, 11].map(d => ({ date: D(d), code: 'AD' }));   // 5× 12 h = 60 h
  const r = run(sh);
  check('5× 12 h v týdnu = 60 h > 48 h', r.violations.some(v => v.kind === 'week_hours' && /60 h/.test(v.text)));
}
// § 94 noční pracovník
{
  const sh = []; for(let d = 1; d <= 31; d += 3) sh.push({ date: D(d), code: 'NN' });   // 11 nocí po 12 h
  const r = run(sh);
  // 11 × 12 = 132 h; 31/7 týdnů × 5 = 22,14 dne → 5,96 h → OK
  check('noční 12h každý 3. den: průměr ~6 h na pětidenní týden → OK', !kinds(r).includes('night_avg'), JSON.stringify(r.violations.filter(v => v.kind === 'night_avg')));
}
{
  const sh = []; for(let d = 1; d <= 31; d++) if(d % 4 !== 0) sh.push({ date: D(d), code: d % 2 ? 'NN' : 'AD' });   // 24 směn po 12 h
  const r = run(sh, { min_rest: 0, weekly_rest: 0, max_week: 100 });
  check('hodně 12h směn s nocemi → průměr nad 8 h (§ 94)', kinds(r).includes('night_avg'));
}
// přes pobočky: člověk má směny na dvou pobočkách — počítá se dohromady
{
  const r = run([{ date: D(1), code: 'AO' }, { date: D(2), code: 'AR' }], {}, { AO: { from: '14', to: '22' }, AR: { from: '6', to: '14' } });
  check('kontrola jde přes kódy různých poboček', kinds(r).includes('rest'));
}
// mix: jedna pobočka s časy, druhá bez — bez časů se ignoruje
{
  const r = run([{ date: D(1), code: 'AO' }, { date: D(2), code: 'M1' }, { date: D(3), code: 'AR' }]);
  check('směna bez času (M1) se do odpočinku nepočítá', !kinds(r).includes('rest'));
}

if(fail){ console.error('\n' + fail + ' kontrol selhalo'); process.exit(1); }
console.log('\nvše v pořádku');
