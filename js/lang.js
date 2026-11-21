/* Echo Lingo — language helpers: Hangul jamo, kana splitting, pinyin tones. */
(function () {
  'use strict';
  const L = (window.ELLang = {});

  // Hangul syllable -> compatibility jamo (한 -> ㅎ ㅏ ㄴ)
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
    'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  L.koJamo = function (w) {
    const out = [];
    for (const ch of w) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c < 0 || c > 11171) { if (ch.trim()) out.push(ch); continue; }
      out.push(CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)]);
      if (JONG[c % 28]) out.push(JONG[c % 28]);
    }
    return out;
  };

  // Jamo sequence -> Hangul blocks (ㅇ ㅏ ㅇ ㅣ -> 아이); leftovers stay as loose letters
  L.koCompose = function (jamo) {
    let out = '';
    for (let i = 0; i < jamo.length;) {
      const l = CHO.indexOf(jamo[i]), v = i + 1 < jamo.length ? JUNG.indexOf(jamo[i + 1]) : -1;
      if (l < 0 || v < 0) { out += jamo[i]; i++; continue; }
      let t = 0;
      const nx = jamo[i + 2];
      if (nx && JONG.indexOf(nx) > 0 && !(i + 3 < jamo.length && JUNG.includes(jamo[i + 3]))) t = JONG.indexOf(nx);
      out += String.fromCharCode(0xac00 + l * 588 + v * 28 + t);
      i += t ? 3 : 2;
    }
    return out;
  };

  // Kana -> beats, keeping small ゃゅょ with the kana before them (しゃしん -> しゃ し ん)
  const SMALL = 'ゃゅょぁぃぅぇぉャュョァィゥェォ';
  L.jaSplit = function (w) {
    const out = [];
    for (const ch of w) {
      if (SMALL.includes(ch) && out.length) out[out.length - 1] += ch;
      else if (ch.trim()) out.push(ch);
    }
    return out;
  };

  L.comps = function (lang, w) {
    if (lang === 'ko') return L.koJamo(w);
    if (lang === 'ja') return L.jaSplit(w);
    return [...w].filter((c) => c.trim());
  };

  // Which script a tile belongs to, so distractor tiles match (hiragana vs katakana etc.)
  L.script = function (s) {
    const c = s.codePointAt(0);
    if (c >= 0x3040 && c <= 0x309f) return 'hira';
    if ((c >= 0x30a0 && c <= 0x30ff)) return 'kata';
    if (c >= 0x3130 && c <= 0x318f) return 'jamo';
    if (c >= 0xac00 && c <= 0xd7a3) return 'hangul';
    if (c >= 0x4e00 && c <= 0x9fff) return 'han';
    return 'other';
  };

  // Pinyin tones
  const MARK = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };
  const COMB = ['', '̄', '́', '̌', '̀'];
  L.pinyinTone = function (s) {
    let tone = 0, base = '';
    for (const c of s.normalize('NFD')) {
      if (MARK[c]) tone = MARK[c]; else base += c;
    }
    return { tone, base: base.normalize('NFC') };
  };
  L.markTone = function (base, tone) {
    if (!tone) return base;
    const chars = [...base];
    const low = chars.map((c) => c.toLowerCase());
    let idx = low.findIndex((c) => c === 'a' || c === 'e');
    if (idx < 0) { const o = base.toLowerCase().indexOf('ou'); if (o >= 0) idx = [...base.slice(0, o)].length; }
    if (idx < 0) { for (let i = low.length - 1; i >= 0; i--) if ('aeiouü'.includes(low[i])) { idx = i; break; } }
    if (idx < 0) return base;
    chars[idx] = (chars[idx] + COMB[tone]).normalize('NFC');
    return chars.join('');
  };
  L.TONE_SHAPE = ['', '‾ high, flat', '╱ rising', '∨ dip', '╲ falling'];
})();
