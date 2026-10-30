const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const summary = read('assets/native-run-summary.json');
const manifest = read('trajectory-viewer/data/runs/manifest.json');
const best = read('assets/runs.json');
const context = {}; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'assets/figures/runs-by-model.js'),'utf8')+';this.data = RUNS_BY_MODEL',context);
assert.equal(summary.length,12);assert.equal(new Set(summary.map(r=>r.run_id)).size,12);
let actions=0;
for (const model of new Set(summary.map(r=>r.model))) {
  const rr=summary.filter(r=>r.model===model);assert.equal(rr.length,3);
  assert.equal(manifest.models.filter(m=>m.model===model).length,1);
  assert.equal(manifest.models.find(m=>m.model===model).runs.length,3);
  assert.equal(best.find(r=>r.model===model).final_cash,Math.max(...rr.map(r=>r.cash)));
}
for (const meta of summary) {
  const run=read(`trajectory-viewer/data/runs/${meta.run_id}.json`);
  const points=run.cash_series;
  assert.equal(points.at(-1).day,500);assert.equal(points.at(-1).cash,meta.cash);
  assert(points.every((p,i)=>Number.isFinite(p.cash)&&(!i||p.day>points[i-1].day)));
  const events=fs.readFileSync(path.join(root,`trajectory-viewer/data/transcripts/${run.run_id}.jsonl`),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(a=>!a.tool.startsWith('_')).length,run.action_count);
  assert.equal(Object.values(run.days).flatMap(d=>d.actions).filter(a=>!a.tool.startsWith('_')).length,run.action_count);
  assert(run.days_list.length>20);assert(run.sources.every(s=>s.sha256.length===64));
  assert.equal(run.reasoning_effort,'xhigh');assert(['Claude Code','Codex CLI'].includes(run.harness));
  const plot=Object.values(context.data).flat().find(r=>r.run_id===run.run_id);assert(plot);assert.equal(plot.points.at(-1)[1],run.cash);
  if(run.extended_time){assert.equal(run.original_outcome.day,455);assert.equal(run.original_outcome.status,'infrastructure_failed');assert.equal(run.sources.length,2);assert(events.some(a=>a.tool==='_continuation'));}
  actions+=run.action_count;
}
assert.equal(summary.filter(r=>r.extended_time).length,1);
console.log(`Validated 12 runs, four model groups, ${actions} tool calls, scores, chart endpoints, source hashes and continuation provenance.`);
