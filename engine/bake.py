"""Echo Lingo audio baker.

Reads every course file listed in data/index.json, checks the content, and renders any
missing audio clip with CosyVoice2-0.5B into audio/<lang>/<hash>.mp3, then writes
audio/manifest.json ({"<lang>|<text>": "audio/<lang>/<hash>.mp3"}).

  .venv\\Scripts\\python.exe bake.py --check     # validate content only
  .venv\\Scripts\\python.exe bake.py             # validate + render missing clips
  .venv\\Scripts\\python.exe bake.py --redo ko|ありがとう   # re-render one clip
"""
import hashlib
import json
import os
import subprocess
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.join(HERE, 'CosyVoice')
MODEL = os.path.join(HERE, 'models', 'CosyVoice2-0.5B')
PROMPT_WAV = os.path.join(REPO, 'asset', 'zero_shot_prompt.wav')
PROMPT_TEXT = '希望你以后能够做的比我还好呦。'
AUDIO = os.path.join(ROOT, 'audio')
MANIFEST = os.path.join(AUDIO, 'manifest.json')
TONE_MARKS = {'̄': 1, '́': 2, '̌': 3, '̀': 4}


def say_of(entry):
    return entry.get('say') or entry.get('k') or entry['w']


def key_of(lang, text):
    return f'{lang}|{text}'


def file_of(lang, text):
    h = hashlib.sha1(key_of(lang, text).encode('utf-8')).hexdigest()[:12]
    return f'audio/{lang}/{h}.mp3'


SENT_END = '.?!。？！'
PUNCT = '.,?!。、，？！…'
JA_SAY = {'は': 'わ', 'を': 'お', 'へ': 'え', 'では': 'でわ', 'には': 'にわ', 'とは': 'とわ',
          'こんにちは': 'こんにちわ', 'こんばんは': 'こんばんわ'}


def tone_count(r):
    return sum(1 for c in unicodedata.normalize('NFD', r) if c in TONE_MARKS)


def compile_tier(lang, src):
    """Expand a compact src/<lang>/tN.json into the full data/<lang>/tN.json format.

    Compact item rows: [w, r, m]  (ja may use [w, kana, r, m] when w contains kanji).
    Words in a sentence are separated by spaces (zh/ja spaces become tiles; zh display drops them).
    """
    tier = src['tier']
    out = {k: src[k] for k in ('lang', 'tier', 'name', 'sub')}
    out['lessons'] = []
    n = 0
    pid = lambda w: f'{lang}-' + (w.replace(' ', '') if lang == 'zh' else w)
    for les in src['lessons']:
        if les.get('review'):
            o = {'id': f'{lang}{tier}-R', 'title': les.get('title', f'Tier {tier} review'), 'review': True}
            if les.get('unit'):
                o['unit'] = les['unit']
            out['lessons'].append(o)
            continue
        n += 1
        o = {'id': f'{lang}{tier}-{n}', 'title': les['title']}
        if les.get('unit'):
            o['unit'] = les['unit']
        o['learn'] = []
        for card in les.get('learn', []):
            c = {'h': card[0], 'p': card[1]}
            if len(card) > 2:
                c['ex'] = [pid(x) for x in card[2]]
            o['learn'].append(c)
        o['items'] = []
        for row in les['items']:
            if lang == 'ja' and len(row) == 4:
                w, k, r, m = row
            else:
                w, r, m = row[:3]
                k = None
            sent = ' ' in w.strip() or w.strip()[-1] in SENT_END
            disp = w.replace(' ', '') if lang == 'zh' else w
            if lang == 'ja':
                say = ''.join(JA_SAY.get(t, t) for t in (k or w).split(' '))
            elif lang == 'zh':
                say = disp
            else:
                say = w
            kind = 'sent' if sent else 'word'
            if lang == 'zh' and not sent and len(disp) == 1 and tone_count(r) == 1:
                kind = 'char'
            it = {'id': pid(w), 'w': disp, 'r': r, 'm': m, 'kind': kind}
            if k:
                it['k'] = k.replace(' ', '') if not sent else k
            if say != disp:
                it['say'] = say
            if sent:
                toks = [t.strip(PUNCT) for t in w.split(' ')]
                it['toks'] = [t for t in toks if t]
            o['items'].append(it)
        if les.get('pairs'):
            o['pairs'] = [[pid(x) for x in g] for g in les['pairs']]
        out['lessons'].append(o)
    return out


