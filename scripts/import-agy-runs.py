#!/usr/bin/env python3
"""Export Gemini 4 Argon (High) Antigravity CLI trajectories. Run with --source /path/to/ceobench_runs.
Reuses the native exporter's cleaning, day observation, rationale, workspace-edit and subscriber helpers.
No credentials, internal agy databases, or account metadata are exported.
"""
import argparse, collections, hashlib, importlib.util, json, math, pathlib, re
P=pathlib.Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,P/'scripts'/file);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
native=load('exporter','import-native-runs.py');details=load('details','enrich-native-details.py');groups=load('groups','import-subscriber-groups.py')
MODEL,PRETTY,HARNESS,EFFORT='gemini-4-argon-high','Gemini 4 Argon','Antigravity CLI','high'
# (batch, run, continuation batch/run or None). Run 3 resumed the same game and agy conversation after a 429 quota error.
RUNS=[('20261028-argon-agy','argon-high-tony',None),('20261029-argon-agy-two','argon-high-tony-2',None),('20261029-argon-agy-two','argon-high-tony-3',('20261029-argon-run3-resume','argon-high-tony-3-resumed'))]
SKIP=('days','cash_series','sub_series','seat_series','seat_series_by_group','group_discovery','weeks_index','customer_series_by_group','subscriber_group_sources')
def clean(x):
    x=native.clean(x)
    if isinstance(x,dict):return {k:clean(v) for k,v in x.items()}
    if isinstance(x,list):return [clean(v) for v in x]
    if isinstance(x,str):
        x=re.sub(r'\b(?:AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z._-]+|1//[0-9A-Za-z_-]{30,})','[REDACTED]',x)
        return x.replace('\r\n','\n').replace('/scratch/gpfs/ZHUANGL/hc5019','/workspace')
    return x

def db_arguments(folder,conversation):
    """Full write_file/edit_file arguments from agy's saved conversation DB (tool-call JSON only; outputs are not readable)."""
    import sqlite3
    found={}
    for db in sorted(folder.glob(f'logs/agy-internal-*-{conversation}.db')):
        con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
        for idx,payload in con.execute('select idx,step_payload from steps where step_type=132'):
            m=re.search(rb'call_\d+[^\w]{1,6}(write_file|edit_file)[^{]{0,6}\{',payload or b'')
            if not m:continue
            try:obj,_=json.JSONDecoder().raw_decode(payload[m.end()-1:].decode('utf-8','replace'))
            except ValueError:continue
            found[idx]=(m.group(1).decode(),obj)
        con.close()
    return found

def scrub(x):
    """Replace local run paths everywhere, including fields added after clean()."""
    if isinstance(x,dict):return {k:scrub(v) for k,v in x.items()}
    if isinstance(x,list):return [scrub(v) for v in x]
    if isinstance(x,str):return x.replace('/scratch/gpfs/ZHUANGL/hc5019','/workspace')
    return x

def arguments(tool,p):
    if tool=='run_command':return {'command':p.get('CommandLine','')}
    if tool in ('read_file','write_file','edit_file'):
        a={'path':p.get('Path','')}
        if p.get('StartLine'):a['start_line']=p['StartLine']
        if p.get('EndLine'):a['end_line']=p['EndLine']
        return a
    return dict(p)

