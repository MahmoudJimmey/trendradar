#!/usr/bin/env node
/**
 * Generates clearly-labelled SAMPLE data so the dashboard renders before any
 * credentials exist, and so the momentum engine can be sanity-checked against
 * a known-shape multi-day history.
 *
 *   node scripts/seed-sample.js
 *
 * Everything it writes carries "sample": true, and the dashboard shows a banner
 * saying so. The first real collector run overwrites all of it.
 */

import { enrich, findDropouts, markCrossover } from './lib/momentum.js';
import {
  countCorpus, emergingPhrases, mergeCorpusHistory, clusterFormat, playbookFor,
  dedupeFormats,
} from './lib/formats.js';
import { paths, writeJson, mergeHistory } from './lib/store.js';

const P = paths();
const DAYS = 9;
const dayOf = (back) =>
  new Date(Date.now() + 3 * 3600e3 - back * 86400e3).toISOString().slice(0, 10);
const TODAY = dayOf(0);

/**
 * Each fixture declares where it started and where it is now; ranks in between
 * are interpolated with a little jitter so sparklines look like real series
 * rather than straight lines.
 */
const SOUNDS = [
  { id: '71203', label: 'Shoft Kalam', artist: 'Marwan Pablo, Lege-Cy & HatemBas', genre: 'Arabic Pop', from: null, to: 3, born: 2, posts: [48000, 121000], views: [9.1e6, 41.3e6] },
  { id: '71188', label: 'Wala Ash Wala Kan', artist: 'TUL8TE', genre: 'Arabic Pop', from: 22, to: 7, born: 8, posts: [61000, 96000], views: [22.4e6, 38.8e6] },
  { id: '71054', label: 'Ana Fadel', artist: 'Cairokee', genre: 'Arabic Rock', from: 9, to: 11, born: 8, posts: [88000, 103000], views: [44.2e6, 47.9e6] },
  { id: '70998', label: 'Getlak', artist: 'Amr Diab', genre: 'Arabic Pop', from: 4, to: 19, born: 8, posts: [140000, 152000], views: [71.5e6, 73.2e6] },
  { id: '71241', label: 'Desert Drive (Instrumental)', artist: 'Nile Beats', genre: 'Electronic', from: null, to: 14, born: 1, posts: [3100, 9800], views: [0.7e6, 3.4e6] },
  { id: '71166', label: 'Layali Masr', artist: 'Hoda Zain', genre: 'Arabic Pop', from: 31, to: 24, born: 6, posts: [19000, 27500], views: [6.8e6, 10.1e6] },
  { id: '70877', label: 'Slow Cruise', artist: 'Karim Rush', genre: 'Hip Hop/Rap', from: 12, to: 33, born: 8, posts: [77000, 80100], views: [33.0e6, 33.6e6] },
  { id: '71219', label: 'Beit El Ahlam', artist: 'Salma Fouad', genre: 'Arabic Pop', from: null, to: 27, born: 3, posts: [7400, 21300], views: [1.9e6, 7.7e6] },
  { id: '71255', label: 'Neon Nights (80s Edit)', artist: 'Retro Cairo', genre: 'Synth Pop', from: null, to: 9, born: 2, posts: [4100, 18900], views: [1.2e6, 14.7e6] },
];

