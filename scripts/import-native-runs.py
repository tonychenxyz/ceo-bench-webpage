#!/usr/bin/env python3
"""Export public trajectories from harness JSONL. Run with --source /path/to/ceobench_runs.
No credentials, internal authentication logs, or encrypted reasoning signatures are exported.
"""
import argparse, bisect, collections, datetime, hashlib, json, pathlib, re, shlex
P=pathlib.Path(__file__).resolve().parents[1]
MODELS={'claude-opus-5-5':'Claude Opus 5.5','gpt-6-astra':'GPT-6 Astra','claude-fable-5-1':'Claude Fable 5.1','gpt-6-sol':'GPT-6 Sol'}
BATCHES=['20260928-integrity-rerun','20260929-sol-fable','20260929-sol-fable-extra-four']
def read(p): return json.loads(p.read_text())
def dump(p,d): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
def clean(x):
    if isinstance(x,dict):return {k:clean(v) for k,v in x.items() if k.lower() not in {'signature','access_token','refresh_token','id_token','authorization','api_key','oauth_token'}}
    if isinstance(x,list):return [clean(v) for v in x]
    if isinstance(x,str):
        x=re.sub(r'\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b','[REDACTED]',x)
        x=re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~-]{20,}',r'\1[REDACTED]',x)
        x=x.replace('/scratch/gpfs/ZHUANGL/hc5019/ceobench_runtime','/workspace/runtime')
        return x
    return x

def events(path,start_day=0):
    batch=path.parents[3]; run=path.parents[1].name; timeline=[]
    for line in (batch/"monitor-history.jsonl").open():
        snap=json.loads(line)
        for r in snap["runs"]:
            if r["id"]==run and r.get("day") is not None:timeline.append((snap["time"],r["day"]))
    times=[t for t,d in timeline]
    out=[];pending={};seen=set();day=start_day;turn=0
    internal=collections.defaultdict(collections.deque)
    first=json.loads(path.open().readline())
    if first.get('thread_id'):
        for ip in path.parent.glob('codex-internal-*'+first['thread_id']+'*.jsonl'):
            for il, line in enumerate(ip.open(),1):
                z=json.loads(line);v=z.get('payload',{});item=v.get('item',{})
                if v.get('type')!='item_completed':continue
                key=None
                if item.get('type')=='CommandExecution':key=('command',tuple(item['command']))
                elif item.get('type')=='FileChange':key=('files',tuple(sorted(item['changes'])))
                if key:internal[key].append((z['timestamp'],item,ip.name,il))
    def add(tool,args,result,line,ident=None):
        a=dict(tool=tool,arguments=clean(args),result=clean(result),day=day,turn=turn,source_line=line)
        out.append(a)
        if ident:pending[ident]=a
        return a
    def observe(t):
        nonlocal day
        # Only observed tool outputs, never forecast text or source code, advance the day.
        found=re.findall(r'=== Week \d+ Dashboard \(Day (\d+)\) ===',t)
        found+=re.findall(r'"success":\s*true,\s*"day":\s*(\d+)',t)
        if found:day=max(day,max(map(int,found)))
        try:
            z=json.loads(t)
            if isinstance(z,dict) and z.get('session_id') and isinstance(z.get('current_day'),int):day=max(day,z['current_day'])
        except (ValueError,TypeError):pass
    for line,s in enumerate(path.open(),1):
        d=json.loads(s);typ=d.get('type')
        if d.get('timestamp'):
            ts=datetime.datetime.fromisoformat(d['timestamp'].replace('Z','+00:00')).timestamp();idx=bisect.bisect_right(times,ts)-1
            if idx>=0:day=max(day,timeline[idx][1])
        if typ=='assistant':
            mid=d.get('message',{}).get('id');turn+=1
            for i,b in enumerate(d.get('message',{}).get('content',[])):
                key=(mid,i,b.get('type'),b.get('id'))
                if key in seen:continue
                seen.add(key)
                if b.get('type')=='tool_use':add(b['name'],b.get('input',{}),'',line,b['id'])
                elif b.get('type')=='text' and b.get('text'):add('_message',{},b['text'],line)
                elif b.get('type')=='thinking' and b.get('thinking'):add('_reasoning',{'text':b['thinking']},'',line)
        elif typ=='user':
            for b in d.get('message',{}).get('content',[]):
                if not isinstance(b,dict) or b.get('type')!='tool_result':continue
                value=b.get('content','');value=value if isinstance(value,str) else json.dumps(value,ensure_ascii=False)
                a=pending.get(b.get('tool_use_id'))
                if a is not None:a['result']=clean(value);a['result_source_line']=line
                else:add('_tool_result',{},value,line)
                observe(value)
        elif typ=='item.completed':
            i=d['item'];t=i['type'];turn+=1
            key=None;extra=None
            if t=='command_execution':key=('command',tuple(shlex.split(i['command'])))
            elif t=='file_change':key=('files',tuple(sorted(x['path'] for x in i.get('changes',[]))))
            if key and internal[key]:
                stamp,item,filename,il=internal[key].popleft();extra=(stamp,item,filename,il)
                ts=datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp();idx=bisect.bisect_right(times,ts)-1
                if idx>=0:day=max(day,timeline[idx][1])
            if t=='command_execution':
                add('exec_command',{'cmd':i['command']},i.get('aggregated_output',''),line);observe(i.get('aggregated_output',''))
            elif t=='file_change':
                changes=extra[1]['changes'] if extra else i.get('changes',[])
                add('apply_patch',{'patch':json.dumps(changes,ensure_ascii=False,indent=2)},i.get('status',''),line)
            elif t in ('agent_message','reasoning'):add('_message' if t=='agent_message' else '_reasoning',{},i.get('text',''),line)
            else:add(t,{},json.dumps(clean(i),ensure_ascii=False),line)
            if extra:out[-1]['timestamp']=extra[0];out[-1]['internal_source']={'file':extra[2],'line':extra[3]}
        elif typ=='system' and d.get('subtype')=='task_notification':
            add('_background_task',{},d.get('summary',''),line)
    return out