def events(path,start_day=0,full=None):
    """agy stream-json has no per-step timestamps: days come only from observed dashboard/status outputs."""
    out=[];pending={};texts={};day=start_day;turn=0;responses=set()
    def observe(t):
        nonlocal day
        found=re.findall(r'=== Week \d+ Dashboard \(Day (\d+)\) ===',t)
        found+=re.findall(r'"success":\s*true,\s*"day":\s*(\d+)',t)
        found+=re.findall(r'"current_day":\s*(\d+)',t) if '"session_id"' in t else []
        if found:day=max(day,max(map(int,found)))
    def add(tool,args,result,line):
        a=dict(tool=tool,arguments=clean(args),result=clean(result),day=day,turn=turn,source_line=line);out.append(a);return a
    for line,s in enumerate(path.open(),1):
        d=json.loads(s);kind=d.get('event')
        if kind=='step_update':
            u=d['step_update'];idx=u['step_index'];typ=u.get('step_type')
            if typ=='agent_response':
                if idx not in responses:responses.add(idx);turn+=1
                if u.get('text_delta'):
                    if idx in texts:texts[idx]['result']+=clean(u['text_delta'])
                    else:texts[idx]=add('_message',{},u['text_delta'],line)
            elif typ=='tool':
                info=u.get('tool_info') or {};a=pending.get(idx)
                if a is None:
                    name=u.get('tool_name') or info.get('name','tool');args=arguments(name,info.get('parameters',{}))
                    f=(full or {}).get(idx)
                    if f and f[0]==name and f[1].get('Path')==args.get('path'):
                        if name=='write_file':args['content']=f[1].get('Content','')
                        elif name=='edit_file':args.update(old_string=f[1].get('Target',''),new_string=f[1].get('Replacement',''))
                    a=pending[idx]=add(name,args,'',line)
                if u.get('state') in ('DONE','ERROR'):
                    value=info.get('output') or ''
                    if info.get('error'):value=(value+'\n' if value else '')+'Error: '+str(info['error'].get('message',''))
                    a['result']=clean(value);a['result_source_line']=line;observe(a['result'])
        elif kind=='result':
            r=d.get('result',{})
            if r.get('error'):add('_agent_exit',{},f"Agent run ended with status {r.get('status')}: {r['error']}",line)
    for a in out:
        if a['tool']=='_message':a['result']=a['result'].strip()
    return [a for a in out if a['tool']!='_message' or a['result']]

def enrich(run):
    """Same rationale and literal-heredoc workspace-edit recovery as enrich-native-details.py."""
    state={};rationales={}
    for day,data in sorted(run['days'].items(),key=lambda x:int(x[0])):
        data['workspace_edits']=[]
        for action in data['actions']:
            if action['tool'] in ('write_file','edit_file'):
                if 'content' in action['arguments'] or 'new_string' in action['arguments']:data['workspace_edits'].extend(details.edits(action,state))
                else:state.pop(action['arguments'].get('path'),None)
                continue
            if action['tool']!='run_command':continue
            for e in details.edits(dict(action,tool='Bash'),state):
                if e['tool']=='Bash':e['tool']='run_command'
                data['workspace_edits'].append(e)
            try:tokens=details.shlex.split(action['arguments']['command'].replace('\\\n',''))
            except ValueError:continue
            if 'next-week' in tokens:
                tail=tokens[tokens.index('next-week')+1:]
                if tail[:1]==['--request-id']:tail=tail[2:]
                if tail and len(tail[0])>40:rationales[int(day)]=tail[0]
    for day,text in rationales.items():run['days'].setdefault(str(day),{'actions':[],'workspace_edits':[]})['rationale']=clean(text)
    run['days_list']=sorted(map(int,run['days']))

def json_groups(run,expected):
    """Active individual subscriptions per group from recorded JSON `query` outputs (COUNT by group_id with
    status='subscribed'); a snapshot is kept only if its total equals that day's dashboard individual count."""
    snapshots={0:{}};sources={}
    for day,d in sorted(run['days'].items(),key=lambda x:int(x[0])):
        for action in d['actions']:
            cmd=action.get('arguments',{}).get('command','')
            if 'subscriptions' not in cmd or not re.search(r"status\s*=\s*['\"]subscribed['\"]",cmd) or not re.search(r'GROUP BY[^;]*group_id',cmd,re.I):continue
            text=action.get('result','');start=text.find('{')
            try:obj,_=json.JSONDecoder().raw_decode(text[start:]) if start>=0 else (None,0)
            except ValueError:continue
            rows=obj.get('rows') if isinstance(obj,dict) else None
            if not rows or 'group_id' not in rows[0]:continue
            cols=[k for k,v in rows[0].items() if k!='group_id' and isinstance(v,int) and not isinstance(v,bool) and re.fullmatch(r'(?i)(cnt|count|n|subs|subscribers|active\w*|num\w*)',k)]
            if not cols:continue
            counts=collections.Counter()
            for row in rows:
                g=row.get('group_id')
                if isinstance(g,str) and g.startswith(('S','D_S')):counts[g]+=row.get(cols[0]) or 0
            if counts and int(day) in expected and sum(counts.values())==expected[int(day)]['individual']:
                snapshots[int(day)]=dict(counts);sources[str(day)]={'source_line':action.get('source_line'),'source_segment':action.get('source_segment',1)}
    groups_=sorted({g for c in snapshots.values() for g in c})
    return [{'day':day,'group_id':g,'count':counts.get(g,0)} for day,counts in sorted(snapshots.items()) for g in groups_],sources

