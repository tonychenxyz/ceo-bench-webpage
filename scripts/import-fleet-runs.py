#!/usr/bin/env python3
"""Export the latest three finished or bankrupt games of each model from the seed-42 fleet.

Run with --source /path/to/extracted/games (one folder per game: plain copies of the agent logs, native agent
conversation, simulator history and result files, plus exports.json with daily ledger cash and active individual
subscribers per customer group from the game database). Replaces every listed model everywhere on the site.
Reuses the native and Antigravity exporters' cleaning, parsing, rationale and workspace-edit helpers.
No credentials, account metadata or encrypted reasoning signatures are exported.
"""
import argparse, bisect, collections, datetime, hashlib, importlib.util, json, math, pathlib, re, shlex, sqlite3
P = pathlib.Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, P / 'scripts' / file); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


native = load('exporter', 'import-native-runs.py'); details = load('details', 'enrich-native-details.py'); agy = load('agy', 'import-agy-runs.py')

# model id -> (display name, effort, games in order). Games are the latest three that finished or went bankrupt.
MODELS = {
    'claude-fable-5-2': ('Claude Fable 5.2', 'xhigh', ['fable-5-2-r1', 'fable-5-2-r2', 'fable-5-2-r3']),
    'claude-fable-5-1': ('Claude Fable 5.1', 'xhigh', ['fable-5-1-r1-retry1', 'fable-5-1-r2', 'fable-5-1-r3']),
    'gpt-6.2-astra': ('GPT-6.2 Astra', 'xhigh', ['6.2-astra-r1', '6.2-astra-r2-retry1', '6.2-astra-r3']),
    'gpt-6.2-sol': ('GPT-6.2 Sol', 'xhigh', ['6.2-sol-r1-retry1', '6.2-sol-r2-retry1', '6.2-sol-r3']),
    'gpt-6.1-sol': ('GPT-6.1 Sol', 'xhigh', ['6.1-sol-r1', '6.1-sol-r2-retry1', '6.1-sol-r3']),
    'gpt-6-astra': ('GPT-6 Astra', 'xhigh', ['6-astra-r1-retry1', '6-astra-r2', '6-astra-r3']),
    'gpt-6-sol': ('GPT-6 Sol', 'xhigh', ['6-sol-r1-retry1', '6-sol-r2', '6-sol-r3']),
    'gemini-4-neon-high': ('Gemini 4 Neon', 'high', ['neon-r1', 'neon-r2', 'neon-r3']),
    'gemini-4-carbon-high': ('Gemini 4 Carbon', 'high', ['carbon-r1', 'carbon-r2', 'carbon-r3']),
    'gemini-4-argon-high': ('Gemini 4 Argon', 'high', ['argon-r1', 'argon-r2', 'argon-r3']),
}
SKIP = agy.SKIP
# Shown only on trajectory pages, next to the model name.
HARNESS = {'claude': 'Claude Code', 'codex': 'Codex CLI', 'agy': 'Antigravity CLI'}
CURVE_SOURCE = 'Daily cumulative ledger totals from the game database; exact day-500 ledger total.'
CURVE_SOURCE_BANKRUPT = 'Daily cumulative ledger totals from the game database. Ends at $0 on the bankruptcy day.'
NOTES = {
    'claude': 'Commands, outputs and available agent text exported from the agent stream JSON. Days are assigned from the '
              "game's timestamped action history or the latest observed dashboard/status; source line and segment preserve ordering. "
              'Reasoning unavailable in the stream is not reconstructed.',
    'codex': 'Commands, outputs and available agent text exported from the agent stream JSON. File edits and timestamps are '
             "supplemented from the agent's saved rollout; days are assigned from the game's timestamped action history or the "
             'latest observed dashboard/status. Reasoning unavailable in the stream is not reconstructed.',
    'agy': 'Commands, outputs and available agent text exported from the agent stream JSON. The stream has no per-step '
           'timestamps, so days are assigned from the latest observed dashboard/status output; source line and segment preserve '
           'ordering. File write/edit contents come from the saved conversation where available; reasoning is not reconstructed.',
}


