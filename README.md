# Echo Lingo

A listening-first, Duolingo-style app for **Korean, Japanese and Mandarin Chinese**, from the very first sounds up to upper-elementary level (≈ TOPIK 2 / JLPT N4 / HSK 2), with about 103 lessons per language.

- Hear first: every word and sentence has native-language audio (rendered with the open-source [CosyVoice 2](https://github.com/FunAudioLLM/CosyVoice)).
- Grammar you can see: color-coded sentence patterns and fill-the-gap drills.
- Strict order: no sentence uses a word before the lesson that teaches it.
- Combos, XP, levels, badges, daily goal and streaks. Progress is saved on each device.

## Play on your phone

Open the GitHub Pages link in your phone's browser, then **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app). It opens full-screen and works offline; tap **Save audio for offline** on the home screen to keep all audio on the phone.

The app checks for new versions automatically (on open, when you come back to it, and every 30 minutes) and shows an **Update now** button. You can also tap **Check for updates** at the bottom of the home screen.

## Building (on the PC)

- Lessons are written in `src/<lang>/tN.json` and `src/<lang>/grammar.json`.
- `engine/bake.py --check` compiles them into `data/` and validates content and teaching order; `engine/bake.py` renders missing audio (needs the local CosyVoice setup, not included in this repo).
- `engine/build_pwa.py` stamps a new version and regenerates `sw.js`. Run it before every publish so installed apps see the update.
