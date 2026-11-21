"""Whisper-check only the clips that asr_report.json has not covered yet (e.g. new Tower sentences).

  .venv\\Scripts\\python.exe asr_new.py      # writes asr_new.json, prints the flagged ones
"""
import difflib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bake  # noqa: E402
from asr_check import THRESHOLD, normalize  # noqa: E402


def main():
    import whisper
    errors, clips = bake.check(bake.load_courses())
    bake.check_drills(errors, clips)
    with open(os.path.join(ROOT, 'audio', 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    done = set()
    p = os.path.join(HERE, 'asr_report.json')
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            done = {r['file'] for r in json.load(f)}
    todo = [(k, v) for k, v in sorted(clips.items()) if manifest[k] not in done]
    print(f'{len(todo)} clips not checked yet', flush=True)
    model = whisper.load_model('turbo', device='cuda')
    prompts = {'zh': '以下是普通话的句子。', 'ja': None, 'ko': None}
    report = []
    t0 = time.time()
    for key, (lang, say, tts) in todo:
        res = model.transcribe(os.path.join(ROOT, manifest[key]), language=lang, temperature=0.0,
                               condition_on_previous_text=False, initial_prompt=prompts[lang], fp16=True)
        heard = res['text'].strip()
        want, got = normalize(lang, tts), normalize(lang, heard)
        score = difflib.SequenceMatcher(None, want, got).ratio() if want else 0.0
        report.append({'key': key, 'lang': lang, 'tts': tts, 'heard': heard, 'score': round(score, 3),
                       'want': ' '.join(want), 'got': ' '.join(got), 'file': manifest[key]})
    report.sort(key=lambda r: r['score'])
    with open(os.path.join(HERE, 'asr_new.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    for lang in ('ko', 'ja', 'zh'):
        rs = [r for r in report if r['lang'] == lang]
        bad = [r for r in rs if r['score'] < THRESHOLD]
        print(f'{lang}: {len(rs)} checked, {len(bad)} flagged')
        for r in bad:
            print(f"   {r['score']:.2f}  want {r['tts']}  heard {r['heard']}")
    print(f'done in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
