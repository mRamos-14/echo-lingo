"""Echo Lingo voice test: render the same kinds of lines (single sound, word, sentence)
in Korean, Japanese and Chinese with CosyVoice2-0.5B, then write an HTML page to listen.

Run from the engine folder:  .venv\\Scripts\\python.exe voice_test.py
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, 'CosyVoice')
sys.path.insert(0, REPO)
sys.path.insert(0, os.path.join(REPO, 'third_party', 'Matcha-TTS'))

import torchaudio  # noqa: E402
from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

MODEL = os.path.join(HERE, 'models', 'CosyVoice2-0.5B')
PROMPT_WAV = os.path.join(REPO, 'asset', 'zero_shot_prompt.wav')
PROMPT_TEXT = '希望你以后能够做的比我还好呦。'
OUT = os.path.join(HERE, 'voice_test')

# (id, lang, label, text, mode)  mode: zs = zero-shot (same-language prompt), xl = cross-lingual
LINES = [
    ('ko_1', 'ko', 'Korean · single syllable 가 (ga)', '가', 'xl'),
    ('ko_2', 'ko', 'Korean · word 안녕하세요 (hello)', '안녕하세요', 'xl'),
    ('ko_3', 'ko', 'Korean · sentence (I am a student. Nice to meet you.)', '저는 학생이에요. 만나서 반가워요.', 'xl'),
    ('ja_1', 'ja', 'Japanese · single kana あ (a)', 'あ', 'zs'),
    ('ja_2', 'ja', 'Japanese · word こんにちは (hello)', 'こんにちわ', 'zs'),
    ('ja_3', 'ja', 'Japanese · sentence (I am a student. Nice to meet you.)', 'わたしわがくせいです。よろしくおねがいします。', 'zs'),
    ('ja_4', 'ja', 'Japanese · same sentence written with kanji (misreading check)', '私は学生です。よろしくお願いします。', 'zs'),
    ('zh_1', 'zh', 'Chinese · tone 1 妈 (mā, mom)', '妈', 'zs'),
    ('zh_2', 'zh', 'Chinese · tone 3 马 (mǎ, horse)', '马', 'zs'),
    ('zh_3', 'zh', 'Chinese · four tones 妈 麻 马 骂 (mā má mǎ mà)', '妈，麻，马，骂。', 'zs'),
    ('zh_4', 'zh', 'Chinese · word 你好 (hello)', '你好', 'zs'),
    ('zh_5', 'zh', 'Chinese · sentence (I am a student. Nice to meet you.)', '我是学生。很高兴认识你。', 'zs'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    tts = AutoModel(model_dir=MODEL)
    print(f'model loaded in {time.time() - t0:.1f}s, sample rate {tts.sample_rate}')
    import torch
    sr = tts.sample_rate

    def trim(wav, thresh=0.01, pad=0.08):
        """Cut dead air at both ends, keeping a short pad."""
        loud = (wav.abs() > thresh).nonzero()
        if loud.numel() == 0:
            return wav
        a = max(0, int(loud[0, 1]) - int(pad * sr))
        b = min(wav.shape[1], int(loud[-1, 1]) + int(pad * sr))
        return wav[:, a:b]

    def max_len(text):
        # generous ceiling: ~0.45 s per written character + 1 s; anything longer is babble
        chars = sum(1 for c in text if c.strip() and c not in '，。、,.!?')
        return 0.45 * chars + 1.0

    rows = []
    for lid, lang, label, text, mode in LINES:
        t = time.time()
        best = None
        for attempt in range(1, 6):
            if mode == 'zs':
                gen = tts.inference_zero_shot(text, PROMPT_TEXT, PROMPT_WAV, stream=False,
                                              text_frontend=(lang != 'ja'))
            else:
                gen = tts.inference_cross_lingual(f'<|{lang}|>{text}', PROMPT_WAV, stream=False)
            wav = trim(torch.cat([j['tts_speech'] for j in gen], dim=1))
            dur = wav.shape[1] / sr
            if best is None or dur < best[1]:
                best = (wav, dur)
            if dur <= max_len(text):
                break
        wav, dur = best
        torchaudio.save(os.path.join(OUT, f'{lid}.wav'), wav, sr)
        print(f'{lid}: {dur:.2f}s audio, {attempt} tries, {time.time() - t:.1f}s  {text}')
        rows.append((lid, label, text, dur))

    html = ['<!doctype html><meta charset="utf-8"><title>Echo Lingo voice test</title>',
            '<style>body{font:16px system-ui;max-width:760px;margin:24px auto;padding:0 16px;background:#fafaf7;color:#222}',
            'h1{font-size:22px}.r{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #ddd}',
            '.t{flex:1}.t b{display:block;font-size:20px}.t small{color:#666}audio{width:260px}</style>',
            '<h1>Echo Lingo · CosyVoice 2 voice test</h1><p>Same reference voice for all lines (the repo\'s Chinese female sample).</p>']
    for lid, label, text, dur in rows:
        html.append(f'<div class="r"><div class="t"><small>{label} · {dur:.1f}s</small><b>{text}</b></div>'
                    f'<audio controls preload="none" src="{lid}.wav"></audio></div>')
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(html))
    print('done', OUT)


if __name__ == '__main__':
    main()
