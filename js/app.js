/* Echo Lingo — listening-first lessons for Korean, Japanese and Chinese. */
(function () {
  'use strict';
  const LS_KEY = 'echolingo.v1';
  const DAY = 86400000;
  const BOX_DAYS = [0, 1, 2, 4, 8, 16, 32];
  const PRACTICE_CAP = 12;
  const LX = window.ELLang;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = () => ymd(Date.now());

  /* ---------------- state ---------------- */
  function freshState() {
    return {
      v: 1, done: {}, srs: {}, days: {}, streak: { count: 0, last: null }, lastLang: null,
      xpTotal: 0, badges: {}, bestCombo: 0, goalDays: [],
      settings: { slow: false, goal: 20, sfx: true },
    };
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s && s.v === 1) {
        const f = freshState();
        const out = Object.assign(f, s, { settings: Object.assign(f.settings, s.settings || {}) });
        if (!s.xpTotal) out.xpTotal = Object.values(out.days).reduce((a, b) => a + b, 0);
        return out;
      }
    } catch (e) { /* ignore */ }
    return freshState();
  }
  let S = loadState();
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  const streakNow = () => (S.streak.last === today() || S.streak.last === ymd(Date.now() - DAY) ? S.streak.count : 0);
  const xpToday = () => S.days[today()] || 0;
  // Level L needs 12.5·L·(L−1) total XP: 0, 25, 75, 150, 250, 375 …
  const levelOf = (xp) => { let L = 1; while (12.5 * (L + 1) * L <= xp) L++; return L; };
  const levelFloor = (L) => 12.5 * L * (L - 1);

  // Adds XP and reports what changed (streak, goal, level) for the celebration screen
  function addXP(n) {
    const d = today();
    const before = { xp: S.days[d] || 0, level: levelOf(S.xpTotal), streakDay: S.streak.last === d };
    S.days[d] = before.xp + n;
    S.xpTotal += n;
    const ev = {};
    if (!before.streakDay) {
      S.streak.count = S.streak.last === ymd(Date.now() - DAY) ? S.streak.count + 1 : 1;
      S.streak.last = d;
      ev.streak = S.streak.count;
    }
    if (before.xp < S.settings.goal && S.days[d] >= S.settings.goal) {
      ev.goal = true;
      if (!S.goalDays.includes(d)) S.goalDays.push(d);
    }
    const L = levelOf(S.xpTotal);
    if (L > before.level) ev.level = L;
    save();
    return ev;
  }

  /* ---------------- data ---------------- */
  const D = { courses: [], tiers: {}, items: {}, manifest: {}, gram: {} };
  async function fetchJSON(u) { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); }
  async function loadAll() {
    const [courses, manifest] = await Promise.all([fetchJSON('data/index.json'), fetchJSON('audio/manifest.json').catch(() => ({}))]);
    D.courses = courses; D.manifest = manifest;
    for (const c of courses) {
      c.tierData = await Promise.all(c.tiers.map((t) => fetchJSON(t.file)));
      let g = 0; // lesson order across all tiers of this language
      c.tierData.forEach((tier, ti) => {
        tier.key = `${c.lang}-${c.tiers[ti].id}`;
        tier.lang = c.lang;
        D.tiers[tier.key] = tier;
        tier.lessons.forEach((les, li) => {
          les.idx = li; les.gidx = g++; les.lang = c.lang; les.tierKey = tier.key;
          (les.items || []).forEach((it) => { Object.assign(it, { lang: c.lang, lesson: les.id, lessonIdx: les.gidx, tierKey: tier.key }); D.items[it.id] = it; });
          (les.build || []).forEach((b) => Object.assign(b, { lang: c.lang, lesson: les.id, lessonIdx: les.gidx, kind: 'build' }));
        });
      });
    }
    // grammar patterns, indexed by their example sentence
    for (const c of courses) for (const les of allLessons(c.lang)) for (const g of les.grammar || []) {
      g.lesson = les; g.item = D.items[g.ex];
      if (g.item) (D.gram[g.ex] = D.gram[g.ex] || []).push(g);
    }
  }
  const course = (lang) => D.courses.find((c) => c.lang === lang);
  const sayOf = (e) => e.say || e.k || e.w;
  // Items that sound the same must never be answer choices together (他/她 are both tā)
  const soundKey = (e) => e.snd || (e.lang === 'zh' && e.r
    ? `zh|${e.r.toLowerCase().replace(/[\s.,?!'’，。？！、]/g, '')}`
    : `${e.lang}|${sayOf(e)}`);
  const group = (it) => (it.kind === 'char' || it.kind === 'word' ? 'word' : it.kind);
  const allLessons = (lang) => course(lang).tierData.flatMap((t) => t.lessons);
  function isOpen(les) {
    const all = allLessons(les.lang);
    return les.gidx === 0 || !!S.done[all[les.gidx - 1].id];
  }
  const nextLesson = (lang) => { const all = allLessons(lang); return all.find((l) => !S.done[l.id]) || null; };
  const langItems = (lang) => Object.values(D.items).filter((it) => it.lang === lang);

  /* ---------------- audio ---------------- */
  const player = new Audio();
  let playSeq = 0;
  function play(entry, slow, btn) {
    const lang = entry.lang, text = sayOf(entry);
    const src = D.manifest[`${lang}|${text}`];
    const rate = (slow ?? S.settings.slow) ? 0.7 : 1;
    const seq = ++playSeq;
    $$('.spk.playing').forEach((b) => b.classList.remove('playing'));
    if (btn) btn.classList.add('playing');
    return new Promise((res) => {
      const finish = () => { if (seq === playSeq && btn) btn.classList.remove('playing'); res(); };
      if (!src) { speak(lang, text, rate).then(finish); return; }
      player.pause();
      player.src = src;
      player.defaultPlaybackRate = rate; player.playbackRate = rate;
      player.preservesPitch = true;
      player.onended = finish;
      player.onerror = () => speak(lang, text, rate).then(finish);
      player.play().catch(finish);
    });
  }
  function speak(lang, text, rate) {
    return new Promise((res) => {
      if (!window.speechSynthesis) { res(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = course(lang).speech; u.rate = rate; u.onend = res; u.onerror = res;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      setTimeout(res, 4000);
    });
  }

  // Little synthesized sound effects (no files needed)
  const SFX = (() => {
    let ctx = null;
    const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
    function tone(freq, t0, dur, type = 'triangle', gain = 0.12) {
      try {
        const c = ac(), t = c.currentTime + t0;
        if (c.state === 'suspended') c.resume();
        const o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(c.destination);
        o.start(t); o.stop(t + dur + 0.03);
      } catch (e) { /* audio blocked */ }
    }
    const on = () => S.settings.sfx;
    return {
      good() { if (!on()) return; tone(784, 0, 0.12); tone(1175, 0.07, 0.22); },
      bad() { if (!on()) return; tone(196, 0, 0.22, 'sawtooth', 0.05); tone(147, 0.09, 0.3, 'sawtooth', 0.045); },
      combo() { if (!on()) return; [988, 1319, 1568, 1976].forEach((f, i) => tone(f, i * 0.055, 0.14, 'triangle', 0.08)); },
      done() { if (!on()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.11)); },
      level() { if (!on()) return; [392, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.25, 'square', 0.05)); },
    };
  })();

  /* ---------------- spaced repetition ---------------- */
  const srs = (id) => S.srs[id] || (S.srs[id] = { b: 0, due: 0, seen: 0, miss: 0 });
  function markSeen(id) { const r = srs(id); if (!r.seen) { r.seen = Date.now(); r.b = 1; r.due = Date.now() + BOX_DAYS[1] * DAY; } }
  function grade(id, ok) {
    const r = srs(id);
    if (!r.seen) r.seen = Date.now();
    if (ok) { r.b = Math.min(r.b + 1, BOX_DAYS.length - 1); r.due = Date.now() + BOX_DAYS[r.b] * DAY; }
    else { r.b = 1; r.miss++; r.due = Date.now(); }
  }
  const seenItems = (lang) => langItems(lang).filter((it) => S.srs[it.id] && S.srs[it.id].seen);
  const dueItems = (lang) => seenItems(lang).filter((it) => S.srs[it.id].due <= Date.now());
  const wordsLearned = () => Object.values(S.srs).filter((r) => r.seen).length;

  /* ---------------- badges ---------------- */
  const BADGES = [
    { id: 'first', icon: '👣', name: 'First steps', desc: 'Finish your first lesson', test: () => Object.keys(S.done).length >= 1 },
    { id: 'ten', icon: '🎒', name: 'Regular', desc: 'Finish 10 lessons', test: () => Object.keys(S.done).length >= 10 },
    { id: 'fifty', icon: '🏅', name: 'Committed', desc: 'Finish 50 lessons', test: () => Object.keys(S.done).length >= 50 },
    { id: 'perfect', icon: '🎯', name: 'Flawless', desc: 'Finish a lesson with 100% accuracy', test: (x) => x && x.acc === 100 },
    { id: 'combo10', icon: '🔥', name: 'On fire', desc: 'Get 10 right in a row', test: () => S.bestCombo >= 10 },
    { id: 'combo25', icon: '☄️', name: 'Unstoppable', desc: 'Get 25 right in a row', test: () => S.bestCombo >= 25 },
    { id: 'streak3', icon: '📅', name: 'Three days', desc: 'Keep a 3-day streak', test: () => streakNow() >= 3 },
    { id: 'streak7', icon: '🗓️', name: 'Full week', desc: 'Keep a 7-day streak', test: () => streakNow() >= 7 },
    { id: 'streak30', icon: '👑', name: 'Habit', desc: 'Keep a 30-day streak', test: () => streakNow() >= 30 },
    { id: 'words50', icon: '🌱', name: 'Sprout', desc: 'Learn 50 sounds and words', test: () => wordsLearned() >= 50 },
    { id: 'words250', icon: '🌿', name: 'Growing', desc: 'Learn 250 sounds and words', test: () => wordsLearned() >= 250 },
    { id: 'words1000', icon: '🌳', name: 'Forest', desc: 'Learn 1,000 sounds and words', test: () => wordsLearned() >= 1000 },
    { id: 'hangul', icon: '한', name: 'Hangul hero', desc: 'Finish Korean Tier 0', test: () => !!S.done['ko0-R'] },
    { id: 'kana', icon: 'あ', name: 'Kana kid', desc: 'Finish Japanese Tier 0', test: () => !!S.done['ja0-R'] },
    { id: 'tones', icon: '中', name: 'Tone tamer', desc: 'Finish Chinese Tier 0', test: () => !!S.done['zh0-R'] },
    { id: 'tri', icon: '🌏', name: 'Trilingual', desc: 'Finish a lesson in all three languages', test: () => ['ko', 'ja', 'zh'].every((l) => Object.keys(S.done).some((k) => k.startsWith(l))) },
    { id: 'goal5', icon: '⭐', name: 'Goal getter', desc: 'Hit your daily goal on 5 days', test: () => S.goalDays.length >= 5 },
    { id: 'level10', icon: '🚀', name: 'Level 10', desc: 'Reach level 10', test: () => levelOf(S.xpTotal) >= 10 },
  ];
  function checkBadges(ctx) {
    const fresh = [];
    for (const b of BADGES) if (!S.badges[b.id] && b.test(ctx)) { S.badges[b.id] = Date.now(); fresh.push(b); }
    if (fresh.length) save();
    return fresh;
  }

  /* ---------------- exercise generators ---------------- */
  function optionPool(target, ctx) {
    const g = group(target);
    const all = langItems(target.lang).filter((it) => it.id !== target.id && group(it) === g && !it.nopick);
    const same = all.filter((it) => it.lesson === target.lesson);
    const taught = all.filter((it) => it.lesson !== target.lesson && it.lessonIdx <= ctx.maxIdx);
    const later = all.filter((it) => it.lessonIdx > ctx.maxIdx);
    return [...shuffle(same), ...shuffle(taught), ...shuffle(later)];
  }
  function distractors(target, pool, n) {
    const keys = new Set([soundKey(target)]), ws = new Set([target.w]), out = [];
    for (const it of pool) {
      if (out.length >= n) break;
      if (keys.has(soundKey(it)) || ws.has(it.w)) continue;
      keys.add(soundKey(it)); ws.add(it.w); out.push(it);
    }
    return out;
  }
  function exHear(item, ctx, n = 3) {
    if (item.nopick) return null;
    const opts = [item, ...distractors(item, optionPool(item, ctx), n)];
    return opts.length < 2 ? null : { t: 'hear', item, opts: shuffle(opts) };
  }
  function exPair(ids) {
    const items = ids.map((id) => D.items[id]).filter(Boolean);
    return items.length < 2 ? null : { t: 'hear', pair: true, item: pick(items), opts: shuffle(items) };
  }
  function exSee(item, ctx) {
    if (item.nopick) return null;
    const opts = [item, ...distractors(item, optionPool(item, ctx), 2)];
    return opts.length < 2 ? null : { t: 'see', item, opts: shuffle(opts) };
  }
  function exMeaning(item, ctx) {
    if (!item.m) return null;
    const all = langItems(item.lang).filter((it) => it.m && it.id !== item.id);
    const g = group(item);
    const near = (it) => Math.abs(it.lessonIdx - item.lessonIdx) <= 12;
    const ordered = [
      ...shuffle(all.filter((it) => group(it) === g && it.lessonIdx <= ctx.maxIdx && near(it))),
      ...shuffle(all.filter((it) => group(it) === g && it.lessonIdx <= ctx.maxIdx && !near(it))),
      ...shuffle(all.filter((it) => group(it) === g && it.lessonIdx > ctx.maxIdx)),
      ...shuffle(all.filter((it) => group(it) !== g)),
    ];
    const ms = new Set([item.m]), ds = [];
    for (const it of ordered) { if (ds.length >= 3) break; if (ms.has(it.m)) continue; ms.add(it.m); ds.push(it); }
    return ds.length ? { t: 'meaning', item, opts: shuffle([item, ...ds]) } : null;
  }
  function exTone(item) {
    if (item.lang !== 'zh' || item.kind !== 'char') return null;
    const { tone, base } = LX.pinyinTone(item.r);
    return tone ? { t: 'tone', item, base, tone } : null;
  }
  function exSentence(item, ctx, translate) {
    if (!item.toks || item.toks.length < 2) return null;
    const have = new Set(item.toks);
    const pool = new Set();
    for (const it of langItems(item.lang)) {
      if (it.kind !== 'sent' || it.lessonIdx > ctx.maxIdx || it === item) continue;
      for (const t of it.toks) if (!have.has(t)) pool.add(t);
    }
    const extra = shuffle([...pool]).slice(0, item.toks.length <= 3 ? 2 : 3);
    return { t: 'build', words: true, translate: !!translate, item, comps: item.toks, tiles: shuffle([...item.toks, ...extra]) };
  }
  function exBuild(entry, ctx) {
    if (entry.kind === 'sent') return exSentence(entry, ctx, false);
    const comps = LX.comps(entry.lang, entry.w);
    if (comps.length < 2 || comps.length > 10) return null;
    const script = LX.script(comps[0]);
    const have = new Set(comps);
    const pool = new Set();
    for (const it of langItems(entry.lang)) {
      if (it.lessonIdx > ctx.maxIdx) continue;
      for (const c of LX.comps(it.lang, it.w)) if (!have.has(c) && LX.script(c) === script) pool.add(c);
    }
    for (const b of course(entry.lang).tierData.flatMap((t) => t.lessons.flatMap((l) => l.build || []))) {
      if (b.lessonIdx > ctx.maxIdx) continue;
      for (const c of LX.comps(b.lang, b.w)) if (!have.has(c) && LX.script(c) === script) pool.add(c);
    }
    const extra = shuffle([...pool]).slice(0, comps.length <= 3 ? 2 : 3);
    return { t: 'build', item: entry, comps, tiles: shuffle([...comps, ...extra]) };
  }
  // Grammar: blank out one part of a pattern sentence, choose the right particle / ending
  function exGap(g, partIdx) {
    const cands = g.parts.map((p, i) => i).filter((i) => g.parts[i].alt && g.parts[i].alt.length);
    if (!cands.length || !g.item) return null;
    const gi = partIdx ?? pick(cands);
    const p = g.parts[gi];
    return { t: 'gap', item: g.item, g, gi, opts: shuffle([p.w, ...p.alt.slice(0, 3)]) };
  }
  function gapFor(it) { const gs = D.gram[it.id]; return gs ? exGap(pick(gs)) : null; }
  function mainExercises(it, ctx) {
    if (it.nopick) return [];
    if (it.kind === 'sent') return [exMeaning(it, ctx), pick([exSentence(it, ctx, false), exSentence(it, ctx, true), exHear(it, ctx, 2)])];
    if (it.kind === 'word' && it.tierKey && !it.tierKey.endsWith('t0')) {
      const b = LX.comps(it.lang, it.w).length <= 6 ? exBuild(it, ctx) : null;
      return [exMeaning(it, ctx), pick([exHear(it, ctx), b || exHear(it, ctx)])];
    }
    if (it.lang === 'zh' && it.kind === 'char') return [exTone(it), Math.random() < 0.5 ? exHear(it, ctx) : exMeaning(it, ctx)];
    if (it.kind === 'letter' || it.kind === 'kata') return [exHear(it, ctx), Math.random() < 0.5 ? exSee(it, ctx) : null];
    return [exMeaning(it, ctx), Math.random() < 0.5 ? exHear(it, ctx) : null];
  }
  function quickEx(it, ctx) {
    if (it.lang === 'zh' && it.kind === 'char') return exTone(it);
    if (it.kind === 'word' || it.kind === 'sent') return exMeaning(it, ctx);
    return exHear(it, ctx, 1);
  }
  function anyEx(it, ctx) {
    if (D.gram[it.id] && Math.random() < 0.5) return gapFor(it);
    if (it.kind === 'sent') return pick([exMeaning(it, ctx), exSentence(it, ctx, false), exSentence(it, ctx, true)].filter(Boolean)) || null;
    const opts = [exHear(it, ctx), exSee(it, ctx), exMeaning(it, ctx), exTone(it)];
    if (it.kind === 'word' && LX.comps(it.lang, it.w).length <= 6) opts.push(exBuild(it, ctx));
    return pick(opts.filter(Boolean)) || null;
  }
  function regen(ex, ctx) {
    switch (ex.t) {
      case 'hear': return ex.pair ? { ...ex, opts: shuffle(ex.opts) } : exHear(ex.item, ctx) || ex;
      case 'see': return exSee(ex.item, ctx) || ex;
      case 'meaning': return exMeaning(ex.item, ctx) || ex;
      case 'build': return (ex.words ? exSentence(ex.item, ctx, ex.translate) : exBuild(ex.item, ctx)) || ex;
      case 'gap': return exGap(ex.g, ex.gi) || ex;
      default: return { ...ex };
    }
  }
  function spread(list) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].item === list[i - 1].item) {
        const j = list.findIndex((x, k) => k > i && x.item !== list[i - 1].item);
        if (j > 0) [list[i], list[j]] = [list[j], list[i]];
      }
    }
    return list;
  }

  function buildLesson(les) {
    const ctx = { maxIdx: les.gidx };
    const steps = (les.learn || []).map((card) => ({ t: 'learn', card, lang: les.lang }));
    const items = les.items;
    items.forEach((it, i) => {
      steps.push({ t: 'intro', item: it });
      if (i % 2 === 1 || i === items.length - 1) {
        const recent = items.slice(Math.max(0, i - 1), i + 1).filter((x) => !x.nopick);
        const ex = recent.length && quickEx(pick(recent), ctx);
        if (ex) steps.push(ex);
      }
    });
    // grammar: show the pattern after the new words, then drill it
    const gaps = [];
    for (const g of les.grammar || []) {
      if (!g.item) continue;
      steps.push({ t: 'pattern', g, item: g.item });
      const parts = shuffle(g.parts.map((p, i) => i).filter((i) => g.parts[i].alt)).slice(0, 2);
      parts.forEach((pi) => gaps.push(exGap(g, pi)));
    }
    let practice = [];
    items.forEach((it) => practice.push(...mainExercises(it, ctx)));
    (les.pairs || []).forEach((g) => practice.push(exPair(g)));
    const builds = les.tierKey.endsWith('t0') ? [...(les.build || []), ...items.filter((it) => it.kind === 'word' && LX.comps(it.lang, it.w).length >= 2)] : [];
    shuffle(builds).slice(0, 3).forEach((b) => practice.push(exBuild(b, ctx)));
    shuffle(dueItems(les.lang).filter((it) => it.lesson !== les.id)).slice(0, 2).forEach((it) => practice.push(anyEx(it, ctx)));
    practice = shuffle(practice.filter(Boolean)).slice(0, PRACTICE_CAP - Math.min(gaps.length, 3));
    practice = spread(shuffle([...practice, ...gaps.filter(Boolean).slice(0, 3)]));
    return { steps: [...steps, ...practice], ctx };
  }
  function buildReview(lang, targets, n) {
    const ctx = { maxIdx: Math.max(0, ...targets.map((it) => it.lessonIdx)) };
    const weak = targets.map((it) => { const r = S.srs[it.id] || { b: 0, miss: 0 }; return { it, score: r.b - r.miss * 0.5 + Math.random() * 1.5 }; })
      .sort((a, b) => a.score - b.score).slice(0, n).map((x) => x.it);
    const steps = weak.map((it) => anyEx(it, ctx)).filter(Boolean);
    const builds = course(lang).tierData.flatMap((t) => t.lessons.flatMap((l) => l.build || [])).filter((b) => b.lessonIdx <= ctx.maxIdx);
    shuffle(builds).slice(0, 2).forEach((b) => { const e = exBuild(b, ctx); if (e) steps.push(e); });
    // a couple of grammar gaps from patterns the learner has met
    const pats = targets.filter((it) => D.gram[it.id]);
    shuffle(pats).slice(0, 3).forEach((it) => { const e = gapFor(it); if (e) steps.push(e); });
    return { steps: spread(shuffle(steps)), ctx };
  }

  /* ---------------- rendering helpers ---------------- */
  const app = () => $('#app');
  const SPK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const TURTLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15c0-4 3-7 7-7s7 3 7 7H5z" fill="currentColor"/><circle cx="20.5" cy="13.5" r="2" fill="currentColor"/><path d="M6.5 15.5l-1 2.5M10 15.5v2.5M14 15.5v2.5M17.5 15.5l1 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ROLE = { n: 'who / what', v: 'action', a: 'describing', p: 'marker', e: 'ending', t: 'time / place', q: 'question', m: 'helper' };
  function wordHTML(it, big) {
    const ruby = it.k ? `<ruby>${esc(it.w)}<rt>${esc(it.k)}</rt></ruby>` : esc(it.w);
    return `<span lang="${it.lang}" class="tw${big ? ' big' : ''}${it.kind === 'sent' ? ' sent' : ''}">${ruby}</span>`;
  }
  function itemCard(it, opts = {}) {
    return `<div class="icard">
      <button class="spk sm" data-play="${esc(it.id || '')}" data-w="${esc(it.w)}" data-lang="${it.lang}" aria-label="Play">${SPK}</button>
      <div class="icard-t">${wordHTML(it)} <span class="rom">${esc(it.r)}</span>${it.m && !opts.noMeaning ? `<span class="mean">${esc(it.m)}</span>` : ''}</div>
    </div>`;
  }
  function findEntry(id, w, lang) {
    if (id && D.items[id]) return D.items[id];
    for (const t of course(lang).tierData) for (const l of t.lessons) for (const b of l.build || []) if (b.w === w) return b;
    return { w, lang };
  }
  function wirePlays(root) {
    $$('[data-play]', root).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      play(findEntry(b.dataset.play, b.dataset.w, b.dataset.lang), undefined, b);
    }));
  }
  function setAccent(lang) { document.body.dataset.lang = lang || ''; }
  // Split a sentence into pattern parts and the gaps (spaces, punctuation) between them
  function segments(text, parts) {
    const out = []; let pos = 0;
    parts.forEach((p, i) => {
      const k = text.indexOf(p.w, pos);
      if (k > pos) out.push({ gap: text.slice(pos, k) });
      out.push({ part: i });
      pos = k + p.w.length;
    });
    if (pos < text.length) out.push({ gap: text.slice(pos) });
    return out;
  }
  function anatomyHTML(g) {
    return `<div class="anat">${g.parts.map((p) => `
      <span class="gp r-${p.r}"><b lang="${g.item.lang}">${esc(p.w)}</b><small>${esc(p.m)}</small><i>${ROLE[p.r]}</i></span>`).join('')}</div>`;
  }
  function patternHTML(g, withPlay = true) {
    const it = g.item;
    return `<div class="pattern">
      <div class="formula" lang="${it.lang}">${esc(g.f)}</div>
      ${anatomyHTML(g)}
      <div class="patex">${withPlay ? `<button class="spk sm" data-play="${esc(it.id)}" data-w="${esc(it.w)}" data-lang="${it.lang}" aria-label="Play">${SPK}</button>` : ''}
        <div>${wordHTML(it)} <span class="rom">${esc(it.r)}</span><div class="mean">${esc(it.m)}</div></div></div>
    </div>`;
  }
  function toast(html, cls = '') {
    const t = document.createElement('div');
    t.className = `toast ${cls}`;
    t.innerHTML = html;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1700);
    setTimeout(() => t.remove(), 2200);
  }
  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'confetti';
    c.width = innerWidth; c.height = innerHeight;
    document.body.appendChild(c);
    const x = c.getContext('2d');
    const cols = ['#ff5a5f', '#ffb400', '#2f9e5b', '#2f6fdb', '#d43f5a', '#9b5de5', '#00bbf9'];
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, s: 5 + Math.random() * 6,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: pick(cols),
    }));
    let f = 0;
    (function tick() {
      x.clearRect(0, 0, c.width, c.height);
      for (const p of ps) {
        p.vy += 0.38; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore();
      }
      if (++f < 110) requestAnimationFrame(tick); else c.remove();
    })();
  }
  function countUp(el, to, ms = 900) {
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = `+${Math.round(to * (1 - Math.pow(1 - k, 3)))}`;
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function ring(frac, size = 64) {
    const r = size / 2 - 6, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  /* ---------------- home ---------------- */
  function renderHome() {
    setAccent('');
    const goal = S.settings.goal, xp = xpToday(), L = levelOf(S.xpTotal);
    const lo = levelFloor(L), hi = levelFloor(L + 1);
    const lastLang = S.lastLang && course(S.lastLang) ? S.lastLang : null;
    const nl = lastLang && nextLesson(lastLang);
    const dueAll = D.courses.map((c) => ({ c, n: dueItems(c.lang).length })).sort((a, b) => b.n - a.n)[0];
    const week = Array.from({ length: 7 }, (_, i) => {
      const t = Date.now() - (6 - i) * DAY, d = ymd(t);
      return `<span class="wd ${S.days[d] ? 'on' : ''} ${d === today() ? 'now' : ''}" title="${d}">${'SMTWTFS'[new Date(t).getDay()]}</span>`;
    }).join('');
    app().innerHTML = `
      <div class="page">
        <header class="top">
          <div class="brand"><span class="logo">◐</span> Echo Lingo</div>
          <div class="stats">
            <span class="pill fire" title="Day streak">🔥 <b>${streakNow()}</b></span>
            <span class="pill" title="Level ${L}: ${S.xpTotal - lo}/${hi - lo} XP to next level">Lv <b>${L}</b> <span class="lvbar"><i style="width:${((S.xpTotal - lo) / (hi - lo)) * 100}%"></i></span></span>
          </div>
        </header>
        ${installCardHTML()}
        ${nl ? `
        <button class="hero-card" id="continue" data-lang="${lastLang}">
          <span class="glyph sm" lang="${lastLang}">${course(lastLang).glyph}</span>
          <span class="hc-t"><span class="hc-k">Continue ${course(lastLang).name}</span><span class="hc-n">${esc(nl.title)}</span><span class="hc-s">Tier ${D.tiers[nl.tierKey].tier} · lesson ${nl.idx + 1}</span></span>
          <span class="hc-go">▶</span>
        </button>` : `<h1 class="h1">Pick a language to start</h1>`}
        <div class="today">
          <div class="goal">${ring(xp / goal)}<div><b>${xp}/${goal} XP</b><span>daily goal${xp >= goal ? ' ✓' : ''}</span></div></div>
          <div class="week"><div class="wdays">${week}</div><span>${streakNow()} day streak</span></div>
          ${dueAll && dueAll.n ? `<button class="btn ghost sm" id="quick">Quick review · ${dueAll.n}</button>` : ''}
        </div>
        <div class="langs">
          ${D.courses.map((c) => {
            const all = allLessons(c.lang), d = all.filter((l) => S.done[l.id]).length;
            const nx = nextLesson(c.lang) || all[all.length - 1];
            const tier = D.tiers[nx.tierKey];
            return `<button class="lang" data-lang="${c.lang}">
              <span class="glyph" lang="${c.lang}">${c.glyph}</span>
              <span class="lname">${c.name} <span lang="${c.lang}" class="native">${c.native}</span></span>
              <span class="lmeta">Tier ${tier.tier} · ${esc(tier.name)} · ${d}/${all.length} lessons</span>
              <span class="lbar"><i style="width:${(d / all.length) * 100}%"></i></span>
            </button>`;
          }).join('')}
        </div>
        <h2 class="h2">Badges <span class="muted sm">${Object.keys(S.badges).length}/${BADGES.length}</span></h2>
        <div class="badges">${BADGES.map((b) => `<div class="badge ${S.badges[b.id] ? 'got' : ''}" title="${esc(b.desc)}"><span>${b.icon}</span><b>${esc(b.name)}</b></div>`).join('')}</div>
        <footer class="settings">
          <label>Daily goal
            <select id="goal">${[10, 20, 30, 50].map((g) => `<option ${g === goal ? 'selected' : ''} value="${g}">${g} XP</option>`).join('')}</select>
          </label>
          <label><input type="checkbox" id="sfx" ${S.settings.sfx ? 'checked' : ''}> Sound effects</label>
          <label><input type="checkbox" id="slowdef" ${S.settings.slow ? 'checked' : ''}> Slow audio</label>
          <button class="link" id="reset">Reset progress</button>
        </footer>
        ${appInfoHTML()}
      </div>`;
    wireAppInfo();
    wireInstallCard();
    $$('.lang').forEach((b) => b.addEventListener('click', () => go(`#/c/${b.dataset.lang}`)));
    const cont = $('#continue');
    if (cont) cont.addEventListener('click', () => startLesson(lastLang, nl.id));
    const q = $('#quick');
    if (q) q.addEventListener('click', () => startPractice(dueAll.c.lang));
    $('#goal').addEventListener('change', (e) => { S.settings.goal = +e.target.value; save(); renderHome(); });
    $('#sfx').addEventListener('change', (e) => { S.settings.sfx = e.target.checked; save(); if (S.settings.sfx) SFX.good(); });
    $('#slowdef').addEventListener('change', (e) => { S.settings.slow = e.target.checked; save(); });
    $('#reset').addEventListener('click', () => {
      if (confirm('Erase all Echo Lingo progress on this browser?')) { S = freshState(); save(); renderHome(); }
    });
  }

  /* ---------------- course path ---------------- */
  function startPractice(lang) {
    const pool = dueItems(lang).length >= 4 ? dueItems(lang) : seenItems(lang);
    if (!pool.length) return;
    const { steps, ctx } = buildReview(lang, pool, 10);
    startSession(steps, ctx, { lang, kind: 'practice', title: 'Practice' });
  }
  function renderCourse(lang) {
    const c = course(lang);
    if (!c) return go('#/');
    setAccent(lang); S.lastLang = lang; save();
    const due = dueItems(lang).length, seen = seenItems(lang).length;
    const nl = nextLesson(lang);
    app().innerHTML = `
      <div class="page">
        <header class="top">
          <button class="back" data-go="#/">‹ Home</button>
          <div class="stats"><span class="pill fire">🔥 <b>${streakNow()}</b></span><span class="pill"><b>${xpToday()}</b>/${S.settings.goal} XP</span></div>
        </header>
        <div class="chead"><span class="glyph sm" lang="${lang}">${c.glyph}</span><div><h1 class="h1">${c.name}</h1><div class="muted">${c.native}</div></div></div>
        <div class="actions">
          ${nl ? `<button class="btn primary" id="cont">▶ ${esc(nl.title)}</button>` : ''}
          <button class="btn ghost" id="practice" ${seen ? '' : 'disabled'}>Practice${due ? ` · ${due}` : ''}</button>
          <button class="btn ghost" data-go="#/n/${lang}">Grammar</button>
        </div>
        ${c.tierData.map((tier) => `
          <section class="tier">
            <div class="tierhead">
              <div><div class="tiername">Tier ${tier.tier} · ${esc(tier.name)}</div><div class="muted">${esc(tier.sub)}</div></div>
              <button class="btn ghost sm" data-go="#/g/${tier.key}">Guide</button>
            </div>
            <ol class="path">
              ${tier.lessons.map((les, i) => {
                const done = !!S.done[les.id], open = isOpen(les);
                const cur = open && !done;
                const x = Math.round(Math.sin(i * 0.9) * 70);
                return `${les.unit ? `<li class="unit"><span>${esc(les.unit)}</span></li>` : ''}<li style="--x:${x}px">
                  <button class="node ${done ? 'done' : ''} ${cur ? 'cur' : ''} ${les.review ? 'rev' : ''}" data-les="${les.id}" ${open ? '' : 'disabled'} aria-label="${esc(les.title)}">
                    ${done ? '✓' : les.review ? '★' : i + 1}
                  </button>
                  <div class="nlabel">${esc(les.title)}${les.grammar ? '<span class="gtag">grammar</span>' : ''}${cur ? '<span class="start">Start</span>' : ''}</div>
                </li>`;
              }).join('')}
            </ol>
          </section>`).join('')}
      </div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $$('.node').forEach((b) => b.addEventListener('click', () => startLesson(lang, b.dataset.les)));
    const ct = $('#cont');
    if (ct) ct.addEventListener('click', () => startLesson(lang, nl.id));
    const pr = $('#practice');
    if (pr) pr.addEventListener('click', () => startPractice(lang));
    const curNode = $('.node.cur');
    if (curNode) curNode.scrollIntoView({ block: 'center' });
  }

  /* ---------------- guide & grammar notebook ---------------- */
  function renderGuide(key) {
    const tier = D.tiers[key];
    if (!tier) return go('#/');
    setAccent(tier.lang);
    app().innerHTML = `
      <div class="page">
        <header class="top"><button class="back" data-go="#/c/${tier.lang}">‹ ${course(tier.lang).name}</button></header>
        <h1 class="h1">Tier ${tier.tier} guide</h1>
        <p class="muted">${esc(tier.sub)}. Every “how it works” card in one place.</p>
        ${tier.lessons.filter((l) => l.learn && l.learn.length).map((l) => `
          <section class="gsec">
            <h2 class="h2">${l.idx + 1}. ${esc(l.title)}</h2>
            ${l.learn.map((card) => learnHTML(card, tier.lang)).join('')}
            ${(l.grammar || []).filter((g) => g.item).map((g) => patternHTML(g)).join('')}
          </section>`).join('')}
      </div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    wirePlays(app());
  }
  function legendHTML() {
    return `<div class="legend">${Object.entries(ROLE).map(([k, v]) => `<span class="gp mini r-${k}"><i>${v}</i></span>`).join('')}</div>`;
  }
  function renderNotebook(lang) {
    const c = course(lang);
    if (!c) return go('#/');
    setAccent(lang);
    const sections = c.tierData.map((tier) => {
      const ls = tier.lessons.filter((l) => l.grammar && l.grammar.length);
      if (!ls.length) return '';
      return `<h2 class="h2">Tier ${tier.tier} · ${esc(tier.name)}</h2>${ls.map((l) => `
        <section class="nb ${S.done[l.id] ? '' : 'locked'}">
          <div class="nbh"><b>${esc(l.title)}</b><span class="muted">${S.done[l.id] ? 'learned ✓' : `lesson ${l.idx + 1}`}</span></div>
          ${l.learn && l.learn[0] ? `<p class="nbp">${l.learn[0].p}</p>` : ''}
          ${l.grammar.filter((g) => g.item).map((g) => patternHTML(g)).join('')}
        </section>`).join('')}`;
    }).join('');
    const total = allLessons(lang).reduce((n, l) => n + (l.grammar ? l.grammar.length : 0), 0);
    const got = allLessons(lang).reduce((n, l) => n + (l.grammar && S.done[l.id] ? l.grammar.length : 0), 0);
    app().innerHTML = `
      <div class="page">
        <header class="top"><button class="back" data-go="#/c/${lang}">‹ ${c.name}</button></header>
        <h1 class="h1">${c.name} grammar notebook</h1>
        <p class="muted">${got}/${total} patterns learned. Each sentence is split into its parts. Colors show what job each part does.</p>
        ${legendHTML()}
        ${sections}
      </div>`;
    $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    wirePlays(app());
  }
  function learnHTML(card, lang) {
    return `<div class="learn" lang="en">
      <h3>${esc(card.h)}</h3>
      <p>${card.p.replace(/([぀-ヿ㄰-㆏가-힣一-鿿][぀-ヿ㄰-㆏가-힣一-鿿゛゜ー]*)/g, `<span lang="${lang}">$1</span>`)}</p>
      ${card.ex ? `<div class="exs">${card.ex.map((id) => D.items[id]).filter(Boolean).map((it) => itemCard(it)).join('')}</div>` : ''}
    </div>`;
  }

  /* ---------------- session runner ---------------- */
  let SES = null;
  function startLesson(lang, id) {
    const les = allLessons(lang).find((l) => l.id === id);
    if (!les) return;
    S.lastLang = lang; save();
    let built;
    if (les.review) {
      const tier = D.tiers[les.tierKey];
      const pool = tier.lessons.filter((l) => l.idx < les.idx).flatMap((l) => l.items || []);
      built = buildReview(lang, pool, 14);
    } else built = buildLesson(les);
    startSession(built.steps, built.ctx, { lang, kind: les.review ? 'review' : 'lesson', les, title: les.title });
  }
  function startSession(steps, ctx, meta) {
    SES = { steps: steps.slice(), i: 0, ctx, meta, first: new Map(), retries: new Map(), start: Date.now(), state: 'ask', combo: 0, maxCombo: 0, xp: 0, timer: null };
    setAccent(meta.lang);
    app().innerHTML = `
      <div class="lesson">
        <header class="lhead">
          <button class="x" id="quit" aria-label="Quit lesson">✕</button>
          <div class="prog"><i></i></div>
          <span class="combo" id="combo" hidden></span>
          <span class="lxp" id="lxp">0 XP</span>
          <button class="slowbtn ${S.settings.slow ? 'on' : ''}" id="slow" title="Slow audio (S)" aria-label="Slow audio">${TURTLE}</button>
        </header>
        <main class="stage" id="stage"></main>
        <footer class="foot" id="foot"></footer>
      </div>`;
    $('#quit').addEventListener('click', () => { if (confirm('Quit this lesson? Progress in it will be lost.')) { clearTimeout(SES.timer); SES = null; route(); } });
    $('#slow').addEventListener('click', toggleSlow);
    renderStep();
  }
  function toggleSlow() {
    S.settings.slow = !S.settings.slow; save();
    const b = $('#slow'); if (b) b.classList.toggle('on', S.settings.slow);
  }
  function setProgress() {
    const p = SES.steps.length ? SES.i / SES.steps.length : 0;
    $('.prog i').style.width = `${Math.round(p * 100)}%`;
  }
  function setHud() {
    const c = $('#combo');
    c.hidden = SES.combo < 2;
    c.textContent = `🔥 ${SES.combo}`;
    $('#lxp').textContent = `${SES.xp} XP`;
  }
  const cur = () => SES.steps[SES.i];
  // Choice exercises submit on tap; 'see' needs a listen first, builds need Check
  const autoSubmit = (ex) => ex.t === 'hear' || ex.t === 'meaning' || ex.t === 'tone' || ex.t === 'gap';

  function renderStep() {
    clearTimeout(SES.timer);
    setProgress();
    const step = cur();
    if (!step) return finish();
    SES.state = 'ask'; SES.sel = null; SES.built = [];
    const st = $('#stage'), ft = $('#foot');
    ft.className = 'foot';
    st.classList.remove('enter'); void st.offsetWidth; st.classList.add('enter');
    if (step.t === 'learn') {
      st.innerHTML = `<div class="kicker">How it works</div>${learnHTML(step.card, step.lang)}`;
      ft.innerHTML = `<button class="btn primary" id="go">Got it</button>`;
      wirePlays(st);
      $('#go').addEventListener('click', next);
      return;
    }
    if (step.t === 'pattern') {
      st.innerHTML = `<div class="kicker">Grammar pattern</div><div class="prompt">See how the sentence is built</div>${patternHTML(step.g)}${legendHTML()}`;
      ft.innerHTML = `<button class="btn primary" id="go">Got it</button>`;
      wirePlays(st);
      play(step.item, undefined, $('.pattern .spk', st));
      $('#go').addEventListener('click', next);
      return;
    }
    if (step.t === 'intro') return renderIntro(step, st, ft);
    renderExercise(step, st, ft);
  }

  function renderIntro(step, st, ft) {
    const it = step.item;
    const label = it.kind === 'sent' ? 'New sentence' : it.kind === 'word' ? 'New word' : it.kind === 'char' ? 'New character' : 'New sound';
    st.innerHTML = `
      <div class="kicker">${label}</div>
      <div class="prompt" id="ip">Listen…</div>
      <div class="hero"><button class="spk big" id="spk" aria-label="Play">${SPK}</button>
        <button class="spk slow" id="spkslow" aria-label="Play slowly">${TURTLE}</button></div>
      <div class="reveal" id="reveal" hidden>
        <div class="bigw">${wordHTML(it, true)}</div>
        <div class="rom big">${esc(it.r)}</div>
        ${it.m ? `<div class="mean big">${esc(it.m)}</div>` : ''}
        ${it.hint ? `<div class="hint">${esc(it.hint)}</div>` : ''}
        ${it.cousin ? `<div class="cousin"><b>Cousins:</b> ${esc(it.cousin)}</div>` : ''}
      </div>`;
    ft.innerHTML = `<button class="btn primary" id="go">Continue</button>`;
    const spk = $('#spk');
    const reveal = () => {
      const r = $('#reveal');
      if (!r || !r.hidden) return;
      r.hidden = false;
      $('#ip').textContent = 'Now say it out loud!';
      markSeen(it.id);
    };
    spk.addEventListener('click', () => play(it, undefined, spk));
    $('#spkslow').addEventListener('click', (e) => play(it, true, e.currentTarget));
    const mine = SES;
    play(it, undefined, spk).then(() => { if (SES === mine && cur() === step) reveal(); });
    SES.timer = setTimeout(reveal, 2600);
    $('#go').addEventListener('click', () => { reveal(); next(); });
  }

  function renderExercise(ex, st, ft) {
    const it = ex.item;
    const speaker = `<div class="hero"><button class="spk big" id="spk" aria-label="Play">${SPK}</button><button class="spk slow" id="spkslow" aria-label="Play slowly">${TURTLE}</button></div>`;
    let body = '';
    let autoplay = true;
    if (ex.t === 'hear') {
      body = `<div class="kicker">${ex.pair ? 'Sound pair' : 'Listen'}</div>
        <div class="prompt">${ex.pair ? 'These sound alike. Which one did you hear?' : 'Tap what you hear'}</div>${speaker}
        <div class="opts ${ex.opts.length === 4 ? 'four' : ''}">${ex.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span>${wordHTML(o)}${ex.pair ? `<span class="rom">${esc(o.r)}</span>` : ''}</button>`).join('')}</div>`;
    } else if (ex.t === 'see') {
      autoplay = false;
      body = `<div class="kicker">Read</div><div class="prompt">Which one sounds like this?</div>
        <div class="bigw">${wordHTML(it, true)}</div>
        <div class="opts aud">${ex.opts.map((o, i) => `<button class="opt audopt" data-i="${i}"><span class="key">${i + 1}</span><span class="spk sm">${SPK}</span></button>`).join('')}</div>`;
    } else if (ex.t === 'meaning') {
      body = `<div class="kicker">Meaning</div><div class="prompt">What does it mean?</div>${speaker}
        <div class="opts ${ex.opts.length === 4 ? 'four' : ''}">${ex.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span class="en">${esc(o.m)}</span></button>`).join('')}</div>`;
    } else if (ex.t === 'tone') {
      body = `<div class="kicker">Tone</div><div class="prompt">Which tone did you hear?</div>${speaker}
        <div class="tonew">${wordHTML(it)} <span class="rom">${esc(ex.base)}</span></div>
        <div class="opts four">${[1, 2, 3, 4].map((t, i) => `<button class="opt tone" data-i="${i}"><span class="key">${t}</span><span class="py">${esc(LX.markTone(ex.base, t))}</span><span class="shape">${LX.TONE_SHAPE[t]}</span></button>`).join('')}</div>`;
    } else if (ex.t === 'gap') {
      autoplay = false;
      const p = ex.g.parts[ex.gi];
      const sent = segments(it.w, ex.g.parts).map((s) => (s.gap != null ? esc(s.gap)
        : s.part === ex.gi ? `<span class="blank" id="blank">?</span>` : `<span class="gw r-${ex.g.parts[s.part].r}">${esc(ex.g.parts[s.part].w)}</span>`)).join('');
      body = `<div class="kicker">Grammar</div><div class="prompt">Fill the gap</div>
        <div class="engq">${esc(it.m)}</div>
        <div class="gapline" lang="${it.lang}">${sent}</div>
        <div class="gaphint">Missing: <b>${esc(ROLE[p.r])}</b> meaning “${esc(p.m)}”</div>
        <div class="opts ${ex.opts.length === 4 ? 'four' : ''}">${ex.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="key">${i + 1}</span><span class="tw" lang="${it.lang}">${esc(o)}</span></button>`).join('')}</div>`;
    } else if (ex.t === 'build') {
      if (ex.translate) autoplay = false;
      const top = ex.translate
        ? `<div class="kicker">Translate</div><div class="prompt">Say this in ${course(it.lang).name}</div><div class="engq">${esc(it.m)}</div>`
        : `<div class="kicker">Build it</div><div class="prompt">${ex.words ? 'Tap the words in the order you hear them' : 'Tap the pieces in the order you hear them'}</div>${speaker}`;
      body = `${top}
        ${it.lang === 'ko' && !ex.words ? '<div class="preview" id="preview" lang="ko"></div>' : ''}
        <div class="slots ${ex.words ? 'words' : ''}" id="slots"></div>
        <div class="tiles ${ex.words ? 'words' : ''}">${ex.tiles.map((c, i) => `<button class="tile" data-i="${i}" lang="${it.lang}">${esc(c)}</button>`).join('')}</div>`;
    }
    st.innerHTML = body;
    ft.innerHTML = autoSubmit(ex)
      ? `<span class="muted tap">Tap your answer</span>`
      : `<button class="btn primary" id="check" disabled>Check</button>`;
    const spk = $('#spk');
    if (spk) {
      spk.addEventListener('click', () => play(it, undefined, spk));
      $('#spkslow').addEventListener('click', (e) => play(it, true, e.currentTarget));
      if (autoplay) play(it, undefined, spk);
    }
    $$('.opt', st).forEach((b) => b.addEventListener('click', () => choose(+b.dataset.i)));
    $$('.tile', st).forEach((b) => b.addEventListener('click', () => tapTile(+b.dataset.i)));
    const ck = $('#check');
    if (ck) ck.addEventListener('click', check);
  }

  function choose(i) {
    if (!SES || SES.state !== 'ask') return;
    const ex = cur();
    if (!ex || ex.t === 'build') return;
    const max = ex.t === 'tone' ? 4 : ex.opts.length;
    if (i < 0 || i >= max) return;
    SES.sel = i;
    $$('.opt').forEach((b) => b.classList.toggle('sel', +b.dataset.i === i));
    if (ex.t === 'see') { play(ex.opts[i], undefined, $(`.opt[data-i="${i}"] .spk`)); $('#check').disabled = false; return; }
    if (autoSubmit(ex)) check();
  }
  function tapTile(i) {
    if (!SES || SES.state !== 'ask') return;
    const ex = cur();
    const used = SES.built.indexOf(i);
    if (used >= 0) SES.built.splice(used, 1); else SES.built.push(i);
    $$('.tile').forEach((b) => b.classList.toggle('used', SES.built.includes(+b.dataset.i)));
    $('#slots').innerHTML = SES.built.map((k) => `<button class="tile in" data-k="${k}" lang="${ex.item.lang}">${esc(ex.tiles[k])}</button>`).join('');
    const pv = $('#preview');
    if (pv) pv.textContent = LX.koCompose(SES.built.map((k) => ex.tiles[k]));
    $$('#slots .tile').forEach((b) => b.addEventListener('click', () => tapTile(+b.dataset.k)));
    $('#check').disabled = SES.built.length === 0;
  }

  function check() {
    if (!SES || SES.state !== 'ask') return;
    const ex = cur();
    let ok;
    if (ex.t === 'build') ok = SES.built.map((k) => ex.tiles[k]).join('\u0001') === ex.comps.join('\u0001');
    else if (SES.sel == null) return;
    else if (ex.t === 'tone') ok = SES.sel + 1 === ex.tone;
    else if (ex.t === 'gap') ok = ex.opts[SES.sel] === ex.g.parts[ex.gi].w;
    else ok = ex.opts[SES.sel] === ex.item || (ex.t !== 'meaning' && soundKey(ex.opts[SES.sel]) === soundKey(ex.item));
    SES.state = 'fb';
    const it = ex.item;
    const firstTry = it.id && !SES.first.has(it.id);
    if (firstTry) { SES.first.set(it.id, ok); grade(it.id, ok); save(); }

    // combo + XP
    if (ok) {
      SES.combo++;
      SES.maxCombo = Math.max(SES.maxCombo, SES.combo);
      SES.xp += 1;
      if (SES.combo % 5 === 0) {
        SES.xp += 3;
        SFX.combo();
        toast(`🔥 ${SES.combo} in a row! <b>+3 XP</b>`, 'combo');
      } else SFX.good();
    } else {
      SES.combo = 0;
      SFX.bad();
    }
    setHud();

    // mark options
    if (ex.t !== 'build') {
      const right = ex.t === 'tone' ? ex.tone - 1 : ex.t === 'gap' ? ex.opts.indexOf(ex.g.parts[ex.gi].w) : ex.opts.indexOf(it);
      $$('.opt').forEach((b) => {
        const i = +b.dataset.i;
        b.classList.toggle('right', i === right);
        b.classList.toggle('wrong', i === SES.sel && !ok);
        b.disabled = true;
      });
    }
    if (ex.t === 'gap') {
      const bl = $('#blank');
      if (bl) { bl.textContent = ex.g.parts[ex.gi].w; bl.className = `blank filled ${ok ? 'ok' : 'no'}`; }
    }
    if (!ok) {
      const n = (SES.retries.get(it) || 0) + 1;
      SES.retries.set(it, n);
      if (n <= 2) { const again = regen(ex, SES.ctx); if (again) SES.steps.push(again); }
    }
    const ft = $('#foot');
    ft.className = `foot ${ok ? 'good' : 'bad'} pop`;
    const p = ex.t === 'gap' ? ex.g.parts[ex.gi] : null;
    const answer = `${wordHTML(it)} <span class="rom">${esc(it.r)}</span>${it.m ? ` <span class="mean">${esc(it.m)}</span>` : ''}`;
    ft.innerHTML = `
      <div class="fb">
        <div class="fbt">${ok ? pick(['Nice!', 'Great ear!', 'Correct!', 'Yes!', 'Spot on!']) : 'Not quite. The answer was:'}</div>
        <div class="fba"><button class="spk sm" id="fbspk" aria-label="Play">${SPK}</button>${answer}</div>
        ${p ? `<div class="hint"><b lang="${it.lang}">${esc(p.w)}</b> = ${esc(p.m)} · pattern: <span lang="${it.lang}">${esc(ex.g.f)}</span></div>` : ''}
        ${it.hint && !ok ? `<div class="hint">${esc(it.hint)}</div>` : ''}
      </div>
      <button class="btn primary" id="go">Continue</button>`;
    const fbspk = $('#fbspk');
    fbspk.addEventListener('click', () => play(it, undefined, fbspk));
    const say = !ok || ex.t === 'build' || ex.t === 'see' || ex.t === 'gap';
    const mine = SES, step = ex;
    if (say) setTimeout(() => { if (SES === mine && cur() === step) play(it, undefined, fbspk); }, ok ? 150 : 350);
    $('#go').addEventListener('click', next);
    $('#go').focus();
    // correct answers move on by themselves
    if (ok) SES.timer = setTimeout(() => { if (SES === mine && cur() === step) next(); }, say ? 2300 : 1100);
  }

  function next() { if (!SES) return; clearTimeout(SES.timer); SES.i++; renderStep(); }

  function finish() {
    const m = SES.meta;
    const total = SES.first.size;
    const right = [...SES.first.values()].filter(Boolean).length;
    const acc = total ? Math.round((right / total) * 100) : 100;
    const bonus = 10 + (acc === 100 ? 5 : 0);
    const xp = SES.xp + bonus;
    if (m.les) {
      (m.les.items || []).forEach((it) => markSeen(it.id));
      const prev = S.done[m.les.id];
      S.done[m.les.id] = { best: Math.max(acc, prev ? prev.best : 0), at: Date.now() };
    }
    S.bestCombo = Math.max(S.bestCombo, SES.maxCombo);
    const ev = addXP(xp);
    const fresh = checkBadges({ acc });
    const secs = Math.round((Date.now() - SES.start) / 1000);
    const lang = m.lang, maxCombo = SES.maxCombo;
    SES = null;
    const nl = nextLesson(lang);
    $('.prog i').style.width = '100%';
    const events = [];
    if (ev.streak) events.push(`<div class="ev fire">🔥 <b>${ev.streak}-day streak!</b> ${ev.streak === 1 ? 'Come back tomorrow to keep it going.' : 'Keep it alive tomorrow.'}</div>`);
    if (ev.goal) events.push(`<div class="ev goal">⭐ <b>Daily goal reached!</b></div>`);
    if (ev.level) events.push(`<div class="ev level">🚀 <b>Level up! You're level ${ev.level}.</b></div>`);
    fresh.forEach((b) => events.push(`<div class="ev badge-ev"><span>${b.icon}</span> <b>New badge: ${esc(b.name)}</b> · ${esc(b.desc)}</div>`));
    $('#stage').innerHTML = `
      <div class="done">
        <div class="trophy">${acc === 100 ? '🏆' : acc >= 80 ? '🎉' : '💪'}</div>
        <div class="kicker">${m.kind === 'lesson' ? 'Lesson complete' : m.kind === 'review' ? 'Review complete' : 'Practice complete'}</div>
        <h1 class="h1">${esc(m.title)}</h1>
        <div class="tiles3">
          <div class="stat"><b id="xpc">+0</b><span>XP</span></div>
          <div class="stat"><b>${acc}%</b><span>accuracy</span></div>
          <div class="stat"><b>🔥 ${maxCombo}</b><span>best combo</span></div>
        </div>
        ${events.join('')}
        <p class="muted">${acc === 100 ? 'Perfect run: +5 bonus XP.' : 'Anything you missed comes back in Practice.'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p>
      </div>`;
    countUp($('#xpc'), xp);
    confetti();
    setTimeout(showUpdateBar, 2500);
    if (ev.level) SFX.level(); else SFX.done();
    const ft = $('#foot');
    ft.className = 'foot';
    ft.innerHTML = `${nl ? `<button class="btn ghost" id="back">Back to path</button><button class="btn primary" id="go">Next lesson ▶</button>`
      : `<button class="btn primary" id="go">Back to path</button>`}`;
    $('#go').addEventListener('click', () => (nl ? startLesson(lang, nl.id) : go(`#/c/${lang}`)));
    const bk = $('#back');
    if (bk) bk.addEventListener('click', () => go(`#/c/${lang}`));
    $('#go').focus();
  }

  /* ---------------- install, updates, offline ---------------- */
  const APPV = (window.EL_VERSION && window.EL_VERSION.version) || 'dev';
  const UPD = { reg: null, waiting: null, status: '' };
  // The PC preview (localhost) runs without the service worker so edits show up immediately; add ?sw=1 to test it.
  const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
  const UA = navigator.userAgent || '';
  const IS_APK = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(UA);
  const IS_STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const REPO = 'mRamos-14/echo-lingo';
  const APK_URL = `https://github.com/${REPO}/releases/latest/download/echo-lingo.apk`;
  const onHome = () => !location.hash || location.hash === '#/' || location.hash === '#';
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (!SES && onHome() && D.courses.length) renderHome(); });

  // Android app (APK): ask GitHub for the newest release and offer the download
  async function checkApkUpdate(manual) {
    if (manual) setUpdStatus('Checking…');
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' });
      if (r.status === 404) { if (manual) setUpdStatus('You have the latest version ✓'); return; }
      if (!r.ok) throw new Error(String(r.status));
      const rel = await r.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      const asset = (rel.assets || []).find((a) => a.name.endsWith('.apk'));
      if (latest && asset && latest > APPV) {
        UPD.apk = { version: latest, url: asset.browser_download_url };
        setUpdStatus(`Version ${latest} is ready`);
        showUpdateBar();
        if (!SES && onHome() && D.courses.length) renderHome();
      } else if (manual) setUpdStatus('You have the latest version ✓');
    } catch (e) { if (manual) setUpdStatus("You're offline, couldn't check"); }
  }
  function openExternal(url) { location.href = url; } // the Android app hands outside links to the phone's browser

  function initSW() {
    if (IS_APK) {
      checkApkUpdate(false);
      setInterval(() => checkApkUpdate(false), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkApkUpdate(false); });
      return;
    }
    if (!('serviceWorker' in navigator) || DEV_HOST) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      UPD.reg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) updateReady(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        if (navigator.serviceWorker.controller) setUpdStatus('Downloading update…');
        nw.addEventListener('statechange', () => {
          if (nw.state !== 'installed') return;
          if (navigator.serviceWorker.controller) updateReady(nw);
          else setUpdStatus('Ready to work offline ✓');
        });
      });
      // automatic checks: on open (register does one), every 30 minutes, and whenever the app comes back to the front
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((e) => console.warn('[echo-lingo] service worker failed', e));
    // reload only when the user pressed Update (not when the very first install takes control)
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!UPD.applying || reloading) return;
      reloading = true; location.reload();
    });
  }
  function setUpdStatus(t) { UPD.status = t; const el = $('#updstatus'); if (el) el.textContent = t; }
  function updateReady(worker) { UPD.waiting = worker; setUpdStatus('Update ready'); showUpdateBar(); if (!SES && !location.hash.match(/^#\/[cgn]\//)) renderHome(); }
  function showUpdateBar() {
    if (!(UPD.waiting || UPD.apk) || $('#updbar')) return;
    if (SES) return; // never cover the lesson's answer bar; shown again when the lesson ends
    const bar = document.createElement('div');
    bar.id = 'updbar'; bar.className = 'updbar';
    bar.innerHTML = UPD.apk
      ? `<span>✨ Echo Lingo ${esc(UPD.apk.version)} is out.</span><button class="btn primary sm" id="updnow">Download update</button><button class="link" id="updlater">Later</button>`
      : '<span>✨ A new version of Echo Lingo is ready.</span><button class="btn primary sm" id="updnow">Update now</button><button class="link" id="updlater">Later</button>';
    document.body.appendChild(bar);
    $('#updnow').addEventListener('click', applyUpdate);
    $('#updlater').addEventListener('click', () => bar.remove());
  }
  function applyUpdate() {
    if (UPD.apk) { openExternal(UPD.apk.url); return; }
    if (!UPD.waiting) return;
    if (SES && !confirm('Updating restarts the app, so this lesson will be lost. Update now?')) return;
    setUpdStatus('Updating…');
    UPD.applying = true;
    UPD.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  async function checkForUpdates() {
    if (IS_APK) { if (UPD.apk) showUpdateBar(); else await checkApkUpdate(true); return; }
    if (!UPD.reg) { setUpdStatus(DEV_HOST ? 'Updates are off in the PC preview' : 'Updates need the installed app'); return; }
    if (UPD.waiting) { showUpdateBar(); return; }
    setUpdStatus('Checking…');
    try { await UPD.reg.update(); } catch (e) { setUpdStatus("You're offline, couldn't check"); return; }
    const w = UPD.reg.waiting;
    if (w) updateReady(w);
    else if (UPD.reg.installing) setUpdStatus('Downloading update…');
    else setUpdStatus('You have the latest version ✓');
  }
  const offlineSaved = () => { try { return localStorage.getItem('echolingo.offline') === '1'; } catch (e) { return false; } };
  async function saveOffline(btn) {
    const urls = [...new Set(Object.values(D.manifest))];
    const q = urls.slice();
    let done = 0, failed = 0;
    btn.disabled = true;
    const worker = async () => {
      while (q.length) {
        const u = q.shift();
        try { const r = await fetch(u); if (!r.ok) failed++; } catch (e) { failed++; }
        done++;
        if (done % 25 === 0 || done === urls.length) btn.textContent = `Saving audio… ${Math.round((done / urls.length) * 100)}%`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (failed) { btn.disabled = false; btn.textContent = `Saved, but ${failed} files failed. Tap to retry`; return; }
    try { localStorage.setItem('echolingo.offline', '1'); } catch (e) { /* ignore */ }
    btn.textContent = 'Audio saved for offline ✓';
  }
  function appInfoHTML() {
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    return `<div class="appinfo">
      <span>Echo Lingo <b>${esc(APPV)}</b> · <span id="updstatus">${esc(UPD.status)}</span></span>
      <span class="appbtns">
        ${UPD.apk ? '<button class="btn primary sm" id="updnow2">Download update</button>'
          : UPD.waiting ? '<button class="btn primary sm" id="updnow2">Update now</button>'
          : '<button class="btn ghost sm" id="checkupd">Check for updates</button>'}
        ${sw ? `<button class="btn ghost sm" id="offline">${offlineSaved() ? 'Audio saved for offline ✓' : 'Save audio for offline (16 MB)'}</button>` : ''}
      </span>
    </div>`;
  }
  // Install help on the web version: APK for Android, Safari steps for iPhone
  const installHidden = () => { try { return localStorage.getItem('echolingo.hideinstall') === '1'; } catch (e) { return false; } };
  function installCardHTML() {
    if (IS_APK || IS_STANDALONE || installHidden() || !(IS_ANDROID || IS_IOS)) return '';
    let body;
    if (IS_ANDROID) {
      body = `<b>Get the Android app</b>
        <p>Download the app, open the file, and tap <b>Install</b>. If your phone asks, allow your browser to install apps. It works offline, and updates show up inside the app.</p>
        <div class="ibtns"><a class="btn primary sm" id="apkdl" href="download.html">Download Android app</a>
        ${installPrompt ? '<button class="btn ghost sm" id="pwainstall">Install from Chrome</button>' : ''}</div>
        <p class="muted sm">No download? In <b>Chrome</b> tap ⋮ → <b>Install app</b> (not “Create shortcut”) for a real app without the browser badge.</p>`;
    } else if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(UA)) {
      body = `<b>Install on iPhone</b><p>iPhone apps from the web can only be installed from <b>Safari</b>. Copy this page's link, open it in Safari, then follow the steps there.</p>`;
    } else {
      body = `<b>Install on iPhone</b>
        <ol><li>Tap the <b>Share</b> button <span class="ico">⬆︎</span> at the bottom of Safari.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. Open Echo Lingo from your home screen.</li></ol>`;
    }
    return `<div class="installcard"><button class="x sm" id="hideinstall" aria-label="Hide">✕</button><span class="ibig">📱</span><div>${body}</div></div>`;
  }
  function wireInstallCard() {
    const h = $('#hideinstall');
    if (h) h.addEventListener('click', () => { try { localStorage.setItem('echolingo.hideinstall', '1'); } catch (e) { /* ignore */ } const c = $('.installcard'); if (c) c.remove(); });
    const p = $('#pwainstall');
    if (p) p.addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderHome(); });
  }

  function wireAppInfo() {
    const c = $('#checkupd'); if (c) c.addEventListener('click', checkForUpdates);
    const u = $('#updnow2'); if (u) u.addEventListener('click', applyUpdate);
    const o = $('#offline'); if (o) o.addEventListener('click', () => saveOffline(o));
  }

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') {
      const btn = $('#go') || $('#check');
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
    if (!SES) return;
    const step = SES.steps[SES.i];
    if (e.key === ' ') {
      e.preventDefault();
      const spk = $('#spk') || $('#fbspk') || $('.pattern .spk');
      if (spk) spk.click();
    } else if (/^[1-9]$/.test(e.key) && step && step.t !== 'build' && SES.state === 'ask') {
      choose(+e.key - 1);
    } else if (e.key === 's' || e.key === 'S') {
      toggleSlow();
    }
  });

  /* ---------------- routing ---------------- */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    if (SES) return;
    setTimeout(showUpdateBar, 0);
    const h = location.hash || '#/';
    let m;
    if ((m = h.match(/^#\/c\/(\w+)/))) return renderCourse(m[1]);
    if ((m = h.match(/^#\/g\/([\w-]+)/))) return renderGuide(m[1]);
    if ((m = h.match(/^#\/n\/(\w+)/))) return renderNotebook(m[1]);
    renderHome();
  }
  window.addEventListener('hashchange', () => { if (SES) clearTimeout(SES.timer); SES = null; route(); });

  // test hooks
  window.EL = { D, get S() { return S; }, get SES() { return SES; }, startLesson, startPractice, buildLesson, buildReview, play, check, choose, tapTile, next, sayOf, soundKey, levelOf, BADGES, UPD, checkForUpdates, checkApkUpdate, APPV, IS_APK };

  initSW();
  loadAll().then(route).catch((err) => {
    app().innerHTML = `<div class="page"><h1 class="h1">Couldn't load lessons</h1><pre>${esc(err.stack || err)}</pre></div>`;
  });
})();
