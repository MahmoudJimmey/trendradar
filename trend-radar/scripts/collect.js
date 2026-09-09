#!/usr/bin/env node
/**
 * Collector. Runs once, writes one dated snapshot, updates the rolling history.
 *
 *   node scripts/collect.js
 *
 * Every source degrades independently: if a token is missing or an endpoint
 * fails, that section is skipped, the reason is recorded in `health`, and the
 * dashboard shows it as a broken source instead of silently displaying stale
 * numbers. Silent failure is the thing that kills dashboards.
 */

import { enrich, findDropouts, markCrossover } from './lib/momentum.js';
import {
  countCorpus, emergingPhrases, mergeCorpusHistory, clusterFormat, playbookFor,
  classifyFormat, aliasesOf, dedupeFormats,
} from './lib/formats.js';
import {
  paths, today, readJson, writeJson, mergeHistory, sectionHistory, snapshotDates,
} from './lib/store.js';
import * as tiktok from './sources/tiktok.js';
import * as gtrends from './sources/googleTrends.js';
import * as apple from './sources/appleMusic.js';
import * as youtube from './sources/youtube.js';
import * as instagram from './sources/instagram.js';

const env = process.env;
const COUNTRY = env.COUNTRY_CODE || 'EG';
const DATE_RANGE = env.DATE_RANGE || '7DAY';