def main(source):
    results=[]
    for batch in BATCHES:
        for p in sorted((source/batch/'results').glob('*/result.json')):
            folder=p.parent;spec=read(folder/'spec.json');result=read(p);ext=None
            if folder.name=='fable-tonychenxyz':
                ext=source/'20261001-fable-extension/results/fable-tonychenxyz-extended';original=result;result=read(ext/'result.json')
            else:original=None
            model=spec['model'];harness='Claude Code' if spec['agent']=='claude' else 'Codex CLI'
            sid=result['simulation']['session_id'];rid='native-'+sid;pretty=MODELS[model];label=pretty+' · '+harness+' · xhigh'
            paths=[folder/'logs/agent-001.jsonl']+([ext/'logs/agent-001.jsonl'] if ext else [])
            acts=[];sources=[]
            for idx,path in enumerate(paths):
                part=events(path,455 if idx else 0)
                for a in part:a['source_segment']=idx+1
                if idx:acts.append(dict(tool='_continuation',arguments={},result='User-authorized extended-time continuation. Original 22-hour evaluation stopped at day 455. Same saved game and conversation; simulator restarted in a new container. No rollback or replacement game.',day=455,turn=0))
                acts+=part
                sources.append(dict(batch=path.relative_to(source).parts[0],run=path.parent.parent.name,file='logs/agent-001.jsonl',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),lines=sum(1 for _ in path.open())))
            # Monitored committed snapshots, not interpolated daily observations.
            points={0:1000000.0}
            for batchpath,run in [(source/batch,folder.name)]+([(source/'20261001-fable-extension',ext.name)] if ext else []):
                for l in (batchpath/'monitor-history.jsonl').open():
                    for r in json.loads(l)['runs']:
                        if r['id']==run and r.get('day') is not None and r.get('cash') is not None:points[int(r['day'])]=r['cash']
            curve_source='Committed simulator snapshots; lines connect observed samples. Exact day-500 ledger total.'
            finance=source/batch/'audit-20261001'/f'{folder.name}-finance.json'
            if finance.exists():
                data=read(finance);cash=0;points={}
                for d,v in sorted(data['daily_cash_delta'].items(),key=lambda z:int(z[0])):cash+=v;points[int(d)]=cash
                curve_source='Daily cumulative ledger totals; exact day-500 ledger total.'
            score=result['cash_day_500']['rows'][0]['cash_day_500'];points[500]=score
            points={d:c for d,c in sorted(points.items()) if d<=500}
            days={}
            for a in acts:days.setdefault(str(a['day']),{'actions':[]})['actions'].append(a)
            days.setdefault('500',{'actions':[]})['actions'].append(dict(tool='_score',arguments={},result=f'Exact day-500 ledger cash: ${score:,.2f}. Terminal day 504: ${result["simulation"]["cash"]:,.2f}.',day=500,turn=0))
            r=dict(run_id=rid,model=model,model_display=pretty,label=f'{folder.name} · {batch}',harness=harness,reasoning_effort='xhigh',provider='Modal',seed=42,session_id=sid,public_revision=spec['commit'],total_days=500,current_day=504,survival_days=500,status='complete',bankrupt=False,dnf=False,cash=score,final_cash=score,terminal_cash=result['simulation']['cash'],subscribers=None,mrr=None,founder_dividends=0,agent_turns=None,action_count=sum(not a['tool'].startswith('_') for a in acts),tool_calls_count=sum(not a['tool'].startswith('_') for a in acts),cash_series=[dict(day=d,cash=c) for d,c in points.items()],sub_series=[],seat_series=[],seat_series_by_group=[],group_discovery=[],days=days,days_list=sorted(map(int,days)),weeks_index=[],curve_source=curve_source,sources=sources,simulator_llm='AWS Bedrock Haiku',restart_note='No simulator restart found in reviewed run records.',trajectory_note='Commands, outputs and available agent text exported from harness JSONL. Days are assigned from timestamped committed monitor snapshots or the latest observed dashboard/status; source line and segment preserve ordering. Codex file edits and timestamps are supplemented from the matching harness-saved internal rollout. Reasoning unavailable in the harness stream is not reconstructed.',extended_time=bool(ext))
            if ext:
                r.update(restart_note='Simulator restarted once to resume the same saved game at day 455 in a new container.',original_outcome=dict(status=original['state'],day=455,cash=original['simulation']['cash'],reason=original['reason']),continuation_day=455)
            if folder.name=='fable-hc5019':r['artifact_note']='Complete agent trace recovered; original full workspace archive was incomplete. Curve uses saved committed snapshots.'
            dump(P/'trajectory-viewer/data/runs'/f'{rid}.json',r)
            # Readable downloadable projection retains every displayed event, without auth metadata/signatures.
            dest=P/'trajectory-viewer/data/transcripts'/f'{rid}.jsonl';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(''.join(json.dumps(a,ensure_ascii=False)+'\n' for a in acts))
            results.append(r)
    manifest=read(P/'trajectory-viewer/data/runs/manifest.json');manifest['models']=[m for m in manifest['models'] if m['model'] not in MODELS]
    best=read(P/'assets/runs.json');best=[r for r in best if r['model'] not in MODELS]
    js=(P/'assets/figures/runs-by-model.js').read_text();grouped=json.loads(js[js.index('{'):js.rindex('}')+1])
    for model,pretty in MODELS.items():
        rr=[r for r in results if r['model']==model];assert len(rr)==3
        manifest['models'].insert(0,dict(model=model,model_display=pretty,harness=rr[0]['harness'],reasoning_effort='xhigh',runs=[{k:v for k,v in r.items() if k not in ['days','cash_series','sub_series','seat_series','seat_series_by_group','group_discovery','weeks_index']} for r in rr]))
        winner=max(rr,key=lambda r:r['cash']);best.append(dict(model=model,pretty=pretty+' · '+winner['harness']+' · xhigh',bankrupt=0,max_day=500,final_cash=winner['cash'],points=[[p['day'],p['cash']] for p in winner['cash_series']]))
        grouped[pretty+' · '+rr[0]['harness']+' · xhigh']=[dict(run_id=r['run_id'],label=r['label']+(' · resumed day 455 (extended time)' if r['extended_time'] else ''),status=r['status'],extended_time=r['extended_time'],continuation_day=r.get('continuation_day'),points=[[p['day'],p['cash']] for p in r['cash_series']]) for r in rr]
    (P/'trajectory-viewer/data/runs/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');dump(P/'assets/runs.json',best)
    (P/'assets/runs-data.js').write_text('window.CEOBENCH_RUNS = '+json.dumps(best,separators=(',',':'))+';\n')
    (P/'assets/figures/runs-by-model.js').write_text('const RUNS_BY_MODEL = '+json.dumps(grouped,separators=(',',':'))+';\n')
    dump(P/'assets/native-run-summary.json',[{k:v for k,v in r.items() if k not in ['days','cash_series','sub_series','seat_series','seat_series_by_group','group_discovery','weeks_index']} for r in results])
    print('Exported',len(results),'runs;',sum(r['action_count'] for r in results),'tool calls')
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=pathlib.Path,required=True);main(ap.parse_args().source)
