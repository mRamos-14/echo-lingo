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
import re
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


AUDIO_GEN = 'edge1'  # bump when re-recording everything, so phones never keep stale offline copies
VOICES = {'ko': 'ko-KR-SunHiNeural', 'ja': 'ja-JP-NanamiNeural', 'zh': 'zh-CN-XiaoxiaoNeural'}
# Chinese characters with several readings: record a same-sounding character instead
ZH_TTS = {'只': '枝', '长': '常', '还': '孩', '都': '兜', '和': '河'}
# Korean lines the voice runs together (Whisper heard 찾으세요 / 답 주세요): a short comma pause keeps them clear
KO_TTS = {'차 주세요.': '차, 주세요.', '밥 주세요.': '밥, 주세요.'}
SLOW = {'차, 주세요.', '밥, 주세요.'}   # spoken text recorded 15% slower


def file_of(lang, text):
    alt = KO_TTS.get(text) if lang == 'ko' else None   # a new file name when the spoken text changes
    h = hashlib.sha1(f'{key_of(lang, text)}|{AUDIO_GEN}{"|" + alt + "|slow" if alt else ""}'.encode('utf-8')).hexdigest()[:12]
    return f'audio/{lang}/{h}.mp3'


def tts_of(lang, entry):
    """The text actually sent to the voice: the most natural spelling of what the learner should hear."""
    kind = entry.get('kind')
    say = say_of(entry)
    if lang == 'ja':
        if kind in ('letter', 'kata'):
            return say                       # single kana, plus the お for を / ほん for ん tricks
        if entry.get('k') and kind != 'sent':
            return entry['k']                # kanji word: its kana reading, so it can't be misread
        return entry['w'].replace(' ', '')   # natural text: the voice reads particle は as "wa" itself
    if lang == 'zh':
        return ZH_TTS.get(say, say)
    return KO_TTS.get(say, say)


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


# ---------------- sentence factory (daily Tower) ----------------
KO_JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
           'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
# particle: (after a consonant, after a vowel, romanization consonant-form, vowel-form)
KO_PART = {'을': ('을', '를', 'eul', 'reul'), '이': ('이', '가', 'i', 'ga'), '은': ('은', '는', 'eun', 'neun'),
           '이에요': ('이에요', '예요', 'ieyo', 'yeyo'), '로': ('으로', '로', 'euro', 'ro'),
           '에': ('에', '에', 'e', 'e'), '에서': ('에서', '에서', 'eseo', 'eseo')}
KO_FINAL_ROM = {'ㄱ': 'k', 'ㄲ': 'k', 'ㅋ': 'k', 'ㄴ': 'n', 'ㄷ': 't', 'ㅅ': 't', 'ㅆ': 't', 'ㅈ': 't', 'ㅊ': 't',
                'ㅌ': 't', 'ㅎ': 't', 'ㄹ': 'l', 'ㅁ': 'm', 'ㅂ': 'p', 'ㅍ': 'p', 'ㅇ': 'ng'}
KO_LIAISON = {'ㄱ': 'g', 'ㄲ': 'kk', 'ㅋ': 'k', 'ㄴ': 'n', 'ㄷ': 'd', 'ㅅ': 's', 'ㅆ': 'ss', 'ㅈ': 'j', 'ㅊ': 'ch',
              'ㅌ': 't', 'ㅎ': '', 'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅍ': 'p', 'ㅇ': 'ng'}


def ko_final(word):
    c = ord(word[-1]) - 0xAC00
    return KO_JONG[c % 28] if 0 <= c <= 11171 else ''


def ko_attach(word, rom, part, wrong=False):
    """word + particle in the right form (to/와 style rules), with romanization including the linking sound."""
    fin = ko_final(word)
    cons_f, vow_f, cons_r, vow_r = KO_PART[part]
    use_vowel = (not fin) or (part == '로' and fin == 'ㄹ')
    if wrong:
        use_vowel = not use_vowel
    form, form_r = (vow_f, vow_r) if use_vowel else (cons_f, cons_r)
    if fin and form == '로' and fin == 'ㄹ':
        rr = rom[:-1] + 'llo'
    elif fin and form_r[0] in 'aeiouy':
        fr = KO_FINAL_ROM.get(fin, '')
        base = rom[:-len(fr)] if fr and rom.endswith(fr) else rom
        rr = base + KO_LIAISON.get(fin, '') + form_r
    else:
        rr = rom + form_r
    return word + form, rr


