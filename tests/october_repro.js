// Repro říjen 2026 (Beer Spa) — volné víkendy. Data jsou PŘIBLIŽNÁ: oprávnění odvozená
// z toho, co kdo v říjnu reálně dělal, X ze screenshotu, min/cíl/max odhadnuté.
// Kontrola: nejlepší z N běhů (jako „Automaticky doplnit") nesmí mít nikoho pod
// minimem volných víkendů a musí splnit tvrdé podmínky.
// Použití: node tests/october_repro.js [index.html] [počet běhů]   (exit 1 = selhalo)
const fs=require('fs'),path=require('path'),vm=require('vm');
const INDEX=process.argv[2]||path.join(__dirname,'..','index.html');
const RUNS=+(process.argv[3]||40);
const html=fs.readFileSync(INDEX,'utf8');
const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;const blocks=[];let m;while((m=re.exec(html)))blocks.push(m[1]);
function mkEl(){return{style:{setProperty(){},removeProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},children:[],value:'',textContent:'',innerHTML:'',checked:false,options:[],files:[],appendChild(c){return c},removeChild(){},insertBefore(c){return c},setAttribute(){},getAttribute(){return null},removeAttribute(){},hasAttribute(){return false},addEventListener(){},removeEventListener(){},querySelector(){return mkEl()},querySelectorAll(){return[]},closest(){return null},focus(){},blur(){},click(){},remove(){},scrollIntoView(){},getBoundingClientRect(){return{top:0,left:0,right:0,bottom:0,width:100,height:100}},insertAdjacentHTML(){},cloneNode(){return mkEl()}}}
function mkStorage(){const s={};return{getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]},clear(){},key:()=>null,length:0}}
function seededRandom(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function makeSandbox(seedN){const document={readyState:'complete',body:mkEl(),documentElement:mkEl(),head:mkEl(),cookie:'',getElementById(){return null},querySelector(){return null},querySelectorAll(){return[]},createElement(){return mkEl()},createTextNode(){return mkEl()},addEventListener(){},removeEventListener(){}};
const MathStub=Object.create(Math);MathStub.random=seededRandom(seedN);
const sb={console:{log(){},warn(){},error(){},group(){},groupEnd(){},table(){},info(){},debug(){}},Math:MathStub,Date,JSON,setTimeout,clearTimeout,setInterval,clearInterval,document,localStorage:mkStorage(),sessionStorage:mkStorage(),navigator:{userAgent:'node',onLine:true,serviceWorker:{register(){return Promise.resolve()},addEventListener(){}},clipboard:{writeText(){return Promise.resolve()}}},location:{href:'http://localhost/',hostname:'localhost',search:'',hash:'',origin:'http://localhost',reload(){}},history:{replaceState(){},pushState(){}},requestAnimationFrame:cb=>0,cancelAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({}),text:()=>Promise.resolve('')}),alert(){},confirm(){return false},prompt(){return null},addEventListener(){},removeEventListener(){},dispatchEvent(){},Intl,URL,URLSearchParams,TextEncoder,TextDecoder,crypto:require('crypto').webcrypto,Promise,Error,Object,Array,String,Number,Boolean,RegExp,Map,Set,WeakMap,WeakSet,Symbol,Proxy,Reflect,isNaN,isFinite,parseInt,parseFloat,encodeURIComponent,decodeURIComponent,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),supabase:{createClient:()=>new Proxy({},{get:()=>()=>new Proxy({},{get:()=>()=>Promise.resolve({data:[],error:null})})})}};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);blocks.forEach((b,i)=>{try{vm.runInContext(b,sb,{filename:'s'+i})}catch(e){}});return sb}

