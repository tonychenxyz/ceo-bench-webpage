#!/usr/bin/env python3
"""Add the November 2026 open-model games (Codex CLI as the agent harness, seed 42, 500 days) to the site.

Run with --source /path/to/extracted/games (one folder per game, same layout as for import-fleet-runs.py: plain copies
of the agent logs, the saved Codex conversation, simulator history and result files, plus exports.json with daily ledger
cash and active individual subscribers per customer group from the game database). Models are added; nothing already on
the site is replaced. Every finished or bankrupt game of a model is published and counted, so a model can have more
than three games. Reuses the fleet exporter's event parsing, rationale, workspace-edit and subscriber helpers.
No credentials, account or model-route settings, or encrypted reasoning are exported.
"""
import argparse, hashlib, importlib.util, json, math, pathlib, re
P = pathlib.Path(__file__).resolve().parents[1]
from local_sources import LOCAL


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, P / 'scripts' / file); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


fleet = load('fleet', 'import-fleet-runs.py'); native = fleet.native; agy = fleet.agy

# model id -> (display name, reasoning level, games in order). Each model ran at the highest reasoning level it accepts.
MODELS = {
    'deepseek-v4.1-flash-1017': ('DeepSeek V4.1 Flash 1017', 'max', ['deepseek-v4.1-flash-r1', 'deepseek-v4.1-flash-r2', 'deepseek-v4.1-flash-r3']),
    'muse-spark-open-816b-a42b': ('Muse Spark Open 816B A42B', 'xhigh', ['muse-spark-open-r1', 'muse-spark-open-r2', 'muse-spark-open-r3',
                                                                      'muse-spark-open-r4', 'muse-spark-open-r5', 'muse-spark-open-r6']),
    'qwen4-max': ('Qwen4 Max', 'max', ['qwen4-max-r1', 'qwen4-max-r2', 'qwen4-max-r3']),
    'glm-5.3': ('GLM 5.3', 'max', ['glm-5.3-r1', 'glm-5.3-r2', 'glm-5.3-r3']),
    'kimi-k3.1-pro': ('Kimi K3.1 Pro', 'max', ['kimi-k3.1-pro-r1', 'kimi-k3.1-pro-r2', 'kimi-k3.1-pro-r3']),
    'tencent-hy4': ('Tencent Hy4', 'max', ['hy4-r1', 'hy4-r2', 'hy4-r3']),
    'inkling-2-small': ('Inkling 2 Small', 'max', ['inkling-2-small-r1', 'inkling-2-small-r2', 'inkling-2-small-r3']),
    'beam-1.0-501b-a23b': ('Beam 1.0 501B A23B', 'max', ['beam-1.0-r1', 'beam-1.0-r2', 'beam-1.0-r3']),
}
# Machine-specific details stay in the untracked local file: the model name each game was launched with, and the
# patterns that turn model-route settings and catalogue-style model ids into neutral text.
SOURCE_MODELS = LOCAL.get('open_model_source_models', {})
NEUTRAL = [(re.compile(p), r) for p, r in LOCAL.get('open_model_scrub', [])]
assert SOURCE_MODELS and NEUTRAL, 'scripts/local-sources.json with the open-model entries is required'


def neutral(x):
    if isinstance(x, dict): return {neutral(k): neutral(v) for k, v in x.items()}
    if isinstance(x, list): return [neutral(v) for v in x]
    if isinstance(x, str):
        for pat, rep in NEUTRAL: x = pat.sub(rep, x)
    return x