SLOT = re.compile(r'\{(yi|[a-z0-9]+)(~2)?(?::([^}]+))?\}')


def compile_factory(lang, fac, items_by_w):
    """Expand templates × word groups into sentences for the daily Tower."""
    import itertools
    import random

    def cat(name):
        v = fac['cats'][name]
        if isinstance(v, str) and v.startswith('@'):
            return [e for n in v[1:].split(',') for e in cat(n)]
        return v

    out, seen = [], set()
    for ti, tpl in enumerate(fac['templates']):
        keys = []
        for m in SLOT.finditer(tpl['w']):
            if m.group(1) != 'yi' and (m.group(1), m.group(2)) not in keys:
                keys.append((m.group(1), m.group(2)))
        pools = [cat(k[0]) for k in keys]
        combos = []
        for combo in itertools.product(*pools):
            assign = dict(zip(keys, combo))
            words = [e[0] for e in combo]
            # ~2 must be a different word from the same group
            if any(k[1] and assign[k][0] == assign[(k[0], None)][0] for k in keys):
                continue
            combos.append(assign)
        random.Random(f'{lang}-{ti}').shuffle(combos)

        def rom(entry):
            w = entry[0]
            return entry[1].get('r') or (items_by_w.get(w) or {}).get('r') or w

        def render(text, assign, mode):
            def sub(m):
                name, inst, form = m.group(1), m.group(2), m.group(3)
                if name == 'yi':
                    return '一' if mode == 'w' else '\x00YI\x00'
                entry = assign[(name, inst)]
                word, data = entry[0], entry[1]
                if mode == 'm':
                    return data.get(form or 'o', word)
                wrong = bool(form and form.endswith('!'))
                f = form.rstrip('!') if form else None
                if lang == 'ko' and f in KO_PART:
                    w2, r2 = ko_attach(word, rom(entry), f, wrong)
                    return w2 if mode == 'w' else r2
                if f == 'mw':
                    return data['mw'] if mode == 'w' else data['mwr']
                if f and f in data and mode == 'w':
                    return data[f]
                return word if mode == 'w' else rom(entry)
            return SLOT.sub(sub, text)

        for assign in combos[:12]:
            w = render(tpl['w'], assign, 'w')
            disp = w.replace(' ', '') if lang == 'zh' else w
            if w in seen or disp in items_by_w:   # a lesson already teaches this exact sentence
                continue
            seen.add(w)
            r = render(tpl['r'], assign, 'r')
            if '\x00YI\x00' in r:   # 一 changes tone: yí before a 4th tone (and before 个 ge), yì otherwise
                nxt = r.split('\x00YI\x00', 1)[1].split()[0]
                t4 = nxt.strip('.,?!') == 'ge' or tone_count(nxt) and any(c in unicodedata.normalize('NFD', nxt) for c in '̀')
                r = r.replace('\x00YI\x00', 'yí' if t4 else 'yì')
            m = render(tpl['m'], assign, 'm')
            m = m[0].upper() + m[1:]
            toks = [t for t in (x.strip(PUNCT) for x in w.split(' ')) if t]
            need = [tpl['after']] + [items_by_w[e[0]]['lesson'] for e in assign.values() if e[0] in items_by_w]
            d = {'id': f'{lang}-x-' + hashlib.sha1(w.encode('utf-8')).hexdigest()[:10], 'w': disp, 'r': r, 'm': m,
                 'kind': 'sent', 'toks': toks, 'need': sorted(set(need)), 'tpl': ti}
            if lang == 'ja':
                say = ''.join(JA_SAY.get(t, t) for t in w.split(' '))
                if say != disp:
                    d['say'] = say
            xs = []
            for xt in tpl.get('x', []):
                xw = render(xt, assign, 'w')
                xw = xw.replace(' ', '') if lang == 'zh' else xw
                if xw != disp:
                    xs.append(xw)
            if xs:
                d['x'] = xs
            out.append(d)
    return out