def clean(x):
    x = agy.clean(x)
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list): return [clean(v) for v in x]
    if isinstance(x, str): return x.replace('/workspace/runtime', '/workspace')
    return x


def ts(stamp):
    if isinstance(stamp, (int, float)): return float(stamp)
    return datetime.datetime.fromisoformat(str(stamp).replace('Z', '+00:00')).timestamp()


def native_events(path, start_day, timeline, rollouts):
    """native exporter's events(), with the game's action history as the timeline and the saved Codex rollouts."""
    times = [t for t, d in timeline]
    out = []; pending = {}; seen = set(); day = start_day; turn = 0
    internal = collections.defaultdict(collections.deque)
    first = json.loads(path.open().readline())
    if first.get('thread_id'):
        for ip in rollouts:
            if first['thread_id'] not in ip.name: continue
            for il, line in enumerate(ip.open(), 1):
                z = json.loads(line); v = z.get('payload', {}); item = v.get('item', {})
                if v.get('type') != 'item_completed': continue
                key = None
                if item.get('type') == 'CommandExecution': key = ('command', tuple(item['command']))
                elif item.get('type') == 'FileChange': key = ('files', tuple(sorted(item['changes'])))
                if key: internal[key].append((z['timestamp'], item, ip.name, il))

    def at(stamp):
        nonlocal day
        idx = bisect.bisect_right(times, ts(stamp)) - 1
        if idx >= 0: day = max(day, timeline[idx][1])

    def add(tool, args, result, line, ident=None):
        a = dict(tool=tool, arguments=clean(args), result=clean(result), day=day, turn=turn, source_line=line)
        out.append(a)
        if ident: pending[ident] = a
        return a

    def observe(t):
        nonlocal day
        found = re.findall(r'=== Week \d+ Dashboard \(Day (\d+)\) ===', t)
        found += re.findall(r'"success":\s*true,\s*"day":\s*(\d+)', t)
        if found: day = max(day, max(map(int, found)))
        try:
            z = json.loads(t)
            if isinstance(z, dict) and z.get('session_id') and isinstance(z.get('current_day'), int): day = max(day, z['current_day'])
        except (ValueError, TypeError): pass

    for line, s in enumerate(path.open(), 1):
        try: d = json.loads(s)
        except ValueError: continue
        typ = d.get('type')
        if d.get('timestamp'): at(d['timestamp'])
        if typ == 'assistant':
            mid = d.get('message', {}).get('id'); turn += 1
            for i, b in enumerate(d.get('message', {}).get('content', [])):
                key = (mid, i, b.get('type'), b.get('id'))
                if key in seen: continue
                seen.add(key)
                if b.get('type') == 'tool_use': add(b['name'], b.get('input', {}), '', line, b['id'])
                elif b.get('type') == 'text' and b.get('text'): add('_message', {}, b['text'], line)
                elif b.get('type') == 'thinking' and b.get('thinking'): add('_reasoning', {'text': b['thinking']}, '', line)
        elif typ == 'user':
            for b in d.get('message', {}).get('content', []):
                if not isinstance(b, dict) or b.get('type') != 'tool_result': continue
                value = b.get('content', ''); value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                a = pending.get(b.get('tool_use_id'))
                if a is not None: a['result'] = clean(value); a['result_source_line'] = line
                else: add('_tool_result', {}, value, line)
                observe(value)
        elif typ == 'item.completed':
            i = d['item']; t = i['type']; turn += 1; key = None; extra = None
            if t == 'command_execution':
                try: key = ('command', tuple(shlex.split(i['command'])))
                except ValueError: key = None
            elif t == 'file_change': key = ('files', tuple(sorted(x['path'] for x in i.get('changes', []))))
            if key and internal[key]:
                stamp, item, filename, il = internal[key].popleft(); extra = (stamp, item, filename, il); at(stamp)
            if t == 'command_execution':
                add('exec_command', {'cmd': i['command']}, i.get('aggregated_output', ''), line); observe(i.get('aggregated_output', ''))
            elif t == 'file_change':
                changes = extra[1]['changes'] if extra else i.get('changes', [])
                add('apply_patch', {'patch': json.dumps(changes, ensure_ascii=False, indent=2)}, i.get('status', ''), line)
            elif t in ('agent_message', 'reasoning'): add('_message' if t == 'agent_message' else '_reasoning', {}, i.get('text', ''), line)
            else: add(t, {}, json.dumps(clean(i), ensure_ascii=False), line)
            if extra: out[-1]['timestamp'] = extra[0]
        elif typ == 'system' and d.get('subtype') == 'task_notification':
            add('_background_task', {'task_id': d.get('task_id'), 'status': d.get('status')}, d.get('summary', ''), line)
    return out


