"""Print flagged clips from asr_report.json:  asr_show.py ko ja   (threshold 0.8)"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'asr_report.json'), encoding='utf-8') as f:
    report = json.load(f)
for lang in sys.argv[1:] or ['ko', 'ja', 'zh']:
    bad = [x for x in report if x['lang'] == lang and x['score'] < 0.8]
    print('=====', lang, len(bad))
    for x in bad:
        extra = f"   [{x['want']} | {x['got']}]" if lang == 'zh' else ''
        print(f"{x['score']:.2f}  {x['tts']}  ->  {x['heard']}{extra}")
