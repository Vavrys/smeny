// Test hromadného nastavení zaměstnanců (v0.9.48): bulkEmployeePlan()
//   — prázdné pole = beze změny, mění se jen to, co se opravdu liší
//   — kontrola min ≤ cíl ≤ max a min volno ≤ ideální po sloučení s hodnotami člověka
//   — přidání / odebrání pobočky v branch_limits nesmaže limity ostatních poboček
// Spuštění: node tests/bulk_employees.js   (exit 1 = některá kontrola padla)
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
// konstanta až po středník na konci řádku (LF i CRLF)
function extractConst(name){
  const i = html.indexOf('const ' + name + ' =');
  if(i < 0){ console.error('konstanta nenalezena: ' + name); process.exit(1); }
  const m = /;\r?\n/.exec(html.slice(i));
  return html.slice(i, i + m.index + 1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractConst('BULK_NUM_FIELDS') + '\n' + extract('bulkEmployeePlan') + '\nthis.plan = bulkEmployeePlan;', ctx);

let fail = 0;
function check(label, cond, info){ if(!cond){ console.error('FAIL ' + label + (info ? ' — ' + info : '')); fail++; } else console.log('ok   ' + label); }

const mk = (id, o = {}) => Object.assign({ id, name: 'Z' + id, min_shifts: 12, target_shifts: 15, max_shifts: 17, max_x: 6, max_consec: 4, min_rest: 1, ideal_rest: 2, min_free_weekends: 0, employment_type: 'full', branch_limits: { M: { max: 10, shiftTypes: { M1: { max: 3 } } } } }, o);
const E = [mk('a'), mk('b', { target_shifts: 14 }), mk('c', { employment_type: 'part', branch_limits: {} })];

{
  const r = ctx.plan(E, ['a', 'b', 'c'], {});
  check('nic nevyplněno → žádné změny', r.updates.length === 0 && r.errors.length === 0);
}
{
  const r = ctx.plan(E, ['a', 'b'], { target_shifts: '15' });
  check('mění jen ty, kdo hodnotu ještě nemají', r.updates.length === 1 && r.updates[0].id === 'b' && r.updates[0].patch.target_shifts === 15);
}
{
  const r = ctx.plan(E, ['a', 'b', 'c'], { min_shifts: '10', max_shifts: '20' });
  check('víc polí najednou všem vybraným', r.updates.length === 3 && r.updates.every(u => u.patch.min_shifts === 10 && u.patch.max_shifts === 20));
}
{
  const r = ctx.plan(E, ['a'], {}); const r2 = ctx.plan(E, ['a'], { min_shifts: '' , max_x: null });
  check('prázdný řetězec / null = beze změny', r.updates.length === 0 && r2.updates.length === 0);
}
{
  const r = ctx.plan(E, ['a', 'b'], { min_shifts: '16' });
  check('min nad cílem → chyba u obou', r.errors.length === 2 && /min 16 \/ cíl 15/.test(r.errors[0]));
}
{
  const r = ctx.plan(E, ['a'], { max_shifts: '14' });
  check('max pod cílem → chyba', r.errors.length === 1);
}
{
  const r = ctx.plan(E, ['a'], { min_rest: '3' });
  check('min volno nad ideálním → chyba', r.errors.length === 1 && /min volno 3/.test(r.errors[0]));
}
{
  const r = ctx.plan(E, ['a', 'c'], { addBranch: 'K' });
  const a = r.updates.find(u => u.id === 'a').patch.branch_limits;
  check('přidání pobočky zachová limity ostatních', a.K && a.M && a.M.max === 10 && a.M.shiftTypes.M1.max === 3);
  check('původní objekt se nezměnil', !E[0].branch_limits.K);
}
{
  const r = ctx.plan(E, ['a', 'b', 'c'], { removeBranch: 'M' });
  check('odebrání pobočky jen tam, kde je', r.updates.length === 2 && r.updates.every(u => !u.patch.branch_limits.M));
}
{
  const r = ctx.plan(E, ['a', 'c'], { employment_type: 'part' });
  check('typ úvazku jen u toho, kdo ho nemá', r.updates.length === 1 && r.updates[0].id === 'a');
}
{
  const r = ctx.plan(E, ['b'], { target_shifts: '-3', max_x: 'abc' });
  check('záporná a nečíselná hodnota se ignoruje', r.updates.length === 0);
}

if(fail){ console.error('\n' + fail + ' kontrol selhalo'); process.exit(1); }
console.log('\nvše v pořádku');