FULL_CAP = 1 << 20   # 1 MB per recovered output
AGY_PREVIEW = re.compile(r"The tool's output was truncated due to being too long\. You can find the full output in a file at \S*?"
                         r"(brain/[^/\s]+/\.system_generated/steps/\d+/output\.txt)")
CLAUDE_PERSISTED = re.compile(r'<persisted-output>\s*Output too large[^\n]*?saved to: \S*?(tool-results/[^/\s]+)')


def attach_full_outputs(acts, folder):
    """Add the full text behind previewed outputs, recovered from the saved game (folder/recovered).
    The event's result stays exactly what the agent saw; the full text goes in full_output."""
    root = folder / 'recovered'
    if not root.exists(): return dict(previews=0, recovered=0)
    files = {}
    for f in root.rglob('*'):
        if f.is_file():
            rel = f.relative_to(root).as_posix()
            m = re.search(r'(brain/[^/]+/\.system_generated/steps/\d+/output\.txt|tool-results/[^/]+|tasks/[^/]+\.output)$', rel)
            if m: files[m.group(1)] = f
    n = found = 0
    for a in acts:
        key = label = None; res = a.get('result') or ''
        m = AGY_PREVIEW.search(res) or CLAUDE_PERSISTED.search(res)
        if m:
            key, label = m.group(1), 'Full output (saved to a file; the agent saw only the preview above)'
        elif a['tool'] == '_background_task' and (a.get('arguments') or {}).get('task_id'):
            key, label = f"tasks/{a['arguments']['task_id']}.output", 'Task output (written by the background command; the agent saw only this summary unless it read the file)'
        if not key: continue
        n += 1; f = files.get(key)
        if not f: continue
        text = f.read_text(errors='replace')
        if not text.strip(): continue
        if len(text) > FULL_CAP: text = text[:FULL_CAP] + f'\n[... {len(text) - FULL_CAP:,} more characters not shown]'
        a['full_output'] = clean(text); a['full_output_label'] = label; found += 1
    return dict(previews=n, recovered=found)


def conversation_arguments(folder, conversation):
    """Full write_file/edit_file arguments from the saved agy conversation DB (tool-call JSON only)."""
    found = {}
    for db in sorted(folder.glob(f'local/home/.gemini/antigravity-cli/conversations/{conversation}.db')):
        con = sqlite3.connect(f'file:{db}?mode=ro&immutable=1', uri=True)
        try:
            for idx, payload in con.execute('select idx,step_payload from steps where step_type=132'):
                m = re.search(rb'call_\d+[^\w]{1,6}(write_file|edit_file)[^{]{0,6}\{', payload or b'')
                if not m: continue
                try: obj, _ = json.JSONDecoder().raw_decode(payload[m.end() - 1:].decode('utf-8', 'replace'))
                except ValueError: continue
                found[idx] = (m.group(1).decode(), obj)
        except sqlite3.DatabaseError:
            pass
        con.close()
    return found


def history_of(folder):
    paths = sorted(folder.glob('local/workspace/run-ceobench/sessions/*/history.jsonl'))
    assert len(paths) == 1, (folder, paths)
    rows = []
    for line in paths[0].open():
        if line.strip(): rows.append(json.loads(line))
    return rows