const HASHTAGS = [
  // An 80s challenge breaking out is the worked example for format detection:
  // it enters as a hashtag, a sound and an Egyptian search query on the same day.
  { id: '9010', name: '80schallenge', from: null, to: 4, born: 2, posts: [5600, 26800], views: [7.4e6, 48.1e6] },
  { id: '9011', name: 'تحدي_الثمانينات', from: null, to: 16, born: 1, posts: [1900, 8200], views: [2.1e6, 11.4e6] },
  { id: '9001', name: 'تشطيب_شقتي', from: null, to: 5, born: 2, posts: [12400, 31900], views: [18.2e6, 62.4e6] },
  { id: '9002', name: 'كمبوند_التجمع', from: 18, to: 8, born: 8, posts: [8900, 15200], views: [11.4e6, 24.8e6] },
  { id: '9003', name: 'roomtour', from: 6, to: 6, born: 8, posts: [204000, 238000], views: [402e6, 447e6] },
  { id: '9004', name: 'العاصمة_الادارية', from: 26, to: 12, born: 7, posts: [4100, 9600], views: [5.2e6, 14.9e6] },
  { id: '9005', name: 'سيارتي_الجديدة', from: 14, to: 17, born: 8, posts: [33000, 38100], views: [29.7e6, 33.2e6] },
  { id: '9006', name: 'الساحل_الشمالي', from: 3, to: 21, born: 8, posts: [151000, 158000], views: [188e6, 194e6] },
  { id: '9007', name: 'قبل_وبعد', from: null, to: 9, born: 1, posts: [2200, 8700], views: [3.1e6, 12.6e6] },
  { id: '9008', name: 'f1egypt', from: 44, to: 29, born: 5, posts: [1900, 4300], views: [2.4e6, 6.1e6] },
];

/**
 * Deliberately fictional handles.
 *
 * An earlier version used plausible Egyptian handles like @decor.masr, which was
 * a mistake twice over: the invented video IDs 404'd when clicked, and a sample
 * row claiming "@decor.masr used this sound 4 times" is a fabricated statement
 * about an account that may genuinely exist. Sample creators are now obviously
 * placeholders and carry no URLs at all, so nothing is clickable and nothing is
 * asserted about a real person.
 */
const CREATORS = [
  '@example-creator-a', '@example-creator-b', '@example-creator-c',
  '@example-creator-d', '@example-creator-e', '@example-creator-f',
  '@example-creator-g', '@example-creator-h',
];

/* ------------------------------------------------------------------ */

function series(fixture, key) {
  const out = [];
  const start = DAYS - 1;
  for (let back = start; back >= 0; back--) {
    const age = start - back; // 0 = oldest day rendered
    const daysAlive = fixture.born - (start - age);
    if (daysAlive <= 0) continue; // not on the chart yet

    // t: 0 on the day it first charted, 1 today.
    const t = fixture.born <= 1 ? 1 : (daysAlive - 1) / (fixture.born - 1);
    const from = fixture.from ?? Math.min(60, (fixture.to ?? 40) + 25);
    const rank = Math.max(1, Math.round(lerp(from, fixture.to, t) + jitter(key + back, 1.4)));
    out.push({
      date: dayOf(back),
      rank,
      views: Math.round(lerp(fixture.views[0], fixture.views[1], t)),
      posts: Math.round(lerp(fixture.posts[0], fixture.posts[1], t)),
    });
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
function jitter(seed, amp) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  return ((h % 200) / 100 - 1) * amp;
}
const pick = (seed, arr, n) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) % 7919;
  return Array.from({ length: n }, (_, i) => arr[(h + i * 3) % arr.length]);
};

function creatorsFor(key, n = 4) {
  return pick(key, CREATORS, n).map((handle, i) => ({
    handle,
    profileUrl: null, // no link: these accounts do not exist
    uses: 4 - i,
    examples: [],
    placeholder: true,
  }));
}

/* ------------------------------------------------------------------ */

const soundHistory = {};
const soundToday = [];
for (const f of SOUNDS) {
  const key = `sound:${f.id}`;
  const s = series(f, key);
  const last = s[s.length - 1];
  soundHistory[key] = s.slice(0, -1);
  soundHistory[key].label = f.label;
  soundToday.push({
    key, id: f.id, label: f.label, artist: f.artist, genre: f.genre,
    rank: last.rank, views: last.views, posts: last.posts,
    durationSec: 28, songClipId: `clip_${f.id}`,
    previewUrl: null, source: 'tiktok-cml', commercialSafe: true,
    genresCharted: ['ALL', f.genre.includes('Arabic') ? 'ARABIC_POP' : 'POP'],
    creators: creatorsFor(key),
    examples: [],
  });
}