def compile_factories():
    """Build data/<lang>/drills.json from src/<lang>/factory.json (needs the compiled lessons for word info)."""
    with open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    for c in index:
        lang = c['lang']
        src = os.path.join(ROOT, 'src', lang, 'factory.json')
        if not os.path.exists(src):
            continue
        items_by_w = {}
        for t in c['tiers']:
            with open(os.path.join(ROOT, t['file']), encoding='utf-8') as f:
                for les in json.load(f)['lessons']:
                    for it in les.get('items', []):
                        items_by_w.setdefault(it['w'].replace(' ', '') if lang == 'zh' else it['w'], {**it, 'lesson': les['id']})
        with open(src, encoding='utf-8') as f:
            fac = json.load(f)
        drills = compile_factory(lang, fac, items_by_w)
        dst = os.path.join(ROOT, 'data', lang, 'drills.json')
        with open(dst, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(drills, f, ensure_ascii=False, indent=1)
        print(f'factory {lang}: {len(drills)} Tower sentences')


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
            if not fn.endswith('.json') or fn in ('grammar.json', 'factory.json'):
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
                clips[key_of(lang, say_of(it))] = (lang, say_of(it), tts_of(lang, it))
            for b in les.get('build', []):
                if not b.get('w') or not b.get('r'):
                    errors.append(f'{where}: build entry missing w/r')
                clips[key_of(lang, say_of(b))] = (lang, say_of(b), tts_of(lang, {**b, 'kind': 'word'}))
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
    for k, (lang, text, _tts) in clips.items():
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


def render_edge(clips, redo=(), langs=None):
    """Record missing clips with Microsoft's native neural voices (edge-tts)."""
    import asyncio
    import edge_tts

    manifest, todo = {}, []
    for k, (lang, text, tts) in clips.items():
        rel = file_of(lang, text)
        manifest[k] = rel
        if langs and lang not in langs:
            continue
        if k in redo or not os.path.exists(os.path.join(ROOT, rel)):
            todo.append((k, lang, tts, rel))
    write_manifest(manifest, clips)
    keep = {os.path.normcase(os.path.join(ROOT, rel)) for rel in manifest.values()}
    removed = 0
    for dirpath, _, files in os.walk(AUDIO):
        for fn in files:
            p = os.path.join(dirpath, fn)
            if fn.endswith('.mp3') and os.path.normcase(p) not in keep:
                os.remove(p)
                removed += 1
    print(f'{len(clips)} clips total, {len(todo)} to record, {removed} old files removed', flush=True)
    if not todo:
        return

    sem = asyncio.Semaphore(6)
    failed = []
    done = [0]

    async def one(k, lang, tts, rel):
        out = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        async with sem:
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(tts, VOICES[lang], rate='-15%' if tts in SLOW else '+0%').save(out)
                    if os.path.getsize(out) > 1000:
                        break
                except Exception as e:  # network hiccup: retry
                    err = e
                await asyncio.sleep(1 + attempt)
            else:
                failed.append(k)
        done[0] += 1
        if done[0] % 100 == 0 or done[0] == len(todo):
            print(f'  recorded {done[0]}/{len(todo)}', flush=True)

    t0 = time.time()

    async def run():
        await asyncio.gather(*(one(*t) for t in todo))

    asyncio.run(run())
    print(f'recorded {len(todo) - len(failed)} clips in {time.time() - t0:.0f}s', flush=True)
    if failed:
        print('FAILED:', ', '.join(failed))


def write_manifest(manifest, clips):
    os.makedirs(AUDIO, exist_ok=True)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=0, sort_keys=True)


def check_drills(errors, clips):
    """Tower sentences: valid shape, known lessons, and their audio clips."""
    with open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    for c in index:
        lang = c['lang']
        p = os.path.join(ROOT, 'data', lang, 'drills.json')
        if not os.path.exists(p):
            continue
        lesson_ids = set()
        for t in c['tiers']:
            with open(os.path.join(ROOT, t['file']), encoding='utf-8') as f:
                lesson_ids |= {l['id'] for l in json.load(f)['lessons']}
        with open(p, encoding='utf-8') as f:
            for d in json.load(f):
                if len(d['toks']) < 2:
                    errors.append(f"drill {d['w']}: needs 2+ words")
                for lid in d['need']:
                    if lid not in lesson_ids:
                        errors.append(f"drill {d['w']}: unknown lesson {lid}")
                if '{' in d['w'] or '{' in d['r'] or '{' in d['m']:
                    errors.append(f"drill {d['w']}: unfilled slot")
                clips[key_of(lang, say_of(d))] = (lang, say_of(d), tts_of(lang, d))


def main():
    compile_sources()
    compile_factories()
    courses = load_courses()
    errors, clips = check(courses)
    check_drills(errors, clips)
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
    if '--cosyvoice' in sys.argv:   # the old local engine, kept for reference
        render(clips, redo, langs)
    else:
        render_edge(clips, redo, langs)


if __name__ == '__main__':
    main()
