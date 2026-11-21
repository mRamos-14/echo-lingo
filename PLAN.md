# Echo Lingo — plan

A listening-first app for Korean, Japanese and Mandarin Chinese, built side by side.
Local only. Voices: CosyVoice 2 (open source), with all audio rendered ahead of time into files.

## Level ladder (difficulty, "kindergarten → college")

"Kindergarten" and "college" describe how hard the material is for an adult learner,
not native-child fluency. Each tier maps to the official exams so progress means something.

| Tier | Name | What you can do after it | Korean | Japanese | Chinese |
|---|---|---|---|---|---|
| 0 | Sounds (pre-K) | Hear and read the writing system | Hangul letters + syllable blocks | Hiragana + katakana | Pinyin + the 4 tones |
| 1 | Kindergarten | ~150 words: greetings, numbers, colors, family, food | — | — | — |
| 2 | Lower elementary | Simple sentences, "I am / I have / I want" | TOPIK 1 | JLPT N5 | HSK 1 |
| 3 | Upper elementary | Past/future, questions, daily routine, shopping | TOPIK 2 | N5–N4 | HSK 2 |
| 4 | Middle school | Linking ideas, reasons, plans, polite vs casual speech | TOPIK 3 | N4–N3 | HSK 3 |
| 5 | High school | Opinions, stories, faster natural speech | TOPIK 4 | N3–N2 | HSK 4 |
| 6 | College | Formal/academic talk, honorifics, idioms, news | TOPIK 5–6 | N2–N1 | HSK 5–6 |

Each tier = units of 4–6 short lessons (3–5 min each) + a unit review.

## Lesson types (audio first)

1. **How it works** card — plain-English explanation for a total beginner, with audio examples.
2. **Listen → meaning** — hear it, pick the English.
3. **Listen → writing** — hear it, pick the right script (가 vs 카, あ vs お, mā vs mà).
4. **Sound pairs** — tell apart the tricky ones (Korean 달/탈/딸, Japanese long vowels, Chinese tones).
5. **Build the sentence** — hear a sentence, tap word tiles in order.
6. **Repeat after me** — shadowing with slow/normal speed, you rate yourself (no mic for now).
7. **Dialogue** — short two-voice conversation, then a comprehension question.

Every clip has a slow (0.75×) button. Text can be shown or hidden ("ears only" mode).

## Learning loop

- Spaced repetition: each word/sentence has a memory strength; missed items come back sooner.
- Daily goal + streak, XP per lesson, unit reviews.
- Progress saved in the browser (localStorage) on this PC.

## Build pipeline

- `data/{ko,ja,zh}/tierN.js` — lesson content (text, reading, meaning, audio text).
- `engine/bake.py` — finds lines without audio, renders them with CosyVoice 2 → MP3 in `audio/`.
- Japanese audio is rendered from kana readings, since CosyVoice can misread kanji.
- `serve.py` — local server (port 5454).

## First build

Tier 0 + Tier 1 for all three languages, plus the full lesson engine. Later tiers get added in packs.