const tagHistory = {};
const tagToday = [];
for (const f of HASHTAGS) {
  const key = `tag:${f.id}`;
  const s = series(f, key);
  const last = s[s.length - 1];
  tagHistory[key] = s.slice(0, -1);
  tagHistory[key].label = `#${f.name}`;
  tagToday.push({
    key, id: f.id, label: `#${f.name}`, rawName: f.name,
    rank: last.rank, views: last.views, posts: last.posts,
    topCountries: ['EG', 'SA', 'AE'],
    categories: ['ALL', 'HOME_IMPROVEMENT'],
    source: 'tiktok-discovery', commercialSafe: true,
    creators: creatorsFor(key, 3),
    examples: [],
  });
}

// Two rows that were charting and have now fallen off — dropouts are a signal.
tagHistory['tag:9099'] = [
  { date: dayOf(3), rank: 11, views: 41e6, posts: 22000 },
  { date: dayOf(2), rank: 19, views: 43e6, posts: 23100 },
];
tagHistory['tag:9099'].label = '#صيف_2026';
soundHistory['sound:70712'] = [
  { date: dayOf(4), rank: 8, views: 55e6, posts: 90000 },
  { date: dayOf(2), rank: 26, views: 57e6, posts: 92000 },
];
soundHistory['sound:70712'].label = 'Sahran';

const APPLE = [
  { title: 'Shoft Kalam', artist: 'Marwan Pablo, Lege-Cy & HatemBas', rank: 1 },
  { title: 'Wala Ash Wala Kan', artist: 'TUL8TE', rank: 2 },
  { title: 'Ana Fadel', artist: 'Cairokee', rank: 4 },
  { title: 'Getlak', artist: 'Amr Diab', rank: 6 },
  { title: 'Layali Masr', artist: 'Hoda Zain', rank: 12 },
];

const appleRows = APPLE.map((r, i) => ({
  key: `apple:sample${i}`,
  label: r.title, artist: r.artist, rank: r.rank,
  views: null, posts: null, genre: 'Worldwide',
  releaseDate: dayOf(30 + i * 6), daysSinceRelease: 30 + i * 6,
  url: 'https://music.apple.com/eg/', source: 'apple-music-eg', commercialSafe: null,
}));

const SEARCH = [
  'أسعار الشقق في التجمع', 'تحدي الثمانينات', 'كمبوندات العاصمة الادارية',
  'تشطيب شقة 100 متر', 'الساحل الشمالي 2026', 'سعر الحديد اليوم',
  'فورمولا 1 السباق القادم', 'اقساط شقق بدون مقدم', 'ديكورات صغيرة',
];
const SEARCH_TRAFFIC = [20000, 10000, 10000, 5000, 5000, 2000, 2000, 1000, 500];
const searchRows = SEARCH.map((q, i) => ({
  key: `gtrend:${q}`,
  label: q, rank: i + 1,
  views: SEARCH_TRAFFIC[i] ?? 500,
  posts: null,
  approxTraffic: `${SEARCH_TRAFFIC[i] ?? 500}+`,
  isRTL: true,
  why: [{ title: 'Sample news item — replace on first real run', url: null, source: 'sample' }],
  source: 'google-trends', commercialSafe: true,
}));

const KEYWORDS = ['تشطيب', 'تحدي الثمانينات', 'كمبوند', 'روم تور', 'قبل وبعد', 'عربية جديدة', 'تقسيط'];

/**
 * Instagram audio, shaped exactly as /ig_audio returns it — which is to say
 * names and nothing else. No counts, no rank, no velocity, no country. The list
 * order is Meta's own and is NOT a published ranking, so rankIsOrderOnly is set
 * and the tab labels it as such.
 */
