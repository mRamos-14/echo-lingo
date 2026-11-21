"""Find sentence words that are used before the lesson that teaches them.

Known vocabulary at a lesson = every item taught in it or earlier (plus Tier 0 build words and
small grammar words introduced in learn cards). Japanese/Chinese sentences are split on spaces,
so each token is checked directly; Korean tokens carry particles/endings, so a token counts as
known if it starts with a known word stem.
"""
import json
import os
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUNCT = '.,?!。、，？！…'
# grammar words explained in learn cards, allowed from the lesson that explains them on
GRAMMAR = {
    'ja': {'は', 'を', 'が', 'です', 'か', 'の', 'に', 'で', 'も', 'ね', 'と', 'から', 'まで', 'な', 'この', 'その', 'あの',
           'ます', 'じゃ', 'ありません', 'でした', 'へ', 'いい', 'なん'},
    'zh': {'的', '吗', '呢', '了', '吧', '很', '不', '个', '也', '是', '在', '有', '太', '没', '一', '过', '都', '和', '会', '要', '想'},
    'ko': set(),
}
# Reviewed exceptions: the lesson's own new verb form (its grammar point), a fixed phrase learned
# as a whole chunk, or a name. Anything not listed here fails `bake.py --check`.
ACCEPT = {
    'ko': {
        'ko1-1': '가세요 계세요', 'ko1-2': '지내요', 'ko1-4': '민수예요', 'ko1-10': '한 두 세 몇',
        'ko1-30': '말해', 'ko2-17': '깎아', 'ko2-20': '아메리카노 드세요', 'ko3-3': '쉬었어요', 'ko3-5': '주 다음',
        'ko3-6': '갈 먹을 할', 'ko3-8': '가고 싶어요 먹고 보고', 'ko3-9': '볼까요', 'ko3-10': '수', 'ko3-13': '스무',
        'ko3-16': '도세요', 'ko3-25': '맛있지만', 'ko3-26': '잠깐만', 'ko3-27': '찍어', 'ko3-28': '가지 마세요 피우지',
        'ko3-29': '맛있게', 'ko3-30': '먹겠습니다 먹었습니다 수고하셨습니다',
    },
    'ja': {
        'ja1-1': 'ございます', 'ja1-2': 'よろしく おねがいします マリア', 'ja1-5': 'にほんじん', 'ja1-30': 'はなして もう いちど',
        'ja2-17': 'ぜんぶ', 'ja2-30': 'すきました', 'ja3-1': 'しました', 'ja3-2': 'たべませんでした しませんでした',
        'ja3-3': 'たのしかった さむかった', 'ja3-7': 'まって すわって', 'ja3-8': 'ふって', 'ja3-9': 'すんで しって',
        'ja3-10': 'おきて', 'ja3-12': 'やすみましょう', 'ja3-13': 'みませんか のみませんか', 'ja3-15': 'もらいました',
        'ja3-20': 'さんぜんえん', 'ja3-21': 'まがって', 'ja3-25': 'まよいました', 'ja3-27': 'ひきました', 'ja3-28': 'あけて',
        'ja3-30': 'ごちそうさま おつかれさま おめでとう',
    },
    'zh': {'zh1-3': '大卫', 'zh3-28': '光临'},
}
KO_ENDINGS = ('이에요', '예요', '이었어요', '였어요', '이요', '은', '는', '이', '가', '을', '를', '에', '에서', '로', '으로', '하고',
              '도', '의', '까지', '부터', '에게', '한테', '요')


def load(lang):
    with open(os.path.join(ROOT, 'data', 'index.json'), encoding='utf-8') as f:
        idx = json.load(f)
    c = next(c for c in idx if c['lang'] == lang)
    lessons = []
    for t in c['tiers']:
        with open(os.path.join(ROOT, t['file']), encoding='utf-8') as f:
            lessons += json.load(f)['lessons']
    return lessons


def ko_known(tok, known):
    if tok in known:
        return True
    for k in sorted(known, key=len, reverse=True):
        if len(k) >= 1 and tok.startswith(k) and len(k) >= max(1, len(tok) - 4):
            return True
    return False


def audit(lang):
    known = set(GRAMMAR[lang])
    problems = []
    for les in load(lang):
        if les.get('review'):
            continue
        for b in les.get('build', []):
            known.add(b['w'])
        items = les.get('items', [])
        for it in items:                       # words taught in this lesson count for its own sentences
            if it['kind'] != 'sent':
                known.add(it['w'].strip(PUNCT))
                if it.get('k'):
                    known.add(it['k'])
        for it in items:
            if it['kind'] != 'sent':
                continue
            src = it['w'] if lang != 'zh' else None
            toks = it['toks']
            bad = []
            for t in toks:
                if lang == 'ko':
                    ok = ko_known(t, known)
                elif lang == 'zh':
                    ok = t in known or all(ch in known for ch in t)
                else:
                    ok = t in known
                if not ok and t not in ACCEPT[lang].get(les['id'], '').split():
                    bad.append(t)
            if bad:
                problems.append((les['id'], les['title'], it['w'], bad))
            for t in toks:                     # once used in a sentence, it's been seen
                known.add(t)
    return problems


if __name__ == '__main__':
    for lang in sys.argv[1:] or ['ko', 'ja', 'zh']:
        ps = audit(lang)
        print(f'== {lang}: {len(ps)} sentences use something not yet taught')
        for p in ps:
            print(f'  {p[0]:8} {p[1][:26]:26} {p[2]}  ->  {", ".join(p[3])}')
