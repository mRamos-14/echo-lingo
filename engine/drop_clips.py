"""Delete specific audio clips so the next bake re-records them:  drop_clips.py "zh|还" "zh|都" """
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, 'audio', 'manifest.json'), encoding='utf-8') as f:
    manifest = json.load(f)
for key in sys.argv[1:]:
    rel = manifest.get(key)
    p = rel and os.path.join(ROOT, rel)
    if p and os.path.exists(p):
        os.remove(p)
        print('dropped', key)
    else:
        print('not found', key)