/** Accounts to watch on Instagram. Comma-separated handles in IG_COMPETITORS. */
const COMPETITORS = (env.IG_COMPETITORS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** Seed terms for Google Trends rising queries. Put your compounds here. */
const SEED_TERMS = (env.TREND_SEED_TERMS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const P = paths();
const DATE = today();
const health = [];

/* ------------------------------------------------------------------ *
 * Format / challenge detection
 * ------------------------------------------------------------------ */

/**
 * Everything the collector gathered, flattened into weighted text.
 *
 * Weights matter: a #3 hashtag says more about what people are doing than a
 * #180 one, so rank is turned into weight rather than every row counting once.
 * Breadth across these sources is what separates a real format from a single
 * feed's noise.
 */
function buildCorpus({ hashtags, sounds, keywords, searchDemand, videos }) {
  const docs = [];
  const rankWeight = (rank, span) =>
    Number.isFinite(rank) ? Math.max(1, Math.round(span - (rank / 200) * (span - 1))) : 1;

  for (const h of hashtags) {
    docs.push({ text: h.rawName || h.label, source: 'hashtags', weight: rankWeight(h.rank, 10), ref: h.key });
  }
  for (const s of sounds) {
    docs.push({ text: [s.label, s.artist].filter(Boolean).join(' '), source: 'sounds', weight: rankWeight(s.rank, 6), ref: s.key });
  }
  for (const k of keywords) {
    docs.push({ text: k.label, source: 'keywords', weight: 5, ref: k.key });
  }
  for (const q of searchDemand) {
    // Google's own traffic estimate is a better weight than list position.
    const w = Number.isFinite(q.views) ? Math.min(10, Math.max(2, Math.round(Math.log10(q.views + 10) * 2.2))) : 3;
    docs.push({ text: q.label, source: 'searchDemand', weight: w, ref: q.key });
  }
  for (const v of videos) {
    docs.push({ text: [v.label, ...(v.tags || [])].join(' '), source: 'videos', weight: rankWeight(v.rank, 4), ref: v.key });
  }
  return docs;
}

/** Terms from data/seeds.json, flattened. */
async function readSeeds() {
  const seeds = await readJson(`${P.dataDir}/seeds.json`, null);
  if (!seeds) return { watch: [], vertical: {} };
  const flat = [
    ...(seeds.watch || []),
    ...Object.values(seeds.vertical || {}).flat(),
  ].filter((s) => typeof s === 'string' && s.trim());
  return { watch: [...new Set(flat)], raw: seeds };
}

/**
 * Probe seed terms through TikTok's related-hashtag recommender so a format we
 * are watching produces a cluster even before it charts.
 */
async function probeSeeds(seedTerms) {
  const token = env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = env.TIKTOK_ADVERTISER_ID;
  if (!token || !advertiserId || !seedTerms.length) {
    if (seedTerms.length) skip('tiktok-seed-probe', 'needs TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID');
    return {};
  }

  const limit = Number(env.SEED_PROBE_LIMIT || 12);
  const out = {};
  let okCount = 0;

  for (const term of seedTerms.slice(0, limit)) {
    try {
      out[term] = await tiktok.relatedHashtags({ token, advertiserId, name: term, country: COUNTRY });
      okCount += 1;
    } catch (err) {
      out[term] = [];
      // A single failed probe is not worth failing the run over — record once.
      if (okCount === 0) fail(`tiktok-seed-probe:${term}`, err);
    }
  }
  if (okCount) ok('tiktok-seed-probe', okCount, `${okCount} of ${Math.min(limit, seedTerms.length)} seed terms expanded`);
  return out;
}

/**
 * Turn detected phrases into format rows: archetype, cluster, playbook, and
 * whether a legally usable sound is already attached.
 */
function buildFormats(phrases, sections, seedTerms, probes) {
  const seedSet = new Set(seedTerms.map((s) => s.toLowerCase()));

  return phrases.map((p) => {
    const cluster = clusterFormat(p.phrase, sections);
    const related = aliasesOf(p.phrase)
      .flatMap((a) => probes[a] || probes[Object.keys(probes).find((k) => k.toLowerCase() === a) || ''] || [])
      .slice(0, 10);

    return {
      ...p,
      isSeed: aliasesOf(p.phrase).some((a) => seedSet.has(a)),
      cluster,
      relatedHashtags: related.map((r) => ({ name: `#${r.name}`, views: r.views, posts: r.posts })),
      hasClearedSound: cluster.hasClearedSound,
      playbook: playbookFor(p.archetypes, p.verticals),
      // What to do about it, in format terms rather than chart terms.
      verdict:
        p.status === 'fading' ? 'too-late'
        : p.status === 'unseen' || p.status === 'spiking' ? 'act-now'
        : p.status === 'spreading' ? 'ride-fast'
        : p.relevance >= 2 ? 'monitor'
        : 'skip',
    };
  });
}

function ok(source, count, note) {
  health.push({ source, status: 'ok', count, note: note || null, at: new Date().toISOString() });
}
function fail(source, err) {
  const msg = err instanceof Error ? err.message : String(err);
  health.push({ source, status: 'error', count: 0, note: msg, at: new Date().toISOString() });
  console.warn(`  ! ${source}: ${msg}`);
}
function skip(source, why) {
  health.push({ source, status: 'skipped', count: 0, note: why, at: new Date().toISOString() });
  console.log(`  - ${source}: skipped (${why})`);
}

/* ------------------------------------------------------------------ */

async function collectHashtags() {
  const token = env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = env.TIKTOK_ADVERTISER_ID;
  if (!token || !advertiserId) {
    skip('tiktok-hashtags', 'TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID not set');
    return [];
  }

  const seen = new Map();
  for (const category of tiktok.CATEGORIES) {
    try {
      const rows = await tiktok.trendingHashtags({
        token, advertiserId, country: COUNTRY, dateRange: DATE_RANGE, category,
      });
      for (const r of rows) {
        // Keep the best rank across category sweeps, but remember every category
        // it charted in — that is a relevance signal in itself.
        const prior = seen.get(r.key);
        if (!prior) seen.set(r.key, { ...r, categories: [category] });
        else {
          prior.categories.push(category);
          if (r.rank != null && (prior.rank == null || r.rank < prior.rank)) {
            Object.assign(prior, r, { categories: prior.categories });
          }
        }
      }
    } catch (err) {
      fail(`tiktok-hashtags:${category}`, err);
    }
  }

  const rows = [...seen.values()];
  if (rows.length) ok('tiktok-hashtags', rows.length, `${tiktok.CATEGORIES.length} categories, ${COUNTRY}`);
  return rows;
}

async function collectSounds() {
  const token = env.TIKTOK_ACCOUNT_TOKEN;
  const businessId = env.TIKTOK_BUSINESS_ID;
  if (!token || !businessId) {
    skip('tiktok-sounds', 'TIKTOK_ACCOUNT_TOKEN / TIKTOK_BUSINESS_ID not set');
    return [];
  }

  const seen = new Map();
  for (const genre of tiktok.GENRES) {
    try {
      const rows = await tiktok.trendingSounds({
        token, businessId, country: COUNTRY, dateRange: DATE_RANGE, genre,
      });
      for (const r of rows) {
        const prior = seen.get(r.key);
        if (!prior) seen.set(r.key, { ...r, genresCharted: [genre] });
        else {
          prior.genresCharted.push(genre);
          if (r.rank != null && (prior.rank == null || r.rank < prior.rank)) {
            Object.assign(prior, r, { genresCharted: prior.genresCharted });
          }
        }
      }
    } catch (err) {
      fail(`tiktok-sounds:${genre}`, err);
    }
  }

  const rows = [...seen.values()];
  if (rows.length) ok('tiktok-sounds', rows.length, `${tiktok.GENRES.length} genres, ${COUNTRY}, commercially cleared`);
  return rows;
}

async function collectKeywords() {
  const token = env.TIKTOK_ACCOUNT_TOKEN;
  const businessId = env.TIKTOK_BUSINESS_ID;
  if (!token || !businessId) {
    skip('tiktok-keywords', 'TIKTOK_ACCOUNT_TOKEN / TIKTOK_BUSINESS_ID not set');
    return [];
  }
  try {
    const rows = await tiktok.trendingKeywords({ token, businessId });
    ok('tiktok-keywords', rows.length, 'order only — no volume, no country filter');
    return rows;
  } catch (err) {
    fail('tiktok-keywords', err);
    return [];
  }
}

/**
 * Who has used it. Runs after ranking so we only spend calls on the rows that
 * actually made the shortlist.
 */
async function attachCreators(hashtags, sounds) {
  const advToken = env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = env.TIKTOK_ADVERTISER_ID;
  const acctToken = env.TIKTOK_ACCOUNT_TOKEN;
  const businessId = env.TIKTOK_BUSINESS_ID;
  const LIMIT = Number(env.CREATOR_LOOKUP_LIMIT || 20);

  if (advToken && advertiserId) {
    const targets = hashtags.filter((h) => h.id).slice(0, LIMIT);
    for (let i = 0; i < targets.length; i += 10) {
      const batch = targets.slice(i, i + 10);
      try {
        const vids = await tiktok.hashtagVideos({
          token: advToken, advertiserId, hashtagIds: batch.map((h) => h.id), country: COUNTRY,
        });
        for (const h of batch) {
          const mine = vids.filter((v) => String(v.hashtagId) === String(h.id));
          h.examples = mine.slice(0, 6).map(shapeExample);
          h.creators = dedupeCreators(mine);
        }
      } catch (err) {
        fail(`tiktok-hashtag-videos:batch${i / 10 + 1}`, err);
      }
    }
    const withCreators = targets.filter((h) => h.creators?.length).length;
    if (withCreators) ok('tiktok-hashtag-creators', withCreators, 'handles parsed from share URLs');
  }

  if (acctToken && businessId) {
    const targets = sounds.filter((s) => s.id).slice(0, LIMIT);
    for (let i = 0; i < targets.length; i += 10) {
      const batch = targets.slice(i, i + 10);
      try {
        const vids = await tiktok.soundVideos({
          token: acctToken, businessId, musicIds: batch.map((s) => s.id), country: COUNTRY,
        });
        for (const s of batch) {
          const mine = vids.filter((v) => String(v.musicId) === String(s.id));
          s.examples = mine.slice(0, 6).map(shapeExample);
          s.creators = dedupeCreators(mine);
        }
      } catch (err) {
        fail(`tiktok-sound-videos:batch${i / 10 + 1}`, err);
      }
    }
    const withCreators = targets.filter((s) => s.creators?.length).length;
    if (withCreators) ok('tiktok-sound-creators', withCreators, 'handles parsed from share URLs');
  }
}

const shapeExample = (v) => ({
  videoId: v.videoId,
  shareUrl: v.shareUrl,
  embedUrl: v.embedUrl,
  handle: v.creator?.handle || null,
  countryUsed: v.countryUsed,
});

function dedupeCreators(videos) {
  const map = new Map();
  for (const v of videos) {
    const h = v.creator?.handle;
    if (!h) continue;
    if (!map.has(h)) map.set(h, { handle: h, profileUrl: v.creator.profileUrl, uses: 0, examples: [] });
    const e = map.get(h);
    e.uses += 1;
    if (e.examples.length < 3) e.examples.push(v.shareUrl);
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses).slice(0, 8);
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\ntrend-radar · collecting for ${DATE} · country=${COUNTRY}\n`);

  const history = await readJson(P.history, {});

  // --- TikTok -------------------------------------------------------
  const [rawHashtags, rawSounds, rawKeywords] = await Promise.all([
    collectHashtags(), collectSounds(), collectKeywords(),
  ]);
  await attachCreators(rawHashtags, rawSounds);

  // --- Free Egyptian signals ---------------------------------------
  let gtrendRows = [];
  try {
    gtrendRows = await gtrends.trendingNow({ geo: COUNTRY });
    ok('google-trends', gtrendRows.length, `Trending Now RSS, geo=${COUNTRY}`);
  } catch (err) { fail('google-trends', err); }

  let risingRows = [];
  if (env.GOOGLE_TRENDS_API_KEY && SEED_TERMS.length) {
    try {
      risingRows = await gtrends.risingQueries({
        apiKey: env.GOOGLE_TRENDS_API_KEY, terms: SEED_TERMS, geo: COUNTRY,
      });
      ok('google-trends-api', risingRows.length, `${SEED_TERMS.length} seed terms`);
    } catch (err) { fail('google-trends-api', err); }
  } else {
    skip('google-trends-api', 'GOOGLE_TRENDS_API_KEY or TREND_SEED_TERMS not set');
  }

  let appleChart = { rows: [], updated: null };
  try {
    appleChart = await apple.mostPlayed({ country: COUNTRY.toLowerCase(), limit: 50 });
    ok('apple-music', appleChart.rows.length, `updated ${appleChart.updated || 'unknown'}`);
  } catch (err) { fail('apple-music', err); }

  let ytRows = [];
  if (env.YOUTUBE_API_KEY) {
    try {
      ytRows = await youtube.mostPopular({ apiKey: env.YOUTUBE_API_KEY, region: COUNTRY });
      ok('youtube', ytRows.length, '1 quota unit — effectively free');
    } catch (err) { fail('youtube', err); }
  } else {
    skip('youtube', 'YOUTUBE_API_KEY not set');
  }

  // --- Instagram ----------------------------------------------------
  let igAudio = [];
  if (env.IG_ACCESS_TOKEN && env.IG_USER_ID) {
    // Both types are tried independently: a business account is commonly cut off
    // from the licensed music catalogue while original_sound still returns data,
    // so one empty type is not a reason to report the whole source as broken.
    for (const type of ['music', 'original_sound']) {
      try {
        const rows = await instagram.trendingAudio({
          token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, audioType: type,
        });
        igAudio.push(...rows);
        ok(`instagram-audio:${type}`, rows.length, 'names only — Meta publishes no metrics, rank, or country filter');
      } catch (err) {
        // An empty-but-successful call is a configuration fact, not a failure.
        if (err.emptyOk) skip(`instagram-audio:${type}`, err.message);
        else fail(`instagram-audio:${type}`, err);
      }
    }
    if (igAudio.length) {
      ok('instagram-audio', igAudio.length, `${igAudio.length} sounds across both types`);
    }
  } else {
    skip('instagram-audio',
      'IG_ACCESS_TOKEN / IG_USER_ID not set. Note: this needs a FACEBOOK Login token — ' +
      'Instagram Login does not work on /ig_audio.');
  }

  let igPanel = [];
  if (env.IG_ACCESS_TOKEN && env.IG_USER_ID && COMPETITORS.length) {
    try {
      igPanel = await instagram.competitorPanel({
        token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, handles: COMPETITORS,
      });
      ok('instagram-panel', igPanel.filter((r) => !r.error).length, `${COMPETITORS.length} accounts`);
    } catch (err) { fail('instagram-panel', err); }
  } else {
    skip('instagram-panel', 'IG_COMPETITORS not set');
  }

  // --- Momentum -----------------------------------------------------
  const seedHistory = seedFromReported(history, { sounds: rawSounds, hashtags: rawHashtags });

  let sounds = enrich(rawSounds, sectionHistory(seedHistory, 'sounds'), DATE, { commercialSafe: true });
  const hashtags = enrich(rawHashtags, sectionHistory(seedHistory, 'hashtags'), DATE);
  const keywords = enrich(rawKeywords, sectionHistory(seedHistory, 'keywords'), DATE);
  const searchDemand = enrich(gtrendRows, sectionHistory(seedHistory, 'searchDemand'), DATE);
  const rising = enrich(risingRows, sectionHistory(seedHistory, 'rising'), DATE);
  const videos = enrich(ytRows, sectionHistory(seedHistory, 'videos'), DATE);
  const audioCharts = enrich(appleChart.rows, sectionHistory(seedHistory, 'audioCharts'), DATE);
  const igSounds = enrich(igAudio, sectionHistory(seedHistory, 'igSounds'), DATE);

  // Cross-source confirmation for TikTok sounds against the Egyptian audio chart.
  sounds = markCrossover(sounds, [{ source: 'apple-music-eg', rows: appleChart.rows }]);

  const dropouts = {
    sounds: findDropouts(rawSounds, sectionHistory(seedHistory, 'sounds'), DATE),
    hashtags: findDropouts(rawHashtags, sectionHistory(seedHistory, 'hashtags'), DATE),
  };

  // --- Formats and challenges --------------------------------------
  // Runs on text already gathered above, so it costs nothing extra except the
  // optional seed probes.
  let formats = [];
  try {
    const { watch: seedTerms } = await readSeeds();
    const probes = await probeSeeds(seedTerms);

    const corpusHistory = await readJson(P.corpus, {});
    const table = countCorpus(
      buildCorpus({ hashtags, sounds, keywords, searchDemand: [...searchDemand, ...rising], videos })
    );
    const phrases = emergingPhrases(table, corpusHistory, DATE, {
      minWeight: Number(env.FORMAT_MIN_WEIGHT || 3),
      limit: Number(env.FORMAT_LIMIT || 60),
    });

    // Collapse the many spellings of one trend into a single row.
    formats = dedupeFormats(
      buildFormats(
        phrases,
        { hashtags, sounds, keywords, searchDemand: [...searchDemand, ...rising] },
        seedTerms,
        probes
      )
    );

    // Seeds you are explicitly watching stay visible even on a quiet day, so a
    // term you added does not silently vanish when it dips below the threshold.
    const present = new Set(formats.map((f) => f.phrase));
    for (const term of seedTerms) {
      if (present.has(normalizeSeed(term))) continue;
      if (formats.some((f) => aliasesOf(f.phrase).includes(normalizeSeed(term)))) continue;
      const cluster = clusterFormat(term, { hashtags, sounds, keywords, searchDemand });
      const hasAny = cluster.hashtags.length || cluster.sounds.length || cluster.queries.length;
      if (!hasAny) continue;
      const arch = classifyFormat(term);
      formats.push({
        key: `fmt:${normalizeSeed(term)}`,
        label: term, phrase: normalizeSeed(term),
        weight: 0, lift: null, breadth: 0, sources: [],
        daysSeen: null, isNew: false, isSeed: true,
        archetypes: arch, archetypeLabels: arch.map((a) => a),
        relevance: 0, verticals: [], score: 0,
        status: 'watching', verdict: 'monitor',
        cluster, relatedHashtags: (probes[term] || []).map((r) => ({ name: `#${r.name}`, views: r.views })),
        hasClearedSound: cluster.hasClearedSound,
        playbook: playbookFor(arch, []),
        examples: [],
        isRTL: /[؀-ۿ]/.test(term),
      });
    }

    await writeJson(P.corpus, mergeCorpusHistory(corpusHistory, table, DATE));
    ok('format-detection', formats.length, `${phrases.length} spiking phrases from ${Object.keys(table).length} n-grams`);
  } catch (err) {
    fail('format-detection', err);
  }

  const sections = { formats, sounds, hashtags, keywords, searchDemand, rising, videos, audioCharts, igSounds };

  // --- Persist ------------------------------------------------------
  const dates = await snapshotDates(P.snapshotsDir);
  const payload = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    country: COUNTRY,
    dateRange: DATE_RANGE,
    sample: false,
    daysOfHistory: new Set([...dates, DATE]).size,
    summary: summarise(sections, dropouts),
    health,
    sections,
    dropouts,
    competitorPanel: igPanel,
    notes: {
      hashtagVideoGeo:
        'TikTok limits hashtag video lookups to the hashtag\'s own top-5 countries, so example videos may come from another market. Each example records countryUsed.',
      instagram:
        'Instagram publishes no trending-audio metrics and no country filter, and media objects carry no audio field. IG rows are unranked names; use the manual log for Instagram.',
      keywords:
        'TikTok trending search keywords have no volume and no country parameter. Order only.',
    },
  };

  await writeJson(P.latest, payload);
  await writeJson(`${P.snapshotsDir}/${DATE}.json`, payload);
  await writeJson(P.history, mergeHistory(seedHistory, sections, DATE));

  const s = payload.summary;
  console.log(
    `\ndone · ${s.tracked} tracked · ${s.newToday} new · ${s.rising} rising · ` +
      `${s.actNow} act-now · ${s.crossovers} crossovers · day ${payload.daysOfHistory} of history\n`
  );
  if (payload.daysOfHistory < 3) {
    console.log('note: day-over-day comparison needs 2+ snapshots. Deltas fill in tomorrow.\n');
  }
}