def subscribers(run,exports=None):
    """Operator subscription-lifetime export when available (every dashboard day must match), else recorded snapshots."""
    expected=groups.dashboards(run)
    export=exports/(run['session_id']+'.json') if exports else None
    if export and export.exists():
        data=json.loads(export.read_text());series=data['customer_series_by_group']
        assert 'subscriptions joined' in data['source']
        totals=collections.Counter()
        for point in series:totals[point['day']]+=point['count']
        bad=[[d,totals.get(d),e['individual']] for d,e in expected.items() if d<=data['last_day'] and totals.get(d)!=e['individual']]
        assert not bad,(run['session_id'],bad[:12])
        run['customer_series_by_group']=series;run['customer_group_label']='SUBSCRIBERS';run['subscriber_group_source']=data['source']
        run['subscriber_group_validation']={'dashboard_days_matched':sorted(d for d in expected if d<=data['last_day'])}
        run.pop('subscriber_group_sources',None)
        merged={day:total for day,total in totals.items()};merged.update({day:e['individual'] for day,e in expected.items()})
        run['sub_series']=[{'day':day,'subscribers':total} for day,total in sorted(merged.items())]
        run['subscribers']=run['sub_series'][-1]['subscribers'];run['seat_series']=[{'day':day,**c} for day,c in sorted(expected.items())]
        return
    series,sources=groups.trace_groups(run)
    if len({p['day'] for p in series})<=1:series,sources=json_groups(run,expected)
    totals=collections.Counter()
    for point in series:totals[point['day']]+=point['count']
    matches=[day for day,total in totals.items() if day in expected and total==expected[day]['individual']]
    run['customer_series_by_group']=series if len(totals)>1 and matches else []
    run['customer_group_label']='SUBSCRIBERS'
    run['subscriber_group_source']='Recorded active individual subscription query snapshots; only observed days are included. No interpolation.' if run['customer_series_by_group'] else 'No per-group subscription snapshots were recorded in the agent stream; totals come from observed weekly dashboards.'
    if run['customer_series_by_group']:run['subscriber_group_sources']=sources
    run['subscriber_group_validation']={'dashboard_days_matched':matches if run['customer_series_by_group'] else []}
    merged={day:total for day,total in totals.items()} if run['customer_series_by_group'] else {}
    merged.update({day:s['individual'] for day,s in expected.items()})
    run['sub_series']=[{'day':day,'subscribers':total} for day,total in sorted(merged.items())]
    run['subscribers']=run['sub_series'][-1]['subscribers'] if run['sub_series'] else None
    run['seat_series']=[{'day':day,**counts} for day,counts in sorted(expected.items())]