def compile_sources():
    src_root = os.path.join(ROOT, 'src')
    if not os.path.isdir(src_root):
        return
    for lang in sorted(os.listdir(src_root)):
        grammar = {}
        gpath = os.path.join(src_root, lang, 'grammar.json')
        if os.path.exists(gpath):
            with open(gpath, encoding='utf-8') as f:
                grammar = {k: v for k, v in json.load(f).items() if not k.startswith('_')}
        for fn in sorted(os.listdir(os.path.join(src_root, lang))):
            if not fn.endswith('.json') or fn == 'grammar.json':
                continue
            with open(os.path.join(src_root, lang, fn), encoding='utf-8') as f:
                src = json.load(f)
            full = compile_tier(lang, src)
            for les in full['lessons']:
                if les['id'] in grammar:
                    les['grammar'] = [{
                        'f': g['f'],
                        'ex': f'{lang}-' + (g['ex'].replace(' ', '') if lang == 'zh' else g['ex']),
                        'parts': [{'w': p[0], 'm': p[1], 'r': p[2], **({'alt': p[3]} if len(p) > 3 else {})} for p in g['parts']],
                    } for g in grammar[les['id']]]
            dst = os.path.join(ROOT, 'data', lang, fn)
            with open(dst, 'w', encoding='utf-8', newline='\n') as f:  # same bytes on Windows and on GitHub
                json.dump(full, f, ensure_ascii=False, indent=1)
            print(f'compiled src/{lang}/{fn} -> data/{lang}/{fn}: {len(full["lessons"])} lessons')


def load_courses():
    with open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    out = []
    for c in index:
        for t in c['tiers']:
            with open(os.path.join(ROOT, t['file']), encoding='utf-8') as f:
                out.append((c['lang'], t['file'], json.load(f)))
    return out


def check(courses):
    errors, clips = [], {}
    seen_by_lang, words_by_lang = {}, {}
    for lang, path, tier in courses:
        if tier.get('lang') != lang:
            errors.append(f'{path}: lang mismatch')
        seen = seen_by_lang.setdefault(lang, {})
        words = words_by_lang.setdefault(lang, {})
        lesson_ids = set()
        for les in tier['lessons']:
            where = f"{path} {les.get('id')}"
            if les['id'] in lesson_ids:
                errors.append(f'{where}: duplicate lesson id')
            lesson_ids.add(les['id'])
            if les.get('review'):
                continue
            if not les.get('items'):
                errors.append(f'{where}: no items')
            for it in les.get('items', []):
                for fld in ('id', 'w', 'r', 'kind'):
                    if not it.get(fld):
                        errors.append(f"{where}: item {it.get('id')} missing {fld}")
                if it['id'] in seen:
                    errors.append(f"{where}: duplicate item id {it['id']}")
                if not it['id'].startswith(lang + '-'):
                    errors.append(f"{where}: item id {it['id']} should start with {lang}-")
                seen[it['id']] = it
                if it['w'] in words:
                    errors.append(f"{where}: {it['w']} already taught in {words[it['w']]}")
                words[it['w']] = les['id']
                if it['kind'] == 'sent' and len(it.get('toks', [])) < 2:
                    errors.append(f"{where}: sentence {it['w']} needs 2+ space-separated words")
                if it['kind'] in ('word', 'sent', 'char') and not it.get('m'):
                    errors.append(f"{where}: word {it['id']} has no meaning")
                if lang == 'zh' and it['kind'] == 'char':
                    tones = [TONE_MARKS[c] for c in unicodedata.normalize('NFD', it['r']) if c in TONE_MARKS]
                    if len(tones) != 1 or len(it['w']) != 1:
                        errors.append(f"{where}: char {it['id']} needs one character and one tone mark")
                clips[key_of(lang, say_of(it))] = (lang, say_of(it))
            for b in les.get('build', []):
                if not b.get('w') or not b.get('r'):
                    errors.append(f'{where}: build entry missing w/r')
                clips[key_of(lang, say_of(b))] = (lang, say_of(b))
            for grp in les.get('pairs', []):
                for pid in grp:
                    if pid not in seen:
                        errors.append(f'{where}: pair refers to unknown or later item {pid}')
                snds = [seen[p].get('snd') or say_of(seen[p]) for p in grp if p in seen]
                if len(set(snds)) != len(snds):
                    errors.append(f'{where}: pair {grp} has items that sound the same')
            for card in les.get('learn', []):
                for eid in card.get('ex', []):
                    if eid not in seen:
                        errors.append(f'{where}: learn example {eid} unknown or later')
            for g in les.get('grammar', []):
                ex = seen.get(g['ex'])
                if not ex:
                    errors.append(f"{where}: grammar example {g['ex']} is not an item taught by now")
                    continue
                pos = 0
                for p in g['parts']:
                    if p['r'] not in 'nvapetqm' or len(p['r']) != 1:
                        errors.append(f"{where}: grammar part {p['w']} has bad role {p['r']}")
                    i = ex['w'].find(p['w'], pos)
                    if i < 0:
                        errors.append(f"{where}: grammar part {p['w']} not found in order in {ex['w']}")
                        break
                    gap = ex['w'][pos:i]
                    if gap.strip(' ' + PUNCT):
                        errors.append(f"{where}: grammar parts skip “{gap}” in {ex['w']}")
                    pos = i + len(p['w'])
                    for a in p.get('alt', []):
                        if a == p['w']:
                            errors.append(f"{where}: grammar alt equals answer {a}")
                if ex['w'][pos:].strip(' ' + PUNCT):
                    errors.append(f"{where}: grammar parts don't cover the end of {ex['w']}")
    # teaching order: no sentence may use a word before the lesson that teaches it
    sys.path.insert(0, HERE)
    import audit_order
    for lang in sorted({c[0] for c in courses}):
        for lid, _title, w, bad in audit_order.audit(lang):
            errors.append(f"order {lid}: “{w}” uses {', '.join(bad)} before it is taught")
    return errors, clips


