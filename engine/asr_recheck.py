"""Second opinion for short clips that Whisper flagged.

Whisper guesses badly on a lone syllable, so each flagged short clip is played after a spoken lead-in
("the next word is …", same voice) and only the part after the lead-in is compared.
Writes asr_recheck.json and prints what still doesn't match.
"""
import asyncio
import difflib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import asr_check as A  # noqa: E402
import bake  # noqa: E402

LEAD = {'ko': '다음 단어는', 'ja': 'つぎのことばは', 'zh': '下一个字是'}


async def make_leads(tmp):
    import edge_tts
    paths = {}
    for lang, text in LEAD.items():
        p = os.path.join(tmp, f'lead_{lang}.mp3')
        await edge_tts.Communicate(text, bake.VOICES[lang]).save(p)
        paths[lang] = p
    return paths


def main():
    import whisper
    with open(os.path.join(HERE, 'asr_report.json'), encoding='utf-8') as f:
        report = json.load(f)
    flagged = [r for r in report if r['score'] < A.THRESHOLD and len(r['want'].split()) <= 4]
    tmp = tempfile.mkdtemp()
    leads = asyncio.run(make_leads(tmp))
    model = whisper.load_model('turbo', device='cuda')
    out = []
    for r in flagged:
        lang = r['lang']
        joined = os.path.join(tmp, 'joined.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', leads[lang], '-i', os.path.join(ROOT, r['file']),
                        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-ar', '16000', joined], check=True)
        heard = model.transcribe(joined, language=lang, temperature=0.0, condition_on_previous_text=False,
                                 fp16=True)['text'].strip()
        lead_n = A.normalize(lang, LEAD[lang])
        got = A.normalize(lang, heard)
        # drop the lead-in: align it to the start of the transcript
        sm = difflib.SequenceMatcher(None, lead_n, got)
        cut = max((b.b + b.size for b in sm.get_matching_blocks() if b.size), default=0)
        tail = got[cut:]
        want = r['want'].split()
        score = difflib.SequenceMatcher(None, want, tail).ratio() if want else 0
        out.append({**r, 'heard2': heard, 'tail': ' '.join(tail), 'score2': round(score, 3)})
    out.sort(key=lambda x: x['score2'])
    with open(os.path.join(HERE, 'asr_recheck.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for lang in ('ko', 'ja', 'zh'):
        rs = [x for x in out if x['lang'] == lang]
        ok = [x for x in rs if x['score2'] >= A.THRESHOLD]
        print(f'{lang}: rechecked {len(rs)}, now match {len(ok)}, still unclear {len(rs) - len(ok)}')
    for x in out:
        if x['score2'] < A.THRESHOLD:
            print(f"  {x['lang']}  {x['tts']}  ->  {x['heard2']}   [{x['want']} | {x['tail']}]")


if __name__ == '__main__':
    main()
