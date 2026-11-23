#!/usr/bin/env python3
"""Regenerate the homepage results table rows and trajectory cards from the site's data files.

Table: one row per model in assets/model-statistics.json, sorted by best-run cash (reference rows kept).
Cards: the featured models' runs from the trajectory manifest. --check only reports whether the table would change.
"""
import argparse, json, pathlib, re
P = pathlib.Path(__file__).resolve().parents[1]
CARD_MODELS = ['GPT-6 Astra', 'Claude Fable 5.1']   # cards regenerated from the manifest; other cards are left as they are


def money(v):
    return f'${v:,.2f}'


def table_rows(stats):
    rows = []
    for s in sorted(stats, key=lambda s: -s['best']):
        rows.append(f'<tr><th scope="row">{s["model"]}</th><td>{s["bankruptcy"]}</td><td>{money(s["best"])}</td>'
                    f'<td>{money(s["mean"])} ± {money(s["std"])}</td><td>{s["max_survival"]}</td>'
                    f'<td>{s["mean_survival"]:.1f} ± {s["std_survival"]:.1f}</td></tr>')
    return rows


def short(v):
    if v >= 1e9: return f'${v / 1e9:.2f}B'
    if v >= 1e6: return f'${v / 1e6:.2f}M'
    if v >= 1e3: return f'${v / 1e3:.2f}k'
    return f'${v:,.2f}'


def card(model):
    runs = sorted(model['runs'], key=lambda r: (-(r.get('display_cash', r['cash']) or 0), -r['survival_days']))
    items = []
    for n, r in enumerate(runs, 1):
        meta = f"survived {r['survival_days']}d · {r['action_count']} actions" if not r['bankrupt'] else f"bankrupt day {r['survival_days']} · {r['action_count']} actions"
        cash = 'BANKRUPTED' if r['bankrupt'] else short(r['cash'])
        items.append(f'<a href="trajectory-viewer/run.html?run={r["run_id"]}&amp;v=26" class="trajectory-run-item"><span class="trajectory-run-id">Run {n}</span>'
                     f'<span class="trajectory-run-meta">{meta}</span><span class="trajectory-run-cash">{cash}</span></a>')
    return f'<div class="trajectory-model-card"><h3>{model["model_display"]}</h3><div class="trajectory-runs">{"".join(items)}</div></div>'


def main(check):
    html = (P / 'index.html').read_text()
    stats = json.loads((P / 'assets/model-statistics.json').read_text())
    start = html.index('<tbody>', html.index('class="results-table"')) + len('<tbody>')
    end = html.index('<tr class="reference-row', start)
    old = [l for l in html[start:end].split('\n') if l.strip()]
    new = table_rows(stats)
    if check:
        missing = sorted(set(old) - set(new)); extra = sorted(set(new) - set(old))
        print('table identical' if old == new else f'table differs: {len(missing)} rows only in page, {len(extra)} only in generated')
        for l in missing[:5]: print('  page:', l[:160])
        for l in extra[:5]: print('  gen :', l[:160])
        return
    html = html[:start] + '\n' + '\n'.join(new) + '\n' + html[end:]
    manifest = json.loads((P / 'trajectory-viewer/data/runs/manifest.json').read_text())
    by_name = {m['model_display']: m for m in manifest['models']}
    for name in CARD_MODELS:
        m = re.search(r'<div class="trajectory-model-card"><h3>' + re.escape(name) + r'</h3>.*?</div></div>', html)
        assert m and name in by_name, name
        html = html[:m.start()] + card(by_name[name]) + html[m.end():]
    # Summary sentence above the table: top five models by best-run cash.
    top = [s['model'] for s in sorted(stats, key=lambda s: -s['best'])[:5]]
    sentence = f'<strong>{top[0]} achieves the highest best-run cash, followed by {", ".join(top[1:4])}, and {top[4]}.</strong>'
    html, n = re.subn(r'<strong>[^<]* achieves the highest best-run cash, followed by [^<]*\.</strong>', sentence, html)
    assert n == 1, n
    (P / 'index.html').write_text(html)
    # Per-model grid: same order as the table, models with per-run curves only.
    grid = P / 'assets/figures/cash-trajectories-grid.html'; g = grid.read_text()
    js = (P / 'assets/figures/runs-by-model.js').read_text(); runs = json.loads(js[js.index('{'):js.rindex('}') + 1])
    order = [s['model'] for s in sorted(stats, key=lambda s: -s['best']) if s['model'] in runs]
    g, n = re.subn(r'const MODEL_ORDER = \[[^\]]*\];', 'const MODEL_ORDER = ' + json.dumps(order) + ';', g)
    assert n == 1, n
    missing = [m for m in order if f'"{m}"' not in g.split('const PALETTE')[1].split('};')[0] and f"'{m}'" not in g.split('const PALETTE')[1].split('};')[0]]
    assert not missing, ('no grid color for', missing)
    grid.write_text(g)
    print('table rows', len(new), '; cards', CARD_MODELS, '; grid models', len(order), '; top', top)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--check', action='store_true'); main(ap.parse_args().check)
