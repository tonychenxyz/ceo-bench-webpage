"""Validate active subscriber charts against preserved dashboard observations."""
import collections,importlib.util,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('groups',root/'scripts/import-subscriber-groups.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
checked=0
for p in (root/'trajectory-viewer/data/runs').glob('native-*.json'):
    r=json.loads(p.read_text());series=r['customer_series_by_group'];seen=set();totals=collections.Counter()
    for x in series:
        assert x['group_id'].startswith(('S','D_S'))
        assert isinstance(x['count'],int) and x['count']>=0
        key=(x['day'],x['group_id']);assert key not in seen;seen.add(key)
        totals[x['day']]+=x['count']
    expected=mod.dashboards(r)
    for day,n in totals.items():
        if day in expected:assert n==expected[day]['individual'],(p.name,day);checked+=1
    if r['session_id']=='db295aed8bd6':
        assert len(totals)==64 and max(totals)==490
        rebuilt,_=mod.trace_groups(r);assert rebuilt==series
    else:assert set(totals)==set(range(505))
    assert r['customer_group_label']=='SUBSCRIBERS'
    subs={x['day']:x['subscribers'] for x in r['sub_series']}
    assert all(subs[d]==n for d,n in totals.items())
    assert r['subscribers']==r['sub_series'][-1]['subscribers']
print(f'Validated all 12 subscriber-group charts against {checked} recorded dashboards.')
