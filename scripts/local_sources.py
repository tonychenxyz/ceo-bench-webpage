"""Machine-specific source details (local paths, source folder names, scrub patterns that name people or accounts).

They live in scripts/local-sources.json, which is not tracked, so the public repository and site do not carry them.
"""
import json, pathlib, re, sys
_FILE = pathlib.Path(__file__).with_name('local-sources.json')
LOCAL = json.loads(_FILE.read_text()) if _FILE.exists() else {}


def scrub_patterns():
    if not LOCAL: print(f'warning: {_FILE.name} not found; only generic scrub patterns applied', file=sys.stderr)
    return [(re.compile(p), r) for p, r in LOCAL.get('scrub', [])]


def to_public(text):
    """Map the local data root to the public workspace path."""
    root = LOCAL.get('local_root')
    return text.replace(root, '/workspace') if root else text
