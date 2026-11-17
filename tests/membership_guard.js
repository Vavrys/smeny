// Test čistých pomocných funkcí z index.html (v0.9.34):
//   pickMembership()        — deterministický výběr firmy při víc členstvích
//   roleChangeBlockReason() — poslední admin nesmí přijít o roli
//   buildPendingState()     — omezený režim: anonymní snapshot → data pro rozpis (v0.9.35)
// Spuštění: node tests/membership_guard.js   (exit 1 = některá kontrola padla)
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
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extract('pickMembership') + '\n' + extract('roleChangeBlockReason') + '\n' + extract('buildPendingState'), ctx);

let fail = 0;
function check(label, cond){ if(!cond){ console.error('FAIL ' + label); fail++; } else console.log('ok   ' + label); }

const A = { org_id: 'A', role: 'admin', employee_id: null };      // reálná firma
const B = { org_id: 'B', role: 'admin', employee_id: null };      // prázdná firma
const W = { org_id: 'W', role: 'employee', employee_id: null };   // čekárna

check('žádné členství → null', ctx.pickMembership([], null) === null);
check('naposledy použitá firma vyhrává', ctx.pickMembership([B, A], 'A') === A);
check('neznámá poslední firma se ignoruje', ctx.pickMembership([A, B], 'ZZZ') === A);
check('plný přístup před čekárnou', ctx.pickMembership([W, A], null) === A);
check('jen čekárna → první', ctx.pickMembership([W], null) === W);
check('bez ukazatele bere první v pořadí (nejstarší)', ctx.pickMembership([A, B], null) === A);

const a1 = { id: 1, role: 'admin' }, a2 = { id: 2, role: 'admin' }, e1 = { id: 3, role: 'employee' };
check('poslední admin → degradace zakázána', !!ctx.roleChangeBlockReason([a1, e1], a1, 'employee'));
check('poslední admin → na manažera taky zakázáno', !!ctx.roleChangeBlockReason([a1, e1], a1, 'branch_manager'));
check('dva admini → degradace jednoho povolena', ctx.roleChangeBlockReason([a1, a2], a1, 'employee') === null);
check('povýšení na admina povoleno', ctx.roleChangeBlockReason([a1, e1], e1, 'admin') === null);
check('admin zůstává adminem povoleno', ctx.roleChangeBlockReason([a1], a1, 'admin') === null);
check('zaměstnanec → manažer povoleno', ctx.roleChangeBlockReason([a1, e1], e1, 'branch_manager') === null);

// ── buildPendingState (v0.9.35) ──
const snap = {
  org_name: 'Firma', published: true, published_months: ['2026-11'],
  branches: [{ id:'pb1', code:'A', name:'Pobočka A', color:'#111' }, { id:'pb2', code:'B', name:'Pobočka B', color:'#222' }],
  shift_types: [{ id:'pt2_1', code:'B1', label:'B1', branch_id:'pb2', color:'#333', sort_order:1 }],
  employee_count: 3,
  shifts: [[1, 5, 'A'], [3, 17, 'B1']],
};
const st = ctx.buildPendingState(snap, 2026, 10);
check('pending: počet kolegů odpovídá', st.employees.length === 3);
check('pending: jména jsou jen „Kolega N"', st.employees.every((e, i)=> e.name === 'Kolega ' + (i + 1)));
check('pending: žádné skutečné id zaměstnance', st.employees.every(e=> e.id.startsWith('anon-')));
check('pending: směna 5. 11. u kolegy 1', st.shifts['anon-1:2026-11-05']?.shift_type_code === 'A');
check('pending: směna 17. 11. u kolegy 3', st.shifts['anon-3:2026-11-17']?.shift_type_code === 'B1');
check('pending: pobočky bez skutečných názvů', st.branches.every(b=> /^Pobočka [A-Z]$/.test(b.name)));
check('pending: zveřejněné měsíce převzaty', JSON.stringify(st.orgSettings.published_months) === '["2026-11"]');
check('pending: prázdný snapshot nespadne', ctx.buildPendingState({}, 2026, 0).employees.length === 0);

if(fail){ console.error(fail + ' kontrol selhalo'); process.exit(1); }
console.log('vše v pořádku');