def main(source,exports=None):
    results=[]
    for batch,name,cont in RUNS:
        folder=source/batch/'results'/name;spec=native.read(folder/'spec.json');result=native.read(folder/'result.json');original=None;ext=None
        if cont:ext=source/cont[0]/'results'/cont[1];original=result;result=native.read(ext/'result.json')
        assert spec['model']==MODEL and spec['agent']=='agy'
        sid=result['simulation']['session_id'];rid='native-'+sid
        if original:assert original['simulation']['session_id']==sid
        paths=[folder/'logs/agent-001.jsonl']+([ext/'logs/agent-001.jsonl'] if ext else [])
        resume_day=original['simulation']['current_day'] if original else None
        acts=[];sources=[]
        for idx,path in enumerate(paths):
            conversation=next((json.loads(x).get('conversation_id') for x in path.open() if '"init"' in x),None)
            part=events(path,resume_day if idx else 0,db_arguments(path.parent.parent,conversation) if conversation else None)
            for a in part:a['source_segment']=idx+1
            if idx:acts.append(dict(tool='_continuation',arguments={},result=f'User-authorized continuation after a Google API 429 quota error stopped the agent at day {resume_day} (${original["simulation"]["cash"]:,.2f}). Same saved game and agy conversation; simulator restarted in a new container at the same day and cash. No rollback or replacement game.',day=resume_day,turn=0))
            acts+=part
            sources.append(dict(batch=path.relative_to(source).parts[0],run=path.parent.parent.name,file='logs/agent-001.jsonl',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),lines=sum(1 for _ in path.open())))
        # Monitored committed snapshots, not interpolated daily observations.
        points={0:1000000.0}
        for b,run in [(source/batch,name)]+([(source/cont[0],cont[1])] if cont else []):
            for l in (b/'monitor-history.jsonl').open():
                for r in json.loads(l)['runs']:
                    if r['id']==run and r.get('day') is not None and r.get('cash') is not None:points[int(r['day'])]=r['cash']
        score=result['cash_day_500']['rows'][0]['cash_day_500'];bankrupt=result['state']=='bankrupt'
        last=result['simulation']['current_day']
        if bankrupt:
            assert points[last]==result['simulation']['cash']<=0 and not any(c<=0 for d,c in points.items() if d<last)
            points[last]=0;cash=0
            curve_source='Committed simulator snapshots; lines connect observed samples. Ends at $0 on the bankruptcy day.'
        else:
            points[500]=score;cash=score
            curve_source='Committed simulator snapshots; lines connect observed samples. Exact day-500 ledger total.'
        points={d:c for d,c in sorted(points.items()) if d<=500}
        days={}
        for a in acts:days.setdefault(str(a['day']),{'actions':[]})['actions'].append(a)
        if not bankrupt:days.setdefault('500',{'actions':[]})['actions'].append(dict(tool='_score',arguments={},result=f'Exact day-500 ledger cash: ${score:,.2f}. Terminal day 504: ${result["simulation"]["cash"]:,.2f}.',day=500,turn=0))
        tools=sum(not a['tool'].startswith('_') for a in acts)
        r=dict(run_id=rid,model=MODEL,model_display=PRETTY,label=f'{name} · {batch}',harness=HARNESS,reasoning_effort=EFFORT,provider='Modal',seed=42,session_id=sid,public_revision=spec['commit'],total_days=500,current_day=last,survival_days=last if bankrupt else 500,status='bankrupt' if bankrupt else 'complete',bankrupt=bankrupt,dnf=False,cash=cash,final_cash=cash,terminal_cash=result['simulation']['cash'],subscribers=None,mrr=None,founder_dividends=0,agent_turns=None,action_count=tools,tool_calls_count=tools,cash_series=[dict(day=d,cash=c) for d,c in points.items()],sub_series=[],seat_series=[],seat_series_by_group=[],group_discovery=[],days=days,days_list=sorted(map(int,days)),weeks_index=[],curve_source=curve_source,sources=sources,simulator_llm='AWS Bedrock Haiku',restart_note='No simulator restart found in reviewed run records.',trajectory_note='Commands, outputs and available agent text exported from Antigravity CLI stream JSON. The stream has no per-step timestamps, so days are assigned from the latest observed dashboard/status output; source line and segment preserve ordering. Tool outputs are as streamed (capped at 10 KB); file write/edit contents and model reasoning are not in the stream and are not reconstructed.',extended_time=bool(ext))
        if bankrupt:r.update(raw_final_cash=result['simulation']['cash'],ledger_final_cash=score)
        if ext:r.update(restart_note=f'Simulator restarted once to resume the same saved game at day {resume_day} in a new container.',original_outcome=dict(status=original['state'],day=resume_day,cash=original['simulation']['cash'],reason='google_api_429_quota'),continuation_day=resume_day)
        enrich(r);subscribers(r,exports)
        r=scrub(r);acts=scrub(acts)
        native.dump(P/'trajectory-viewer/data/runs'/f'{rid}.json',r)
        dest=P/'trajectory-viewer/data/transcripts'/f'{rid}.jsonl';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(''.join(json.dumps(a,ensure_ascii=False)+'\n' for a in acts))
        results.append(r)
    # Aggregates follow the native exporter's formats.
    cash=[r['cash'] for r in results];mean=sum(cash)/len(cash);std=math.sqrt(sum((c-mean)**2 for c in cash)/len(cash))
    survival=[r['survival_days'] for r in results];ms=sum(survival)/len(survival);ss=math.sqrt(sum((s-ms)**2 for s in survival)/len(survival))
    summaries=[{k:v for k,v in r.items() if k not in SKIP} for r in results]
    for s in summaries:s['display_cash']=s['cash']
    manifest=native.read(P/'trajectory-viewer/data/runs/manifest.json');manifest['models']=[m for m in manifest['models'] if m['model']!=MODEL]
    entry=dict(model=MODEL,model_display=PRETTY,harness=HARNESS,reasoning_effort=EFFORT,best_cash=max(cash),runs=sorted(summaries,key=lambda r:(-r['display_cash'],-r['survival_days'])))
    manifest['models'].insert(next((i for i,m in enumerate(manifest['models']) if m['best_cash']<entry['best_cash']),len(manifest['models'])),entry)
    (P/'trajectory-viewer/data/runs/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    winner=max(results,key=lambda r:r['cash'])
    best=[r for r in native.read(P/'assets/runs.json') if r['model']!=MODEL]+[dict(model=MODEL,pretty=PRETTY,bankrupt=0,max_day=500,final_cash=winner['cash'],points=[[p['day'],p['cash']] for p in winner['cash_series']])]
    native.dump(P/'assets/runs.json',best);(P/'assets/runs-data.js').write_text('window.CEOBENCH_RUNS = '+json.dumps(best,separators=(',',':'))+';\n')
    js=(P/'assets/figures/runs-by-model.js').read_text();grouped=json.loads(js[js.index('{'):js.rindex('}')+1])
    grouped={k:v for k,v in grouped.items() if not k.startswith('Gemini 4 Argon')}
    grouped[PRETTY]=[dict(run_id=r['run_id'],label=r['label']+(f' · resumed day {r["continuation_day"]} (after API quota error)' if r['extended_time'] else ''),status=r['status'],extended_time=r['extended_time'],continuation_day=r.get('continuation_day'),points=[[p['day'],p['cash']] for p in r['cash_series']]) for r in results]
    (P/'assets/figures/runs-by-model.js').write_text('const RUNS_BY_MODEL = '+json.dumps(grouped,separators=(',',':'))+';\n')
    summary=[r for r in native.read(P/'assets/native-run-summary.json') if r['model']!=MODEL]+[{k:v for k,v in r.items() if k not in SKIP} for r in results]
    native.dump(P/'assets/native-run-summary.json',summary)
    stats=[s for s in native.read(P/'assets/model-statistics.json') if not s['model'].startswith('Gemini 4 Argon')]
    row=dict(model=PRETTY,best=max(cash),mean=mean,std=std,effort=EFFORT,bankruptcy=f'{sum(r["bankrupt"] for r in results)}/{len(results)}',max_survival=max(survival),mean_survival=ms,std_survival=ss,turns='—')
    stats.insert(next((i for i,s in enumerate(stats) if s['best']<row['best']),len(stats)),row)
    (P/'assets/model-statistics.json').write_text(json.dumps(stats,indent=2)+'\n')
    for r in results:print(r['run_id'],r['status'],r['survival_days'],f"{r['cash']:.2f}",r['action_count'],'tool calls',len(r['days_list']),'days',sum(1 for d in r['days'].values() if d.get('rationale')),'rationales',sum(len(d.get('workspace_edits',[])) for d in r['days'].values()),'edits',len(r['customer_series_by_group']),'group points')
    print(f'{PRETTY}: best ${max(cash):,.2f}; mean ${mean:,.2f} ± ${std:,.2f}; survival {ms:.1f} ± {ss:.1f}')
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=pathlib.Path,required=True);ap.add_argument('--subscription-exports',type=pathlib.Path)
    a=ap.parse_args();main(a.source,a.subscription_exports)