const IG_AUDIO = [
  { id: 'iga_1', title: 'Shoft Kalam', artist: 'Marwan Pablo, Lege-Cy & HatemBas', type: 'music', ads: true, sec: 29 },
  { id: 'iga_2', title: 'Neon Nights (80s Edit)', artist: 'Retro Cairo', type: 'music', ads: true, sec: 24 },
  { id: 'iga_3', title: 'original audio', artist: '@example-creator-d', type: 'original_sound', ads: null, sec: 18 },
  { id: 'iga_4', title: 'Wala Ash Wala Kan', artist: 'TUL8TE', type: 'music', ads: false, sec: 31 },
  { id: 'iga_5', title: 'original audio', artist: '@example-creator-b', type: 'original_sound', ads: null, sec: 12 },
  { id: 'iga_6', title: 'Ana Fadel', artist: 'Cairokee', type: 'music', ads: true, sec: 27 },
  { id: 'iga_7', title: 'original audio', artist: '@example-creator-g', type: 'original_sound', ads: null, sec: 21 },
  { id: 'iga_8', title: 'Layali Masr', artist: 'Hoda Zain', type: 'music', ads: false, sec: 26 },
];

const igRows = IG_AUDIO.map((a, i) => ({
  key: `igaudio:${a.id}`, id: a.id,
  label: a.title, artist: a.artist,
  rank: i + 1, rankIsOrderOnly: true,
  views: null, posts: null,
  durationSec: a.sec, audioType: a.type,
  adsEligible: a.ads,
  commercialSafe: a.ads === true ? true : null,
  geoNote: 'No country filter exists on this endpoint — treat as global',
  source: 'instagram-audio',
}));

/** YouTube Egypt most-popular, with the Shorts approximation applied. */
const YT = [
  { id: 'yt_1', title: 'تحدي الثمانينات مع أصحابي 😂', ch: 'Example Channel A', views: 1_840_000, likes: 96_000, sec: 47 },
  { id: 'yt_2', title: 'جولة في كمبوند بالتجمع الخامس | أسعار 2026', ch: 'Example Realty', views: 612_000, likes: 21_400, sec: 728 },
  { id: 'yt_3', title: 'قبل وبعد تشطيب شقة 120 متر', ch: 'Example Interiors', views: 498_000, likes: 33_100, sec: 61 },
  { id: 'yt_4', title: 'Formula 1 — أفضل لحظات السباق', ch: 'Example Motorsport', views: 377_000, likes: 18_900, sec: 154 },
  { id: 'yt_5', title: 'تجربة قيادة أرخص عربية 2026', ch: 'Example Auto', views: 289_000, likes: 12_600, sec: 892 },
  { id: 'yt_6', title: 'روم تور أوضتي الجديدة ✨', ch: 'Example Creator', views: 244_000, likes: 27_800, sec: 38 },
];

const ytRowsSample = YT.map((v, i) => ({
  key: `yt:${v.id}`, id: v.id,
  label: v.title, channel: v.ch, channelId: `UC_${v.id}`,
  rank: i + 1, views: v.views, likes: v.likes, comments: Math.round(v.likes / 14),
  posts: null,
  durationSec: v.sec, probableShort: v.sec <= 180,
  publishedAt: dayOf(1 + (i % 3)),
  url: null, // sample rows carry no links, so nothing dead is clickable
  tags: [], source: 'youtube-eg', commercialSafe: null,
}));
const keywordRows = KEYWORDS.map((w, i) => ({
  key: `kw:${w}`, label: w, rank: i + 1, views: null, posts: null,
  source: 'tiktok-search', commercialSafe: true,
  note: 'Order only — this endpoint returns no volume and no country filter',
}));

/* ------------------------------------------------------------------ */

