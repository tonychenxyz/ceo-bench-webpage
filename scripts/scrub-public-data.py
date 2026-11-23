#!/usr/bin/env python3
"""Neutral public labels and path/revision scrubbing for the site's data files. Run after any importer.

- Run labels become '<model> · Game N' everywhere (grid hover, viewer manifest, run summary, run records), with no
  account, batch or continuation wording.
- Local agent project-folder names and the release revision are replaced in run records and transcripts.
Content written by the agents is otherwise unchanged.
"""
import json, pathlib, re
P = pathlib.Path(__file__).resolve().parents[1]
SUBS = [
    (re.compile(r'-scratch-gpfs-ZHUANGL-hc5019-ceobench-runtime-'), '-workspace-'),
    (re.compile(r'-scratch-gpfs-ZHUANGL-hc5019'), '-workspace'),
    (re.compile(r'/scratch/gpfs/ZHUANGL/hc5019'), '/workspace'),
    (re.compile(r'ZHUANGL-hc5019'), 'workspace'),
    (re.compile(r'\b22d4c14be3e5271d4691247274d660cd1a4b2ccc\b'), '[release]'),
]


DROP = ('public_revision', 'restart_note', 'original_outcome')   # release hashes and resume details


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
    changed = 0
    for f in list((P / 'trajectory-viewer/data/runs').glob('*.json')) + list((P / 'trajectory-viewer/data/transcripts').glob('*.jsonl')):
        if f.name == 'manifest.json': continue
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
