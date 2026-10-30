#!/usr/bin/env python3
"""Restore recorded rationale and workspace edits; never execute trajectory commands."""
import argparse, difflib, importlib.util, json, pathlib, re, shlex
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('exporter', ROOT/'scripts/import-native-runs.py')
exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)

def shell(action):
    args=action.get('arguments',{})
    cmd=args.get('command',args.get('cmd',''))
    try:
        parts=shlex.split(cmd)
        if len(parts)==3 and parts[0].endswith(('bash','sh')) and 'c' in parts[1]:return parts[2]
    except ValueError:pass
    return cmd

def edits(action,state):
    tool=action['tool'];args=action.get('arguments',{});out=[]
    def write(path,content,append=False):
        if not path or not isinstance(content,str):return
        old=state.get(path)
        if append and old is None:
            out.append(dict(tool='Write',arguments=dict(file_path=path,content=content),result='Recorded append; earlier file content unavailable.'));return
        new=(old or '')+content if append else content
        if old is not None:
            patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=path,tofile=path))
            if patch:out.append(dict(tool='apply_patch',arguments=dict(patch=patch),result=''))
        else:out.append(dict(tool='Write',arguments=dict(file_path=path,content=new),result=''))
        state[path]=new
    if tool in ('Write','write_file'):write(args.get('file_path',args.get('path')),args.get('content'))
    elif tool in ('Edit','edit_file'):
        out.append(action.copy());p=args.get('file_path',args.get('path'))
        if p in state:state[p]=state[p].replace(args.get('old_string',''),args.get('new_string',''),-1 if args.get('replace_all') else 1)
    elif tool=='apply_patch':
        raw=args.get('patch',args.get('input',''))
        try:changes=json.loads(raw)
        except (ValueError,TypeError):changes=None
        if isinstance(changes,dict):
            for path,change in changes.items():
                if change.get('type')=='add':write(path,change.get('content'))
                else:
                    patch=change.get('unified_diff',change.get('diff',''))
                    out.append(dict(tool='apply_patch',arguments=dict(patch=f'--- {path}\n+++ {path}\n'+patch),result=''))
                    state.pop(path,None)
        else:out.append(action.copy())
    elif tool in ('Bash','exec_command'):
        cmd=shell(action)
        # Literal cat heredocs preserve the exact file content in the recorded command.
        pattern=r'\bcat\s+(?P<header>[^\n]*<<[^\n]*)\n'
        for m in re.finditer(pattern,cmd):
            h=m['header'];marker=re.search(r'<<(-?)\s*([\'\"]?)([\w-]+)\2',h)
            target=re.search(r'(?<![<\d])(>>?)\s*([^\s<>]+)',h)
            if not marker or not target:continue
            end=re.search(r'^\t*'+re.escape(marker[3])+r'\s*$',cmd[m.end():],re.M)
            if not end:continue
            body=cmd[m.end():m.end()+end.start()]
            if marker[1]:body='\n'.join(x.lstrip('\t') for x in body.split('\n'))
            if not marker[2] and re.search(r'[$`\\]',body):continue # expansion makes the resulting bytes unknown
            write(target[2].strip('\'\"'),body,target[1]=='>>')
        # Keep other writes inspectable without claiming a reconstructed file/diff.
        if not out and re.search(r'\b(?:sed\s+-i|tee\s+|apply_patch\b)|\.write_text\(|open\([^\n]+[\'\"](?:w|a)[\'\"]',cmd):out.append(action.copy())
    for e in out:
        for key in ('day','turn','timestamp','source_line','source_segment'):
            if key in action:e[key]=action[key]
    return out

def histories(source):
    found={}
    for batch,pattern in [('20260928-integrity-rerun','audit-final/*/archive/sessions/*/history.jsonl'),('20260929-sol-fable','audit/sol-hc5019/archive/sessions/*/history.jsonl'),('20260929-sol-fable','audit-final/capture/local/workspace/run-ceobench/sessions/*/history.jsonl')]:
        for p in (source/batch).glob(pattern):found[p.parent.name]=[json.loads(x) for x in p.read_text().splitlines() if x.strip()]
    ids={'fable-hc5019-cs':'00af2b447bfc','sol-hc5019':'5c316339369a','sol-tonychenxyz':'be64f4730513'}
    for name,sid in ids.items():
        p=source/'20260929-sol-fable-extra-four/audit-20261001'/f'{name}-evidence.json'
        found[sid]=[json.loads(x) for x in json.loads(p.read_text())['history'].splitlines() if x.strip()]
    return found

def main(source):
    history=histories(source)
    for p in sorted((ROOT/'trajectory-viewer/data/runs').glob('native-*.json')):
        run=json.loads(p.read_text());sid=p.stem.removeprefix('native-');state={};rationales={}
        for h in history.get(sid,[]):
            if h.get('type')=='next_week' and h.get('rationale'):rationales[max(0,h['day']-7)]=h['rationale']
            if h.get('operation')=='next-week' and h.get('success') and h.get('input',{}).get('rationale'):rationales[h['day_before']]=h['input']['rationale']
        for day,data in sorted(run['days'].items(),key=lambda x:int(x[0])):
            data['workspace_edits']=[]
            for action in data['actions']:
                data['workspace_edits'].extend(edits(action,state))
                if sid not in history and action['tool'] in ('Bash','exec_command'):
                    cmd=shell(action)
                    try:tokens=shlex.split(cmd.replace('\\\n',''))
                    except ValueError:continue
                    if 'next-week' in tokens:
                        tail=tokens[tokens.index('next-week')+1:]
                        if tail[:1]==['--request-id']:tail=tail[2:]
                        if tail and len(tail[0])>40:rationales[int(day)]=tail[0]
        for day,text in rationales.items():
            run['days'].setdefault(str(day),{'actions':[],'workspace_edits':[]})['rationale']=exporter.clean(text)
        run['days_list']=sorted(map(int,run['days']))
        p.write_text(json.dumps(run,ensure_ascii=False,separators=(',',':'))+'\n')
        print(sid,'rationales',len(rationales),'workspace edits',sum(len(d.get('workspace_edits',[])) for d in run['days'].values()))
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--source',type=pathlib.Path,required=True);main(a.parse_args().source)