/**
 * TikTok hands back up to 30 days of its own daily ranking in `trending_history`.
 * Fold that into our history so momentum works on day one instead of after a
 * fortnight of waiting. Our own snapshots always win on conflict.
 */
function seedFromReported(history, sections) {
  const next = structuredClone(history);
  for (const [section, rows] of Object.entries(sections)) {
    next[section] = next[section] || {};
    for (const row of rows) {
      if (!row?.key || !row.reportedHistory?.length) continue;
      const existing = next[section][row.key] || [];
      const haveDates = new Set(existing.map((p) => p.date));
      const merged = [...existing];
      for (const p of row.reportedHistory) {
        if (!p.date || haveDates.has(p.date)) continue;
        merged.push({ date: p.date, rank: p.rank ?? null, views: p.views ?? null, posts: null });
      }
      merged.sort((a, b) => (a.date < b.date ? -1 : 1));
      merged.label = row.label;
      next[section][row.key] = merged;
    }
  }
  return next;
}

/** Seed terms are matched against normalised phrases, so normalise them the same way. */
function normalizeSeed(s) {
  return String(s || '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function summarise(sections, dropouts) {
  const all = [...sections.sounds, ...sections.hashtags];
  const fmts = sections.formats || [];
  const count = (fn) => all.filter(fn).length;
  return {
    formats: fmts.length,
    formatsSpiking: fmts.filter((f) => f.status === 'spiking' || f.status === 'unseen').length,
    formatsActionable: fmts.filter((f) => f.verdict === 'act-now' && (f.relevance >= 2 || f.archetypes.length)).length,
    tracked: Object.values(sections).reduce((n, r) => n + r.length, 0),
    sounds: sections.sounds.length,
    hashtags: sections.hashtags.length,
    newToday: count((r) => r.isNew),
    rising: count((r) => r.stage === 'rising' || r.stage === 'emerging'),
    actNow: count((r) => r.verdict === 'act-now'),
    tooLate: count((r) => r.verdict === 'too-late'),
    crossovers: sections.sounds.filter((r) => r.crossover).length,
    verticalFit: count((r) => r.relevance >= 2),
    commercialSafeSounds: sections.sounds.filter((r) => r.commercialSafe === true).length,
    droppedOut: dropouts.sounds.length + dropouts.hashtags.length,
  };
}

main().catch((err) => {
  console.error('\ncollector failed:', err);
  process.exit(1);
});