def export_game(folder, model, pretty, effort, number):
    """import-fleet-runs.export_game for one of these games, with the neutral pass applied to everything written."""
    spec = native.read(folder / 'data/spec.json'); result = native.read(folder / 'data/result.json'); ex = native.read(folder / 'exports.json')
    agent = spec['agent']; assert agent == 'codex' and spec['model'] == SOURCE_MODELS[model] and spec['seed'] == 42, (folder, spec['model'])
    assert result['state'] in ('completed', 'bankrupt'), (folder, result['state'])
    sid = result['simulation']['session_id']; rid = 'native-' + sid
    history = fleet.history_of(folder)
    timeline = sorted((float(h['timestamp']), int(h['day'])) for h in history if h.get('timestamp') is not None and h.get('day') is not None)
    rollouts = sorted(folder.glob('codex_home/sessions/**/rollout-*.jsonl'))
    logs = sorted((folder / 'data/logs').glob('agent-[0-9][0-9][0-9].jsonl'))
    starts = {}
    for c in folder.glob('data/continuation-*.json'):
        cj = native.read(c); starts[int(cj['segment'])] = int(cj.get('day_before') or cj.get('day_at_resume') or 0)
    assert len(logs) == 1 + len(starts), (folder, len(logs), starts)
    acts = []; sources = []
    for idx, path in enumerate(logs, 1):
        part = fleet.native_events(path, starts[idx] if idx > 1 else 0, timeline, rollouts)
        for a in part: a['source_segment'] = idx
        acts += part
        sources.append(dict(file=f'logs/{path.name}', sha256=hashlib.sha256(path.read_bytes()).hexdigest(), lines=sum(1 for _ in path.open())))
    bankrupt = result['state'] == 'bankrupt'
    last = int(result['simulation']['current_day'])
    score = result['cash_day_500']['rows'][0]['cash_day_500']
    assert abs(score - ex['cash_day_500']) < 0.01, (folder, score, ex['cash_day_500'])
    points = {int(d): float(c) for d, c in ex['daily_cash'] if int(d) <= 500}
    if bankrupt:
        assert points[last] < 0 and not any(c < 0 for d, c in points.items() if d < last), (folder, last)
        points[last] = 0.0; cash = 0.0
    else:
        assert last == 500 and abs(points[500] - score) < 0.01, (folder, points[500], score); cash = score
    days = {}
    for a in acts: days.setdefault(str(a['day']), {'actions': []})['actions'].append(a)
    if not bankrupt:
        days.setdefault('500', {'actions': []})['actions'].append(dict(tool='_score', arguments={}, result=f'Exact day-500 ledger cash: ${score:,.2f}.', day=500, turn=0))
    tools = sum(not a['tool'].startswith('_') for a in acts)
    r = dict(run_id=rid, model=model, model_display=pretty, label=f'{pretty} · Game {number}', harness=fleet.HARNESS[agent], reasoning_effort=effort, seed=42,
             session_id=sid, total_days=500, current_day=last, survival_days=last if bankrupt else 500,
             status='bankrupt' if bankrupt else 'complete', bankrupt=bankrupt, dnf=False, cash=cash, final_cash=cash,
             subscribers=None, mrr=None, founder_dividends=0, agent_turns=None, action_count=tools, tool_calls_count=tools,
             cash_series=[dict(day=d, cash=round(c, 4)) for d, c in sorted(points.items())], sub_series=[], seat_series=[],
             seat_series_by_group=[], group_discovery=[], days=days, days_list=sorted(map(int, days)), weeks_index=[],
             curve_source=fleet.CURVE_SOURCE_BANKRUPT if bankrupt else fleet.CURVE_SOURCE, sources=sources, simulator_llm='AWS Bedrock Haiku',
             trajectory_note=fleet.NOTES[agent], extended_time=False, full_outputs_recovered=fleet.attach_full_outputs(acts, folder))
    fleet.enrich(r, history, agent); fleet.subscribers(r, ex)
    r = neutral(agy.scrub(fleet.clean(r))); acts = neutral(agy.scrub(fleet.clean(acts)))
    native.dump(P / 'trajectory-viewer/data/runs' / f'{rid}.json', r)
    dest = P / 'trajectory-viewer/data/transcripts' / f'{rid}.jsonl'; dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(''.join(json.dumps(a, ensure_ascii=False) + '\n' for a in acts))
    return r


def pstats(values):
    m = sum(values) / len(values); return m, math.sqrt(sum((v - m) ** 2 for v in values) / len(values))


