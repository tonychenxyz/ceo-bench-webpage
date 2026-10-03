const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'assets/figures/runs-by-model.js'),'utf8')+';this.grid=RUNS_BY_MODEL',ctx);
const stats=read('assets/model-statistics.json'),manifest=read('trajectory-viewer/data/runs/manifest.json');
assert.equal(stats.length,Object.keys(ctx.grid).length);
const money=x=>'$'+x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.equal((html.match(/<table class="results-table">/g)||[]).length,1);
assert(!html.includes('native-runs'));assert(html.includes('Mean ± std. cash'));assert(!html.includes('Harness / effort'));
const table=html.match(/<table class="results-table">([\s\S]*?)<\/table>/)[1];
for(const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) assert.equal((row[1].match(/<t[dh][ >]/g)||[]).length,7);
let previous=Infinity;
for(const r of stats){const rr=ctx.grid[r.model];const cash=rr.map(x=>x.status==='bankrupt'?0:x.points.at(-1)[1]);const mean=cash.reduce((a,b)=>a+b,0)/cash.length;const std=Math.sqrt(cash.reduce((s,x)=>s+(x-mean)**2,0)/cash.length);assert(Math.abs(r.mean-mean)<.001);assert(Math.abs(r.std-std)<.001);assert.equal(r.best,Math.max(...cash));assert(r.best<=previous);previous=r.best;assert(html.includes(money(mean)+' ± '+money(std)));}
previous=Infinity;for(const m of manifest.models){assert(m.best_cash<=previous);previous=m.best_cash;let last=Infinity;for(const r of m.runs){assert(r.display_cash<=last);last=r.display_cash;}}
const master=read('assets/runs.json');assert(master.every(r=>!r.pretty.includes(' · ')));
assert(Object.keys(ctx.grid).every(x=>!x.includes(' · ')));
console.log(`Validated ${stats.length} ranked models: exact mean/std, bankruptcy=0, single table, model-only plot labels, sorted trajectories.`);
