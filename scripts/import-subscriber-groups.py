#!/usr/bin/env python3
"""Import operator-exported subscription lifetimes and recorded trace snapshots."""
import argparse,ast,collections,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]

def dashboards(run):
    out={}
    for d in run['days'].values():
        for a in d['actions']:
            text=a.get('result','')
            for m in re.finditer(r'Dashboard \(Day (\d+)\) ===\s+Cash: [^\n]+\nIndividual Subscribers: ([\d,]+)\nEnterprise Subscribed Seats: ([\d,]+)',text):
                out[int(m[1])]={'individual':int(m[2].replace(',','')),'enterprise_seats':int(m[3].replace(',',''))}
    return out

def trace_groups(run):
    snapshots={0:{}};sources={}
    for day,d in sorted(run['days'].items(),key=lambda x:int(x[0])):
        for action in d['actions']:
            text=action.get('result','');lines=text.splitlines()
            for i,line in enumerate(lines):
                if line.strip()=='== subs by group/plan/status ==':
                    rows=[]
                    for row in lines[i+2:]:
                        if not row.strip() or row.startswith('=='):break
                        cells=[c.strip() for c in row.split('|')]
                        if len(cells)==6 and cells[2]=='subscribed':rows.append({'group_id':cells[0],'n':int(cells[3])})
                elif re.match(r'^(?:=== active subs by group/plan === |active subs by group/plan: |subs by group: )\[',line):
                    try:rows=ast.literal_eval(line[line.index('['):])
                    except (ValueError,SyntaxError):continue
                else:continue
                if not rows:continue
                counts=collections.Counter()
                for row in rows:
                    g=row['group_id']
                    if g.startswith(('S','D_S')):counts[g]+=row['n']
                snapshots[int(day)]=dict(counts)
                sources[str(day)]={'source_line':action.get('source_line'),'source_segment':action.get('source_segment',1)}
    groups=sorted({g for c in snapshots.values() for g in c})
    return [{'day':day,'group_id':g,'count':counts.get(g,0)} for day,counts in sorted(snapshots.items()) for g in groups],sources

def main(source):
    for p in sorted((ROOT/'trajectory-viewer/data/runs').glob('native-*.json')):
        run=json.loads(p.read_text());sid=run['session_id'];expected=dashboards(run)
        if sid=='db295aed8bd6':
            series,sources=trace_groups(run)
            source_note='Recorded active individual subscription query snapshots; only observed days are included. No interpolation or fabricated day-500 group counts.'
            run['subscriber_group_sources']=sources
        else:
            data=json.loads((source/(sid+'.json')).read_text());series=data['customer_series_by_group'];source_note=data['source']
            assert 'subscriptions joined' in source_note, 'Use subscription lifetime export, not pruned usage rows'
        totals=collections.Counter()
        for point in series:totals[point['day']]+=point['count']
        matches=[];mismatches=[]
        for day,total in totals.items():
            if day in expected:
                if total==expected[day]['individual']:matches.append(day)
                else:mismatches.append([day,total,expected[day]['individual']])
        assert not mismatches,(sid,mismatches[:12])
        assert len(matches)>0,(sid,len(matches))
        run['customer_series_by_group']=series
        run['customer_group_label']='SUBSCRIBERS'
        run['subscriber_group_source']=source_note
        run['subscriber_group_validation']={'dashboard_days_matched':matches}
        # Include actual dashboard totals even when group breakdowns were not recorded.
        merged={day:total for day,total in totals.items()}
        merged.update({day:s['individual'] for day,s in expected.items()})
        run['sub_series']=[{'day':day,'subscribers':total} for day,total in sorted(merged.items())]
        run['subscribers']=run['sub_series'][-1]['subscribers']
        run['seat_series']=[{'day':day,**counts} for day,counts in sorted(expected.items())]
        p.write_text(json.dumps(run,ensure_ascii=False,separators=(',',':'))+'\n')
        print(sid,len(totals),'group snapshots;',len(matches),'dashboard matches')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=pathlib.Path,required=True);main(parser.parse_args().source)
