"""Check recovered rationale and workspace details without re-running any agent code."""
import importlib.util,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('details',root/'scripts/enrich-native-details.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
state={}
a={'tool':'Bash','arguments':{'command':"cat > plan.py <<'PY'\nprint('a')\nPY\n"}}
assert mod.edits(a,state)[0]['arguments']['content']=="print('a')\n"
a['arguments']['command']="cat > plan.py <<'PY'\nprint('b')\nPY\n"
diff=mod.edits(a,state)[0]['arguments']['patch'];assert "-print('a')" in diff and "+print('b')" in diff
# Do not manufacture file bytes where shell expansion would be required.
assert mod.edits({'tool':'Bash','arguments':{'command':'cat > x <<EOF\n$TOKEN\nEOF\n'}},{})==[]
rationales=edits=0
for p in (root/'trajectory-viewer/data/runs').glob('native-*.json'):
    run=json.loads(p.read_text());rs=[d['rationale'] for d in run['days'].values() if d.get('rationale')];ws=[a for d in run['days'].values() for a in d.get('workspace_edits',[])]
    assert len(rs)>=50 and len(ws)>0,p
    assert all(isinstance(r,str) and len(r)>20 for r in rs)
    assert any(a['tool']=='apply_patch' for a in ws),p
    for a in ws:
        assert a.get('source_line')
        if a['tool']=='apply_patch':assert not a['arguments'].get('patch','').lstrip().startswith('{')
    rationales+=len(rs);edits+=len(ws)
print(f'Validated 12 trajectories: {rationales} recorded rationales and {edits} workspace edits.')