def enrich(run, history, agent):
    """Rationales from the game's own next-week records; literal workspace edits as in enrich-native-details.py."""
    state = {}; rationales = {}
    for day, data in sorted(run['days'].items(), key=lambda x: int(x[0])):
        data['workspace_edits'] = []
        for action in data['actions']:
            if agent == 'agy':
                if action['tool'] in ('write_file', 'edit_file'):
                    if 'content' in action['arguments'] or 'new_string' in action['arguments']: data['workspace_edits'].extend(details.edits(action, state))
                    else: state.pop(action['arguments'].get('path'), None)
                    continue
                if action['tool'] != 'run_command': continue
                for e in details.edits(dict(action, tool='Bash'), state):
                    if e['tool'] == 'Bash': e['tool'] = 'run_command'
                    data['workspace_edits'].append(e)
            else:
                data['workspace_edits'].extend(details.edits(action, state))
    for h in history:
        if h.get('operation') == 'next-week' and str(h.get('success')) == 'True':
            inp = h.get('input')
            if isinstance(inp, str):
                try: inp = json.loads(inp)
                except ValueError:
                    import ast
                    try: inp = ast.literal_eval(inp)
                    except (ValueError, SyntaxError): inp = {}
            if isinstance(inp, dict) and inp.get('rationale'): rationales[int(h['day_before'])] = inp['rationale']
    for day, text in rationales.items():
        run['days'].setdefault(str(day), {'actions': [], 'workspace_edits': []})['rationale'] = clean(text)
    run['days_list'] = sorted(map(int, run['days']))


def dashboards(run):
    """Dashboards printed by tools only. Agent text can quote or invent one (a Gemini 4 Neon reply once wrote a fake
    week-52 dashboard inside a hallucinated system message), so _message and other synthetic events are ignored."""
    tools_only = {'days': {k: {'actions': [a for a in d['actions'] if not a['tool'].startswith('_')]} for k, d in run['days'].items()}}
    return agy.dashboards(tools_only)


def subscribers(run, exports):
    """Database export of active individual subscribers per group; every observed dashboard day must match."""
    expected = dashboards(run)
    # Every day lists every group (zeros included), so the viewer's subscriber chart has data from day 0.
    series = [{'day': day, 'group_id': g, 'count': counts.get(g, 0)} for day, counts in exports['individual_by_group'] for g in exports['groups']]
    totals = collections.Counter()
    for day, counts in exports['individual_by_group']: totals[day] = sum(counts.values())
    last = min(exports['last_day'], 500)
    bad = [[d, totals.get(d), e['individual']] for d, e in expected.items() if d <= last and totals.get(d) != e['individual']]
    assert not bad, (run['session_id'], bad[:12])
    run['customer_series_by_group'] = series; run['customer_group_label'] = 'SUBSCRIBERS'
    run['subscriber_group_source'] = exports['source']
    run['subscriber_group_validation'] = {'dashboard_days_matched': sorted(d for d in expected if d <= last)}
    merged = dict(totals); merged.update({day: e['individual'] for day, e in expected.items() if day <= last})
    run['sub_series'] = [{'day': day, 'subscribers': total} for day, total in sorted(merged.items())]
    run['subscribers'] = run['sub_series'][-1]['subscribers'] if run['sub_series'] else None
    run['seat_series'] = [{'day': day, **c} for day, c in sorted(expected.items())]