const ds=d=>'2026-10-'+String(d).padStart(2,'0');
const noM=(allowed)=>{const st={};['M1','M2','M3','M4'].forEach(c=>{if(!allowed.includes(c))st[c]={max:0}});return {shiftTypes:st}};
const noP=(allowed)=>{const st={};['P1','P2'].forEach(c=>{if(!allowed.includes(c))st[c]={max:0}});return {shiftTypes:st}};
const FT={min_shifts:15,target_shifts:17,max_shifts:19};
const base={is_fixed:false,max_x:10,max_consec:5,min_rest:2,ideal_rest:2,min_free_weekends:0};
const E=[
 {id:'martin',name:'Martin',...FT,branch_limits:{U:{},MAJ:noM(['M1']),PLZ:noP(['P2'])}},
 {id:'vojtech',name:'Vojtěch',...FT,branch_limits:{U:{},MAJ:noM(['M2'])}},
 {id:'linda',name:'Linda',...FT,branch_limits:{MAJ:noM(['M1','M3','M4']),PLZ:noP(['P2'])}},
 {id:'tereza',name:'Tereza',...FT,branch_limits:{U:{},K:{},MAJ:noM(['M1','M2'])}},
 {id:'domg',name:'Gorčák',...FT,branch_limits:{U:{},K:{},MAJ:noM(['M1','M2','M3','M4'])}},
 {id:'lucie',name:'Lucie',...FT,branch_limits:{K:{},MAJ:noM(['M1','M2','M3']),PLZ:noP(['P2'])}},
 {id:'monika',name:'Monika',...FT,branch_limits:{K:{},MAJ:noM(['M1','M2','M3','M4'])}},
 {id:'tomas',name:'Tomáš',...FT,is_fixed:true,branch_limits:{MAJ:{}}},
 {id:'frant',name:'František',...FT,branch_limits:{U:{},K:{},MAJ:noM(['M1','M3','M4'])}},
 {id:'bina',name:'Bína',...FT,branch_limits:{MAJ:noM(['M1','M2','M3','M4'])}},
 {id:'marcos',name:'Marcos',min_shifts:6,target_shifts:8,max_shifts:8,branch_limits:{MAJ:noM(['M1','M3','M4'])}},
 {id:'maxim',name:'Maxim',min_shifts:0,target_shifts:0,max_shifts:0,branch_limits:{}},
 {id:'hedvika',name:'Hedvika',min_shifts:12,target_shifts:14,max_shifts:22,branch_limits:{PLZ:{},MAJ:noM(['M3'])}},
 {id:'mario',name:'Mario',min_shifts:9,target_shifts:11,max_shifts:11,branch_limits:{PLZ:noP(['P1'])}},
 {id:'veronika',name:'Veronika',min_shifts:12,target_shifts:14,max_shifts:18,branch_limits:{PLZ:noP(['P1'])}},
].map(e=>({...base,...e}));
const X={martin:[2,3,4,5,9,14,27,28],vojtech:[9,10,11,12,23,24,25,31],tereza:[1,2,10,11,12,14,22,23,24,25,31],
 domg:[2,3,4,7,14,16,17,18,21,28],lucie:[16,17,18,23,24,25,28],frant:[10,18,24,30,31],marcos:[7,16,17,18]};
