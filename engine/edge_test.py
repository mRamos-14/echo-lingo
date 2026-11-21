"""Quick check of the Microsoft neural voices for the three languages."""
import asyncio
import os

import edge_tts

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'voice_test', 'edge')
LINES = [
    ('ko-KR-SunHiNeural', 'ko_1', '가'), ('ko-KR-SunHiNeural', 'ko_2', '안녕하세요'),
    ('ko-KR-SunHiNeural', 'ko_3', '저는 학생이에요. 만나서 반가워요.'),
    ('ja-JP-NanamiNeural', 'ja_1', 'あ'), ('ja-JP-NanamiNeural', 'ja_2', 'こんにちは'),
    ('ja-JP-NanamiNeural', 'ja_3', 'わたしはがくせいです。よろしくおねがいします。'),
    ('zh-CN-XiaoxiaoNeural', 'zh_1', '妈'), ('zh-CN-XiaoxiaoNeural', 'zh_2', '马'),
    ('zh-CN-XiaoxiaoNeural', 'zh_3', '妈，麻，马，骂。'), ('zh-CN-XiaoxiaoNeural', 'zh_4', '我是学生。很高兴认识你。'),
]


async def main():
    os.makedirs(OUT, exist_ok=True)
    voices = await edge_tts.list_voices()
    for loc in ('ko-KR', 'ja-JP', 'zh-CN'):
        print(loc, [v['ShortName'] for v in voices if v['Locale'] == loc])
    for voice, name, text in LINES:
        await edge_tts.Communicate(text, voice).save(os.path.join(OUT, name + '.mp3'))
        print('ok', name, os.path.getsize(os.path.join(OUT, name + '.mp3')), 'bytes')


asyncio.run(main())