let sounds = enrich(soundToday, soundHistory, TODAY, { commercialSafe: true });
sounds = markCrossover(sounds, [{ source: 'apple-music-eg', rows: APPLE }]);
const hashtags = enrich(tagToday, tagHistory, TODAY);
const keywords = enrich(keywordRows, {}, TODAY);
const searchDemand = enrich(searchRows, {}, TODAY);
const audioCharts = enrich(appleRows, {}, TODAY);
const igSounds = enrich(igRows, {}, TODAY);
const videos = enrich(ytRowsSample, {}, TODAY);

/* ------------------------------------------------------------------ *
 * Format detection over the sample corpus.
 *
 * Runs the real pipeline, so this doubles as a test of it. Eight quiet days are
 * synthesised first — without a baseline there is nothing for the 80s challenge
 * to spike against, and every phrase would look equally new.
 * ------------------------------------------------------------------ */

const rankWeight = (rank, span) =>
  Number.isFinite(rank) ? Math.max(1, Math.round(span - (rank / 200) * (span - 1))) : 1;

function corpusFor(tagRows, soundRows, kwRows, searchRows_) {
  return [
    ...tagRows.map((h) => ({ text: h.rawName || h.label, source: 'hashtags', weight: rankWeight(h.rank, 10), ref: h.key })),
    ...soundRows.map((s) => ({ text: [s.label, s.artist].filter(Boolean).join(' '), source: 'sounds', weight: rankWeight(s.rank, 6), ref: s.key })),
    ...kwRows.map((k) => ({ text: k.label, source: 'keywords', weight: 5, ref: k.key })),
    ...searchRows_.map((q) => ({
      text: q.label, source: 'searchDemand',
      weight: Number.isFinite(q.views) ? Math.min(10, Math.max(2, Math.round(Math.log10(q.views + 10) * 2.2))) : 3,
      ref: q.key,
    })),
    ...ytRowsSample.map((v) => ({
      text: v.label, source: 'videos', weight: rankWeight(v.rank, 4), ref: v.key,
    })),
  ];
}

// The quiet baseline is what was around a week ago: anything that first charted
// in the last two days must NOT appear in it, or a genuinely new format inherits
// nine days of history and reads as steady.
const bornDays = new Map([
  ...HASHTAGS.map((f) => [`tag:${f.id}`, f.born]),
  ...SOUNDS.map((f) => [`sound:${f.id}`, f.born]),
]);
const established = (row) => (bornDays.get(row.key) ?? 9) >= 3;
const isEighties = (t) => /80s|الثمانينات|neon nights|retro cairo|تحدي/i.test(t);

const quietTags = tagToday.filter((h) => established(h) && !isEighties(h.label));
const quietSounds = soundToday.filter((s) => established(s) && !isEighties(`${s.label} ${s.artist}`));
const quietKw = keywordRows.filter((k) => !isEighties(k.label));
const quietSearch = searchRows.filter((q) => !isEighties(q.label));

let corpusHistory = {};
for (let back = 9; back >= 1; back--) {
  corpusHistory = mergeCorpusHistory(
    corpusHistory,
    countCorpus(corpusFor(quietTags, quietSounds, quietKw, quietSearch)),
    dayOf(back)
  );
}

const todayTable = countCorpus(corpusFor(tagToday, soundToday, keywordRows, searchRows));
const phrases = emergingPhrases(todayTable, corpusHistory, TODAY, { minWeight: 3, limit: 40 });

const SEED_WATCH = ['challenge', 'تحدي', '80s', 'الثمانينات', 'قبل وبعد', 'room tour', 'روم تور', 'pov', 'تشطيب'];

const formatRows = phrases.map((p) => {
  const cluster = clusterFormat(p.phrase, {
    hashtags, sounds, keywords, searchDemand,
  });
  return {
    ...p,
    isSeed: SEED_WATCH.some((s) => p.phrase.includes(s.toLowerCase())),
    cluster,
    relatedHashtags: [],
    hasClearedSound: cluster.hasClearedSound,
    playbook: playbookFor(p.archetypes, p.verticals),
    verdict:
      p.status === 'fading' ? 'too-late'
      : p.status === 'unseen' || p.status === 'spiking' ? 'act-now'
      : p.status === 'spreading' ? 'ride-fast'
      : p.relevance >= 2 ? 'monitor'
      : 'skip',
  };
});