def export_game(folder, model, pretty, effort, number):
    spec = native.read(folder / 'data/spec.json'); result = native.read(folder / 'data/result.json'); ex = native.read(folder / 'exports.json')
    agent = spec['agent']; assert spec['model'] == model, (folder, spec['model'])
    assert result['state'] in ('completed', 'bankrupt'), (folder, result['state'])
    sid = result['simulation']['session_id']; rid = 'native-' + sid
    history = history_of(folder)
    timeline = sorted((float(h['timestamp']), int(h['day'])) for h in history if h.get('timestamp') is not None and h.get('day') is not None)
    rollouts = sorted(folder.glob('codex_home/sessions/**/rollout-*.jsonl'))
    logs = sorted((folder / 'data/logs').glob('agent-[0-9][0-9][0-9].jsonl'))
    starts = {}
    for c in folder.glob('data/continuation-*.json'):
        cj = native.read(c); starts[int(cj['segment'])] = int(cj.get('day_before') or cj.get('day_at_resume') or 0)
    acts = []; sources = []
    for idx, path in enumerate(logs, 1):
        start = starts.get(idx, 0) if idx > 1 else 0
        if agent == 'agy':
            conversation = next((json.loads(x).get('conversation_id') for x in path.open() if '"init"' in x), None)
            part = agy.events(path, start, conversation_arguments(folder, conversation) if conversation else None)
        else:
            part = native_events(path, start, timeline, rollouts)
        for a in part:
            a['source_segment'] = idx
            a.pop('internal_source', None)
        acts += part
        sources.append(dict(game=number, file=f'logs/{path.name}', sha256=hashlib.sha256(path.read_bytes()).hexdigest(), lines=sum(1 for _ in path.open())))
    recovery = attach_full_outputs(acts, folder)
    bankrupt = result['state'] == 'bankrupt'
    last = int(result['simulation']['current_day'])
    score = result['cash_day_500']['rows'][0]['cash_day_500'] if result.get('cash_day_500') else ex['cash_day_500']
    assert abs(score - ex['cash_day_500']) < 0.01 or bankrupt, (folder, score, ex['cash_day_500'])
    points = {int(d): float(c) for d, c in ex['daily_cash'] if int(d) <= 500}
    if bankrupt:
        assert points[last] < 0 and not any(c < 0 for d, c in points.items() if d < last), (folder, last)
        points[last] = 0.0; cash = 0.0
    else:
        assert abs(points[500] - score) < 0.01, (folder, points[500], score); cash = score
    days = {}
    for a in acts: days.setdefault(str(a['day']), {'actions': []})['actions'].append(a)
    if not bankrupt:
        days.setdefault('500', {'actions': []})['actions'].append(dict(tool='_score', arguments={}, result=f'Exact day-500 ledger cash: ${score:,.2f}.', day=500, turn=0))
    tools = sum(not a['tool'].startswith('_') for a in acts)
    r = dict(run_id=rid, model=model, model_display=pretty, label=f'{pretty} · Game {number}', harness=HARNESS[agent], reasoning_effort=effort, seed=42,
             session_id=sid, total_days=500, current_day=last, survival_days=last if bankrupt else 500,
             status='bankrupt' if bankrupt else 'complete', bankrupt=bankrupt, dnf=False, cash=cash, final_cash=cash,
             subscribers=None, mrr=None, founder_dividends=0, agent_turns=None, action_count=tools, tool_calls_count=tools,
             cash_series=[dict(day=d, cash=round(c, 4)) for d, c in sorted(points.items())], sub_series=[], seat_series=[],
             seat_series_by_group=[], group_discovery=[], days=days, days_list=sorted(map(int, days)), weeks_index=[],
             curve_source=CURVE_SOURCE_BANKRUPT if bankrupt else CURVE_SOURCE, sources=sources, simulator_llm='AWS Bedrock Haiku',
             trajectory_note=NOTES[agent], extended_time=False, full_outputs_recovered=recovery)
    enrich(r, history, agent); subscribers(r, ex)
    r = agy.scrub(clean(r)); acts = agy.scrub(clean(acts))
    native.dump(P / 'trajectory-viewer/data/runs' / f'{rid}.json', r)
    dest = P / 'trajectory-viewer/data/transcripts' / f'{rid}.jsonl'; dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(''.join(json.dumps(a, ensure_ascii=False) + '\n' for a in acts))
    return r


def pstats(values):
    m = sum(values) / len(values); return m, math.sqrt(sum((v - m) ** 2 for v in values) / len(values))


