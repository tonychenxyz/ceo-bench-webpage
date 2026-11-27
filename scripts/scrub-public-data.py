#!/usr/bin/env python3
"""Neutral public labels and path/revision scrubbing for the site's data files. Run after any importer.

- Run labels become '<model> · Game N' everywhere (grid hover, viewer manifest, run summary, run records), with no
  account, batch or continuation wording.
- Local agent project-folder names and the release revision are replaced in run records and transcripts, as are
  personal or machine paths and usernames, hosted-volume ids and names, and sandbox-internal directory prefixes.
Content written by the agents is otherwise unchanged.
"""
import json, pathlib, re
P = pathlib.Path(__file__).resolve().parents[1]
from local_sources import scrub_patterns
# Patterns naming people, accounts or local paths come from the untracked local file; generic ones follow.
SUBS = scrub_patterns() + [
    # Hosted-volume mounts and ids.
    (re.compile(r'/__modal/volumes/vo-[A-Za-z0-9]+'), '/workspace'),
    (re.compile(r'\bvo-[A-Za-z0-9]{20,}\b'), '[volume]'),
    # Agent sandbox layout: workspace, agent home and temp directories under plain names.
    (re.compile(r'-workspace-local-workspace-'), '-workspace-'),
    (re.compile(r'/workspace/(?:ceobench_)?runtime/local/workspace\b'), '/workspace'),
    (re.compile(r'/workspace/(?:ceobench_)?runtime/local/home\b'), '/home/agent'),
    (re.compile(r'/workspace/(?:ceobench_)?runtime/local\b'), '/workspace'),
    (re.compile(r'/workspace/local/workspace\b'), '/workspace'),
    (re.compile(r'/workspace/local/home\b'), '/home/agent'),
    (re.compile(r'/workspace/local/tmp\b'), '/tmp'),
    (re.compile(r'/workspace/local\b'), '/workspace'),
    (re.compile(r'\bclaude-1001\b'), 'claude'),
    # Model-transport errors name the provider route rather than the model API.
    (re.compile(r'Message: Kaggle (credential unavailable or expired|transport unavailable)'), r'Message: model provider \1'),
]


DROP = ('public_revision', 'restart_note', 'original_outcome', 'volume_name')   # release hashes, resume and storage details
UNLISTED = ('5a26f818',)   # hidden run file not linked from the site; removed


def scrub_record(r):
    for k in DROP: r.pop(k, None)
    if isinstance(r.get('sources'), list):
        r['sources'] = [{k: v for k, v in src.items() if k in ('file', 'sha256', 'lines')} for src in r['sources']]
    return r


def scrub_text(s):
    for pat, rep in SUBS: s = pat.sub(rep, s)
    return s


def main():
    js_path = P / 'assets/figures/runs-by-model.js'; js = js_path.read_text()
    grouped = json.loads(js[js.index('{'):js.rindex('}') + 1])
    labels = {}
    for model, runs in grouped.items():
        for i, r in enumerate(runs, 1):
            r['label'] = f'{model} · Game {i}'; r['extended_time'] = False; r['continuation_day'] = None
            labels[r['run_id']] = r['label']
    js_path.write_text('const RUNS_BY_MODEL = ' + json.dumps(grouped, separators=(',', ':')) + ';\n')
    manifest_path = P / 'trajectory-viewer/data/runs/manifest.json'; manifest = json.loads(manifest_path.read_text())
    for m in manifest['models']:
        for i, r in enumerate(m['runs'], 1):
            r['label'] = labels.get(r['run_id'], f"{m['model_display']} · Game {i}"); scrub_record(r)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    summary_path = P / 'assets/native-run-summary.json'; summary = json.loads(summary_path.read_text())
    for r in summary:
        if r.get('run_id') in labels: r['label'] = labels[r['run_id']]
        scrub_record(r)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, separators=(',', ':')) + '\n')
    for run_id in UNLISTED:
        for f in (P / f'trajectory-viewer/data/runs/{run_id}.json', P / f'trajectory-viewer/data/transcripts/{run_id}.jsonl'):
            f.unlink(missing_ok=True)
    changed = 0
    archive = list((P / 'trajectory-viewer/data/archive').glob('*/*.json'))
    for f in list((P / 'trajectory-viewer/data/runs').glob('*.json')) + list((P / 'trajectory-viewer/data/transcripts').glob('*.jsonl')) + archive:
        if f.name == 'manifest.json' and f not in archive: continue
        text = f.read_text(); new = scrub_text(text)
        if f.suffix == '.json':
            run = json.loads(new)
            if isinstance(run, dict):
                if f.stem in labels: run['label'] = labels[f.stem]
                scrub_record(run)
                new = json.dumps(run, ensure_ascii=False, separators=(',', ':')) + '\n'
        if new != text: f.write_text(new); changed += 1
    print('labels', len(labels), '; files scrubbed', changed)


if __name__ == '__main__':
    main()