const formats = dedupeFormats(formatRows);

const sections = { formats, sounds, hashtags, keywords, searchDemand, rising: [], videos, audioCharts, igSounds };

const dropouts = {
  sounds: findDropouts(soundToday, soundHistory, TODAY),
  hashtags: findDropouts(tagToday, tagHistory, TODAY),
};

const all = [...sounds, ...hashtags];
const payload = {
  generatedAt: new Date().toISOString(),
  date: TODAY,
  country: 'EG',
  dateRange: '7DAY',
  sample: true,
  daysOfHistory: DAYS,
  summary: {
    formats: formats.length,
    formatsSpiking: formats.filter((f) => f.status === 'spiking' || f.status === 'unseen').length,
    formatsActionable: formats.filter((f) => f.verdict === 'act-now' && (f.relevance >= 2 || f.archetypes.length)).length,
    tracked: Object.values(sections).reduce((n, r) => n + r.length, 0),
    sounds: sounds.length,
    hashtags: hashtags.length,
    newToday: all.filter((r) => r.isNew).length,
    rising: all.filter((r) => r.stage === 'rising' || r.stage === 'emerging').length,
    actNow: all.filter((r) => r.verdict === 'act-now').length,
    tooLate: all.filter((r) => r.verdict === 'too-late').length,
    crossovers: sounds.filter((r) => r.crossover).length,
    verticalFit: all.filter((r) => r.relevance >= 2).length,
    commercialSafeSounds: sounds.filter((r) => r.commercialSafe === true).length,
    droppedOut: dropouts.sounds.length + dropouts.hashtags.length,
  },
  health: [
    { source: 'sample-generator', status: 'ok', count: sounds.length + hashtags.length, note: 'Example data — run scripts/collect.js with credentials to replace', at: new Date().toISOString() },
    { source: 'tiktok-sounds', status: 'skipped', count: 0, note: 'TIKTOK_ACCOUNT_TOKEN / TIKTOK_BUSINESS_ID not set', at: new Date().toISOString() },
    { source: 'tiktok-hashtags', status: 'skipped', count: 0, note: 'TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID not set', at: new Date().toISOString() },
    { source: 'instagram-audio', status: 'ok', count: igRows.length, note: 'sample — names only; Meta publishes no metrics, rank or country filter for audio', at: new Date().toISOString() },
    { source: 'youtube', status: 'ok', count: ytRowsSample.length, note: 'sample — Shorts flagged by duration, not by a platform field', at: new Date().toISOString() },
  ],
  sections,
  dropouts,
  competitorPanel: [],
  notes: {
    sample: 'Every row on this page is invented example data, shaped exactly like real collector output. It exists so the dashboard is legible before credentials are wired up.',
  },
};

await writeJson(P.latest, payload);
await writeJson(P.history, mergeHistory({ sounds: soundHistory, hashtags: tagHistory }, sections, TODAY));
await writeJson(P.corpus, mergeCorpusHistory(corpusHistory, todayTable, TODAY));
await writeJson(`${P.snapshotsDir}/${TODAY}.json`, payload);

console.log(`sample written · ${payload.summary.tracked} rows · ${DAYS} days of history`);
console.log(`  formats     : ${payload.summary.formats} (${payload.summary.formatsSpiking} spiking)`);
console.log(`  new today   : ${payload.summary.newToday}`);
console.log(`  rising      : ${payload.summary.rising}`);
console.log(`  act-now     : ${payload.summary.actNow}`);
console.log(`  crossovers  : ${payload.summary.crossovers}`);
console.log(`  dropped off : ${payload.summary.droppedOut}`);