def main(source):
    manifest = native.read(P / 'trajectory-viewer/data/runs/manifest.json')
    pretties = {p for p, _, _ in MODELS.values()}
    # Re-running replaces this script's own earlier output only.
    manifest['models'] = [m for m in manifest['models'] if m['model'] not in MODELS]
    best = [r for r in native.read(P / 'assets/runs.json') if r['model'] not in MODELS]
    js = (P / 'assets/figures/runs-by-model.js').read_text(); grouped = json.loads(js[js.index('{'):js.rindex('}') + 1])
    grouped = {k: v for k, v in grouped.items() if k not in pretties}
    summary = [r for r in native.read(P / 'assets/native-run-summary.json') if r['model'] not in MODELS]
    stats = [s for s in native.read(P / 'assets/model-statistics.json') if s['model'] not in pretties]
    assert not pretties & ({m['model_display'] for m in manifest['models']} | {r['pretty'] for r in best} | {s['model'] for s in stats}), 'display name already on the site'
    added = []
    for model, (pretty, effort, games) in MODELS.items():
        rr = [export_game(source / g, model, pretty, effort, n) for n, g in enumerate(games, 1)]
        summaries = [{k: v for k, v in r.items() if k not in fleet.SKIP} for r in rr]
        for s in summaries: s['display_cash'] = s['cash']
        manifest['models'].append(dict(model=model, model_display=pretty, harness=rr[0]['harness'], reasoning_effort=effort, best_cash=max(r['cash'] for r in rr),
                                       runs=sorted(summaries, key=lambda r: (-r['display_cash'], -r['survival_days']))))
        winner = max(rr, key=lambda r: (r['cash'], r['survival_days']))
        best.append(dict(model=model, pretty=pretty, bankrupt=int(winner['bankrupt']), max_day=winner['survival_days'], final_cash=winner['cash'],
                         points=[[p['day'], p['cash']] for p in winner['cash_series']]))
        grouped[pretty] = [dict(run_id=r['run_id'], label=r['label'], status=r['status'], extended_time=False, continuation_day=None,
                                points=[[p['day'], p['cash']] for p in r['cash_series']]) for r in rr]
        summary += [{k: v for k, v in r.items() if k not in fleet.SKIP} for r in rr]
        cash = [r['cash'] for r in rr]; survival = [r['survival_days'] for r in rr]
        mean, std = pstats(cash); ms, ss = pstats(survival)
        added.append(dict(model=pretty, best=max(cash), mean=mean, std=std, effort=effort, bankruptcy=f'{sum(r["bankrupt"] for r in rr)}/{len(rr)}',
                          max_survival=max(survival), mean_survival=ms, std_survival=ss, turns='—'))
        for r in rr:
            print(r['run_id'], r['label'], r['status'], r['survival_days'], f"{r['cash']:,.2f}", r['action_count'], 'tools', len(r['sources']), 'segments',
                  sum(1 for d in r['days'].values() if d.get('rationale')), 'rationales',
                  sum(len(d.get('workspace_edits', [])) for d in r['days'].values()), 'edits',
                  len(r['subscriber_group_validation']['dashboard_days_matched']), 'dashboard days matched')
    # Ranked by best-run cash like the rest of the table; the new models whose games all went bankrupt follow the ones
    # already listed, longest mean survival first.
    stats += sorted(added, key=lambda s: -s['mean_survival'])
    order = {s['model']: i for i, s in enumerate(stats)}
    manifest['models'].sort(key=lambda m: order.get(m['model_display'], -1))
    manifest['models'].sort(key=lambda m: -(m.get('best_cash') or max((r.get('display_cash', r.get('cash')) or 0) for r in m['runs'])))
    stats.sort(key=lambda s: -s['best'])
    (P / 'trajectory-viewer/data/runs/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    native.dump(P / 'assets/runs.json', best)
    (P / 'assets/runs-data.js').write_text('window.CEOBENCH_RUNS = ' + json.dumps(best, separators=(',', ':')) + ';\n')
    (P / 'assets/figures/runs-by-model.js').write_text('const RUNS_BY_MODEL = ' + json.dumps(grouped, separators=(',', ':')) + ';\n')
    native.dump(P / 'assets/native-run-summary.json', summary)
    (P / 'assets/model-statistics.json').write_text(json.dumps(stats, indent=2) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--source', type=pathlib.Path, required=True); main(ap.parse_args().source)