def max_len(text):
    chars = sum(1 for c in text if c.strip() and c not in '，。、,.!?ー')
    return 0.45 * chars + 1.0


def render(clips, redo=(), langs=None):
    sys.path.insert(0, REPO)
    sys.path.insert(0, os.path.join(REPO, 'third_party', 'Matcha-TTS'))
    import torch
    import torchaudio
    from cosyvoice.cli.cosyvoice import AutoModel

    manifest = {}
    todo = []
    for k, (lang, text) in clips.items():
        rel = file_of(lang, text)
        manifest[k] = rel
        if langs and lang not in langs:
            continue
        if k in redo or not os.path.exists(os.path.join(ROOT, rel)):
            todo.append((k, lang, text, rel))
    write_manifest(manifest, clips)
    keep = {os.path.normcase(os.path.join(ROOT, rel)) for rel in manifest.values()}
    for dirpath, _, files in os.walk(AUDIO):
        for fn in files:
            p = os.path.join(dirpath, fn)
            if fn.endswith('.mp3') and os.path.normcase(p) not in keep:
                os.remove(p)
                print('removed unused', os.path.relpath(p, ROOT))
    print(f'{len(clips)} clips total, {len(todo)} to render', flush=True)
    if not todo:
        return

    tts = AutoModel(model_dir=MODEL)
    sr = tts.sample_rate

    def trim(wav, thresh=0.01, pad=0.08):
        loud = (wav.abs() > thresh).nonzero()
        if loud.numel() == 0:
            return wav
        a = max(0, int(loud[0, 1]) - int(pad * sr))
        b = min(wav.shape[1], int(loud[-1, 1]) + int(pad * sr))
        return wav[:, a:b]

    t_all = time.time()
    flagged = []
    for n, (k, lang, text, rel) in enumerate(todo, 1):
        best = None
        for attempt in range(1, 6):
            if lang == 'ko':
                gen = tts.inference_cross_lingual(f'<|ko|>{text}', PROMPT_WAV, stream=False)
            else:
                gen = tts.inference_zero_shot(text, PROMPT_TEXT, PROMPT_WAV, stream=False,
                                              text_frontend=(lang != 'ja'))
            wav = trim(torch.cat([j['tts_speech'] for j in gen], dim=1))
            dur = wav.shape[1] / sr
            chars = sum(1 for c in text if c.strip() and c not in PUNCT)
            ok = max(0.15, 0.06 * chars) <= dur <= max_len(text)
            if best is None or (ok and not best[2]) or (ok == best[2] and dur < best[1]):
                best = (wav, dur, ok)
            if ok:
                break
        wav, dur, ok = best
        out = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp = out[:-4] + '.wav'
        torchaudio.save(tmp, wav, sr)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-b:a', '64k', out], check=True)
        os.remove(tmp)
        if not ok:
            flagged.append(k)
        print(f'[{n}/{len(todo)}] {k}  {dur:.2f}s  tries={attempt}{"  FLAG" if not ok else ""}', flush=True)
    print(f'rendered {len(todo)} clips in {time.time() - t_all:.0f}s', flush=True)
    if flagged:
        print('FLAGGED (length out of range after 5 tries):', ', '.join(flagged))


def write_manifest(manifest, clips):
    os.makedirs(AUDIO, exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=0, sort_keys=True)


def main():
    compile_sources()
    courses = load_courses()
    errors, clips = check(courses)
    for e in errors:
        print('ERROR', e)
    print(f'checked {len(courses)} tier files, {len(clips)} unique clips, {len(errors)} errors', flush=True)
    if errors or '--check' in sys.argv:
        sys.exit(1 if errors else 0)
    redo = set()
    if '--redo' in sys.argv:
        redo.add(sys.argv[sys.argv.index('--redo') + 1])
    langs = None
    if '--lang' in sys.argv:  # render only these languages, e.g. --lang ja,zh (manifest still lists all)
        langs = set(sys.argv[sys.argv.index('--lang') + 1].split(','))
    render(clips, redo, langs)


if __name__ == '__main__':
    main()