def main(source):
    manifest = native.read(P / 'trajectory-viewer/data/runs/manifest.json')
    pretties = {p for p, _, _ in MODELS.values()}
    replaced = {m['model'] for m in manifest['models'] if m['model_display'] in pretties or m['model'] in MODELS}
    old_ids = {r['run_id'] for m in manifest['models'] if m['model'] in replaced for r in m['runs']}
    results = {}
    for model, (pretty, effort, games) in MODELS.items():
        results[model] = [export_game(source / g, model, pretty, effort, n) for n, g in enumerate(games, 1)]
    new_ids = {r['run_id'] for rr in results.values() for r in rr}
    for rid in old_ids - new_ids:   # replaced models' earlier games
        (P / 'trajectory-viewer/data/runs' / f'{rid}.json').unlink(missing_ok=True)
        (P / 'trajectory-viewer/data/transcripts' / f'{rid}.jsonl').unlink(missing_ok=True)
    # Viewer manifest, best curves, per-model curves, summaries and statistics.
    manifest['models'] = [m for m in manifest['models'] if m['model'] not in replaced and m['model_display'] not in pretties]
    best = [r for r in native.read(P / 'assets/runs.json') if r['pretty'] not in pretties]
    js = (P / 'assets/figures/runs-by-model.js').read_text(); grouped = json.loads(js[js.index('{'):js.rindex('}') + 1])
    grouped = {k: v for k, v in grouped.items() if k not in pretties}
    summary = [r for r in native.read(P / 'assets/native-run-summary.json') if r['model'] not in MODELS and r.get('model_display') not in pretties]
    stats = [s for s in native.read(P / 'assets/model-statistics.json') if s['model'] not in pretties]
    for model, rr in results.items():
        pretty, effort, _ = MODELS[model]
        summaries = [{k: v for k, v in r.items() if k not in SKIP} for r in rr]
        for s in summaries: s['display_cash'] = s['cash']
        manifest['models'].append(dict(model=model, model_display=pretty, harness=rr[0]['harness'], reasoning_effort=effort, best_cash=max(r['cash'] for r in rr),
                                       runs=sorted(summaries, key=lambda r: (-r['display_cash'], -r['survival_days']))))
        winner = max(rr, key=lambda r: (r['cash'], r['survival_days']))
        best.append(dict(model=model, pretty=pretty, bankrupt=int(winner['bankrupt']), max_day=winner['survival_days'], final_cash=winner['cash'],
                         points=[[p['day'], p['cash']] for p in winner['cash_series']]))
        grouped[pretty] = [dict(run_id=r['run_id'], label=r['label'], status=r['status'], extended_time=False, continuation_day=None,
                                points=[[p['day'], p['cash']] for p in r['cash_series']]) for r in rr]
        summary += [{k: v for k, v in r.items() if k not in SKIP} for r in rr]
        cash = [r['cash'] for r in rr]; survival = [r['survival_days'] for r in rr]
        mean, std = pstats(cash); ms, ss = pstats(survival)
        stats.append(dict(model=pretty, best=max(cash), mean=mean, std=std, effort=effort, bankruptcy=f'{sum(r["bankrupt"] for r in rr)}/{len(rr)}',
                          max_survival=max(survival), mean_survival=ms, std_survival=ss, turns='—'))
    manifest['models'].sort(key=lambda m: -(m.get('best_cash') or max((r.get('display_cash', r.get('cash')) or 0) for r in m['runs'])))
    stats.sort(key=lambda s: -s['best'])
    (P / 'trajectory-viewer/data/runs/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    native.dump(P / 'assets/runs.json', best)
    (P / 'assets/runs-data.js').write_text('window.CEOBENCH_RUNS = ' + json.dumps(best, separators=(',', ':')) + ';\n')
    (P / 'assets/figures/runs-by-model.js').write_text('const RUNS_BY_MODEL = ' + json.dumps(grouped, separators=(',', ':')) + ';\n')
    native.dump(P / 'assets/native-run-summary.json', summary)
    (P / 'assets/model-statistics.json').write_text(json.dumps(stats, indent=2) + '\n')
    print('removed earlier games:', len(old_ids - new_ids))
    for model, rr in results.items():
        for r in rr:
            print(r['run_id'], r['label'], r['status'], r['survival_days'], f"{r['cash']:,.2f}", r['action_count'], 'tools',
                  sum(1 for d in r['days'].values() if d.get('rationale')), 'rationales',
                  sum(len(d.get('workspace_edits', [])) for d in r['days'].values()), 'edits',
                  len(r['subscriber_group_validation']['dashboard_days_matched']), 'dashboard days matched')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--source', type=pathlib.Path, required=True); main(ap.parse_args().source)
