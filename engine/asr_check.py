"""Listen to every audio clip with Whisper and flag any that don't say what the lesson says.

  .venv\\Scripts\\python.exe asr_check.py            # check all clips, write asr_report.json
  .venv\\Scripts\\python.exe asr_check.py ko ja      # only some languages

Comparison: Korean by Hangul letters, Japanese by kana reading (pykakasi), Chinese by pinyin WITH tones
(pypinyin), so a wrong tone counts as a mismatch. Digits in the transcript are turned back into words.
"""
import difflib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bake  # noqa: E402

THRESHOLD = 0.8
ZH_DIGITS = '零一二三四五六七八九'
KO_SINO = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']


def zh_number(n):
    if n == 0:
        return '零'
    out, units = '', [(10000, '万'), (1000, '千'), (100, '百'), (10, '十')]
    for val, ch in units:
        if n >= val:
            q, n = divmod(n, val)
            out += ('' if (val == 10 and q == 1 and not out) else zh_number(q)) + ch
        elif out and n:
            out += '零' if not out.endswith('零') else ''
    return out + (ZH_DIGITS[n] if n else '')


def ko_number(n):
    if n == 0:
        return '영'
    out = ''
    for val, ch in [(10000, '만'), (1000, '천'), (100, '백'), (10, '십')]:
        if n >= val:
            q, n = divmod(n, val)
            out += ('' if q == 1 else ko_number(q)) + ch
    return out + (KO_SINO[n] if n else '')


def digits_to_words(lang, s):
    def rep(m):
        n = int(m.group(0).replace(',', ''))
        return ko_number(n) if lang == 'ko' else zh_number(n)
    return re.sub(r'\d[\d,]*', rep, s)


_kks = None


def ja_kana(s):
    global _kks
    if _kks is None:
        import pykakasi
        _kks = pykakasi.kakasi()
    hira = ''.join(x['hira'] for x in _kks.convert(s))
    return re.sub(r'[^ぁ-ゟー]', '', hira).replace('ー', '')


def zh_pinyin(s):
    from pypinyin import Style, pinyin
    chars = re.sub(r'[^一-鿿]', '', s)
    return [p[0] for p in pinyin(chars, style=Style.TONE3, neutral_tone_with_five=True)]


def normalize(lang, s):
    s = digits_to_words(lang, s)
    if lang == 'ko':
        return list(re.sub(r'[^가-힣]', '', s))
    if lang == 'ja':
        return list(ja_kana(s))
    return zh_pinyin(s)


def main():
    import whisper
    langs = set(sys.argv[1:]) or {'ko', 'ja', 'zh'}
    errors, clips = bake.check(bake.load_courses())
    with open(os.path.join(ROOT, 'audio', 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    t0 = time.time()
    model = whisper.load_model('turbo', device='cuda')
    print(f'model loaded in {time.time() - t0:.0f}s', flush=True)
    prompts = {'zh': '以下是普通话的句子。', 'ja': None, 'ko': None}
    report, n = [], 0
    for key, (lang, say, tts) in sorted(clips.items()):
        if lang not in langs:
            continue
        path = os.path.join(ROOT, manifest[key])
        res = model.transcribe(path, language=lang, temperature=0.0, condition_on_previous_text=False,
                               initial_prompt=prompts[lang], fp16=True)
        heard = res['text'].strip()
        want, got = normalize(lang, tts), normalize(lang, heard)
        score = difflib.SequenceMatcher(None, want, got).ratio() if want else 0.0
        report.append({'key': key, 'lang': lang, 'tts': tts, 'heard': heard, 'score': round(score, 3),
                       'want': ' '.join(want), 'got': ' '.join(got), 'file': manifest[key]})
        n += 1
        if n % 200 == 0:
            print(f'  checked {n}', flush=True)
    report.sort(key=lambda r: r['score'])
    with open(os.path.join(HERE, 'asr_report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    for lang in sorted(langs):
        rs = [r for r in report if r['lang'] == lang]
        bad = [r for r in rs if r['score'] < THRESHOLD]
        print(f'{lang}: {len(rs)} clips, {len(rs) - len(bad)} match, {len(bad)} flagged')
    print(f'done in {time.time() - t0:.0f}s -> engine/asr_report.json')


if __name__ == '__main__':
    main()