const unavail={};Object.entries(X).forEach(([id,ds_])=>ds_.forEach(d=>unavail[id+':'+ds(d)]={employee_id:id,date:ds(d)}));
const shifts={};[1,2,5,7,8,12,13,14,15,19,20,21,22,26,27,28,29].forEach(d=>shifts['tomas:'+ds(d)]={employee_id:'tomas',shift_date:ds(d),shift_type_code:'M2',is_auto:false});
const wp=(wkMin,wkT,wkMax,weMin,weT,weMax,friT)=>{const p={};for(let w=0;w<7;w++){const we=w===0||w===6;p[w]=we?{min:weMin,target:weT,max:weMax}:{min:wkMin,target:w===5?friT:wkT,max:wkMax}}return p};
const branches=[
 {id:'bu',code:'U',name:'Ungelt',max_per_day:1,weekly_pattern:wp(1,1,1,1,1,1,1)},
 {id:'bk',code:'K',name:'Karolína',max_per_day:1,weekly_pattern:wp(1,1,1,1,1,1,1)},
 {id:'bm',code:'MAJ',name:'Majestic',max_per_day:4,weekly_pattern:wp(3,3,4,3,4,4,4)},
 {id:'bp',code:'PLZ',name:'Plaza',max_per_day:2,weekly_pattern:wp(1,2,2,1,2,2,2)},
];
const shiftTypes=[{code:'M1',branch_id:'bm'},{code:'M2',branch_id:'bm'},{code:'M3',branch_id:'bm'},{code:'M4',branch_id:'bm'},{code:'P1',branch_id:'bp'},{code:'P2',branch_id:'bp'}];
function seed(sb){vm.runInContext(`schedYear=2026;schedMonth=9;branches=${JSON.stringify(branches)};shiftTypes=${JSON.stringify(shiftTypes)};employees=${JSON.stringify(E)};shifts=${JSON.stringify(shifts)};unavail=${JSON.stringify(unavail)};orgSettings={default_min_free_weekends:'2',weekend_priority:true,balance_pairs:[['M1','M4',true]]};`,sb)}
const pairs=[[3,4],[10,11],[17,18],[24,25]];
const show=['bina','frant','linda','monika','hedvika','marcos','martin','vojtech','tereza','domg','lucie','mario','veronika'];
let agg={},w1={bina:0,frant:0},fails=0,cands=[];
for(let r=1;r<=RUNS;r++){const sb=makeSandbox(1000+r);seed(sb);const S=sb.buildSchedule(31,{});
 const q=sb.computeQuality(S,sb.unavail);
 let gaps=0;for(let d=1;d<=31;d++){for(const codes of [['M1','M2','M3','M4'],['P1','P2']]){const f=codes.map(c=>Object.values(S).some(s=>s.shift_date===ds(d)&&s.shift_type_code===c));const last=f.lastIndexOf(true);if(f.slice(0,last+1).includes(false))gaps++;}}const work=(id,d)=>{const s=S[id+':'+ds(d)];return s&&s.shift_type_code!=='X'};
 const fw={};show.forEach(id=>{fw[id]=pairs.filter(p=>p.every(d=>!work(id,d))).length;agg[id]=(agg[id]||0)+fw[id]});
 const below=show.filter(id=>fw[id]<2);
 if(work('bina',3)||work('bina',4))w1.bina++; if(work('frant',3)||work('frant',4))w1.frant++;
 cands.push({r,gaps,pct:q.pct,hard:q.hardFailed.length,below,fw,cnt:Object.fromEntries(show.map(id=>[id,Object.values(S).filter(s=>s.employee_id===id&&s.shift_type_code!=='X').length]))});
}
const feas=cands.filter(c=>c.hard===0);const best=(feas.length?feas:cands).sort((a,b)=>b.pct-a.pct)[0];
console.log(path.basename(INDEX),'runs',RUNS,'feasible',feas.length);
console.log('avg volné víkendy:',show.map(id=>id+'='+(agg[id]/RUNS).toFixed(2)).join(' '));
console.log('W1 pracuje: Bína',w1.bina+'/'+RUNS,' František',w1.frant+'/'+RUNS);
console.log('avg lidí pod min víkendů:',(cands.reduce((a,c)=>a+c.below.length,0)/RUNS).toFixed(2),' běhů bez nikoho pod min:',cands.filter(c=>!c.below.length).length);
console.log('dny s dírou v typech (M3 bez M2 apod.): avg',(cands.reduce((a,c)=>a+c.gaps,0)/RUNS).toFixed(2),' nejlepší:',best.gaps);
console.log('avg pct',(cands.reduce((a,c)=>a+c.pct,0)/RUNS).toFixed(1));
console.log('NEJLEPŠÍ (best-of):',best.pct+'%','hard',best.hard,'pod min:',best.below.join(',')||'nikdo','fw',JSON.stringify(best.fw));
console.log('   směny',JSON.stringify(best.cnt));

const ok = best.hard===0 && best.below.length===0 && best.gaps===0;
console.log(ok ? '✓ nejlepší rozpis: všichni mají min. volných víkendů' : '✗ FAIL: pod minimem volných víkendů: '+best.below.join(','));
process.exit(ok?0:1);
