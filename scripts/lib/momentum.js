/**
 * Momentum engine.
 *
 * Turns a stack of daily snapshots into the only questions that matter about a
 * trend: is it going up, how fast, how long has it been going, is it saturated,
 * and is it already too late to post.
 *
 * Rank convention throughout: LOWER number = better position.
 * So a positive `rankDelta` means the item IMPROVED (moved up the chart).
 */

/* ------------------------------------------------------------------ *
 * Vertical relevance
 * ------------------------------------------------------------------ */

// Matched case-insensitively against hashtag names, sound titles and keywords.
// Arabic terms first because that is what actually trends in Egypt.
export const VERTICALS = {
  realestate: {
    label: 'Real estate',
    terms: [
      // Property nouns — stems, so شقتي / شقته / شقق all match
      'عقار', 'شقة', 'شقق', 'شقت', 'فيلا', 'فيلات', 'كمبوند', 'كومباوند',
      'منزل', 'وحدة سكنية', 'دوبلكس', 'روف',
      // Money and process
      'تشطيب', 'ديكور', 'اثاث', 'استثمار', 'تقسيط', 'مقدم', 'تمليك', 'ايجار',
      // Egyptian submarkets
      'التجمع', 'الشيخ زايد', 'العاصمة الادارية', 'الساحل الشمالي',
      'العين السخنة', 'مدينتي', 'الشروق', 'اكتوبر', 'المستقبل سيتي',
      // Formats that carry real-estate content
      'قبل وبعد', 'جولة في', 'ريفيو كمبوند', 'روم تور', 'هوم تور',
      'realestate', 'real estate', 'property', 'apartment', 'villa', 'compound',
      'interior', 'interiordesign', 'homedecor', 'homedesign', 'newcairo',
      'newcapital', 'northcoast', 'mortgage', 'investment', 'housetour',
      'roomtour', 'hometour', 'apartmenttour', 'movingin', 'newhome', 'firsthome',
      'beforeandafter', 'homemakeover', 'renovation', 'moodboard',
    ],
  },
  automotive: {
    label: 'Automotive',
    terms: [
      'عربية', 'عربيات', 'عربيت', 'سيار', 'موتور', 'محرك', 'سباق', 'سباقات',
      'دريفت', 'فورمولا', 'راليات', 'رالي', 'تجربة قيادة', 'كشخة',
      'car', 'cars', 'carsoftiktok', 'automotive', 'auto', 'engine', 'motorsport',
      'formula1', 'f1', 'wrc', 'wec', 'lemans', 'rally', 'drift', 'jdm',
      'supercar', 'hypercar', 'carreview', 'carvlog', 'racing', 'grandprix',
      'pitstop', 'horsepower',
    ],
  },
};

/**
 * Normalise Arabic and Latin text for matching.
 *
 * Hashtags arrive as `العاصمة_الادارية` while the term list reads
 * `العاصمة الادارية`, and Arabic is written with interchangeable letter forms
 * (أ إ آ ا / ي ى / ة ه) plus optional diacritics. Without folding these, roughly
 * half of the Egyptian hashtags score zero relevance — which is the difference
 * between a useful filter and a decorative one.
 */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')   // harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripped = (s) => normalizeText(s).replace(/\s+/g, '');

/**
 * Score how relevant an item is to the verticals we publish in.
 * 0 = generic, 2 = direct match, 3 = match in more than one vertical.
 */
export function scoreRelevance(text) {
  const hay = normalizeText(text);
  const hayTight = stripped(text);
  const hits = [];
  const matched = [];

  for (const [key, v] of Object.entries(VERTICALS)) {
    for (const term of v.terms) {
      const t = normalizeText(term);
      const tTight = stripped(term);
      if ((t && hay.includes(t)) || (tTight.length >= 4 && hayTight.includes(tTight))) {
        hits.push(key);
        matched.push(term);
        break;
      }
    }
  }
  return { score: Math.min(3, hits.length * 2), verticals: hits, matchedTerms: matched };
}

/* ------------------------------------------------------------------ *
 * Series helpers
 * ------------------------------------------------------------------ */

const daysBetween = (a, b) =>
  Math.round((new Date(b) - new Date(a)) / 86400000);

/** Mean daily rank improvement across the last n points of a series. */
function meanVelocity(series, n) {
  const pts = series.filter((p) => Number.isFinite(p.rank)).slice(-n);
  if (pts.length < 2) return 0;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const span = Math.max(1, daysBetween(first.date, last.date));
  return round((first.rank - last.rank) / span, 2);
}

const round = (n, dp = 2) =>
  Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null;

const pct = (curr, prev) =>
  Number.isFinite(curr) && Number.isFinite(prev) && prev > 0
    ? round(((curr - prev) / prev) * 100, 1)
    : null;

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Where in its life is this trend?
 *
 * emerging  — brand new on the chart, still climbing from nowhere
 * rising    — improving materially week over week
 * peaking   — near the top and no longer moving; the window is closing
 * plateau   — flat, mid-chart; neither story nor urgency
 * declining — losing ground week over week
 * expired   — dropped off the chart entirely
 */
export function classifyStage({
  daysTracked,
  rank,
  velocity3d,
  rankDelta7d,
  daysSinceSeen,
}) {
  if (daysSinceSeen >= 3) return 'expired';
  if (daysTracked <= 2) return 'emerging';
  if (rankDelta7d >= 12) return 'rising';
  if (rankDelta7d <= -12) return 'declining';
  if (rank <= 12 && Math.abs(velocity3d) < 2) return 'peaking';
  if (velocity3d >= 2) return 'rising';
  if (velocity3d <= -2) return 'declining';
  return 'plateau';
}

/**
 * What to do about it. Deliberately blunt — a dashboard that says
 * "monitor" about everything is a dashboard nobody opens twice.
 */
export function decideVerdict({ stage, rank, saturation, commercialSafe, relevance }) {
  if (commercialSafe === false) return 'blocked';
  if (stage === 'expired' || stage === 'declining') return 'too-late';
  if (stage === 'emerging') return 'act-now';
  if (stage === 'rising') {
    if (saturation != null && saturation > 0.75) return 'ride-fast';
    return rank <= 15 ? 'ride-fast' : 'act-now';
  }
  if (stage === 'peaking') return 'ride-fast';
  return relevance >= 2 ? 'monitor' : 'skip';
}

/**
 * Rough remaining runway in days. Honest about being a heuristic:
 * short-form sound cycles in this market run ~10–18 days from chart entry,
 * so runway is that budget minus what has already been spent, adjusted
 * for how saturated the sound already is.
 */
export function estimateRunway({ daysTracked, stage, saturation }) {
  if (stage === 'expired') return 0;
  const budget = 16;
  const spent = Math.min(budget, daysTracked);
  let left = budget - spent;
  if (stage === 'declining') left = Math.min(left, 3);
  if (stage === 'peaking') left = Math.min(left, 6);
  if (saturation != null && saturation > 0.75) left = Math.round(left * 0.6);
  return Math.max(0, left);
}

/* ------------------------------------------------------------------ *
 * Main enrichment
 * ------------------------------------------------------------------ */

/**
 * @param {Array}  items    today's rows: { key, label, rank, views, posts, ... }
 * @param {Object} history  { [key]: [{ date, rank, views, posts }] }  oldest → newest
 * @param {String} today    ISO date (YYYY-MM-DD)
 * @param {Object} opts     { commercialSafe?: boolean }  applied to every row
 */
export function enrich(items, history, today, opts = {}) {
  return items.map((item) => {
    const series = (history[item.key] || []).slice();
    const prior = series.filter((p) => p.date < today);
    const prev = prior[prior.length - 1] || null;
    // The 7-day comparison needs a point that is actually old. On a 2-day-old
    // item the nearest candidate IS yesterday, and reporting that as "7 days ago"
    // is worse than reporting nothing.
    const prev7 =
      prior.find((p) => {
        const age = daysBetween(p.date, today);
        return age >= 4 && age <= 9;
      }) || null;

    // Append today so velocity includes the newest point.
    const full = [...prior, { date: today, rank: item.rank, views: item.views, posts: item.posts }];

    const firstSeen = full[0]?.date || today;
    const daysTracked = Math.max(1, daysBetween(firstSeen, today) + 1);
    const daysSinceSeen = 0; // present in today's payload by definition

    const rankDelta = prev ? prev.rank - item.rank : null;
    const rankDelta7d = prev7 ? prev7.rank - item.rank : null;
    const velocity3d = meanVelocity(full, 4);
    // Acceleration compares the last three days against the three before them,
    // so it is meaningless until there are ~6 points. Report null rather than a
    // number that just restates velocity.
    const priorRanked = prior.filter((p) => Number.isFinite(p.rank));
    const acceleration =
      priorRanked.length >= 4 ? round(velocity3d - meanVelocity(priorRanked, 4), 2) : null;

    const ranks = full.map((p) => p.rank).filter(Number.isFinite);
    const peakRank = ranks.length ? Math.min(...ranks) : item.rank;
    const peakPoint = [...full].reverse().find((p) => p.rank === peakRank);
    const daysSincePeak = peakPoint ? daysBetween(peakPoint.date, today) : 0;

    const viewsDelta =
      prev && Number.isFinite(item.views) && Number.isFinite(prev.views)
        ? item.views - prev.views
        : null;
    const postsDelta =
      prev && Number.isFinite(item.posts) && Number.isFinite(prev.posts)
        ? item.posts - prev.posts
        : null;

    // Saturation: creators piling in faster than audience is showing up.
    // 0 = healthy (views growing faster than posts), 1 = crowded.
    let saturation = null;
    if (Number.isFinite(viewsDelta) && Number.isFinite(postsDelta) && postsDelta > 0) {
      const viewsPerNewPost = viewsDelta / postsDelta;
      const baseline = Number.isFinite(item.views) && Number.isFinite(item.posts) && item.posts > 0
        ? item.views / item.posts
        : null;
      if (baseline && baseline > 0) {
        saturation = round(clamp(1 - viewsPerNewPost / baseline, 0, 1), 2);
      }
    }

    const rel = scoreRelevance(
      [item.label, item.rawName, item.artist, item.genre, ...(item.tags || [])]
        .filter(Boolean)
        .join(' ')
    );
    const commercialSafe = opts.commercialSafe ?? item.commercialSafe ?? null;

    const stage = classifyStage({
      daysTracked,
      rank: item.rank,
      velocity3d,
      // With no genuine 7-day point, fall back to velocity so a young item is
      // still classified by its own movement rather than defaulting to flat.
      rankDelta7d: rankDelta7d ?? velocity3d * 3,
      daysSinceSeen,
    });

    const verdict = decideVerdict({
      stage,
      rank: item.rank,
      saturation,
      commercialSafe,
      relevance: rel.score,
    });

    const alerts = [];
    if (daysTracked <= 1) alerts.push('new-entry');
    if (rankDelta != null && rankDelta >= 10) alerts.push(`jumped-${rankDelta}-places`);
    if (item.rank <= 20 && daysTracked <= 3) alerts.push('fast-entry-top-20');
    if (acceleration != null && acceleration >= 3) alerts.push('accelerating');
    if (saturation != null && saturation > 0.8) alerts.push('saturated');
    if (rel.score >= 2) alerts.push(`vertical-fit:${rel.verticals.join('+')}`);

    return {
      ...item,
      firstSeen,
      lastSeen: today,
      daysTracked,
      rankPrev: prev ? prev.rank : null,
      rankDelta,
      rank7dAgo: prev7 ? prev7.rank : null,
      rankDelta7d,
      velocity3d,
      acceleration,
      peakRank,
      daysSincePeak,
      viewsDelta,
      viewsGrowthPct: prev ? pct(item.views, prev.views) : null,
      postsDelta,
      postsGrowthPct: prev ? pct(item.posts, prev.posts) : null,
      saturation,
      relevance: rel.score,
      verticals: rel.verticals,
      commercialSafe,
      stage,
      verdict,
      runwayDays: estimateRunway({ daysTracked, stage, saturation }),
      isNew: daysTracked <= 1,
      alerts,
      sparkline: full.slice(-14).map((p) => ({ date: p.date, rank: p.rank })),
    };
  });
}

/**
 * Items that were on yesterday's chart and are gone from today's.
 * Falling off is a signal in its own right — it tells you the window shut.
 */
export function findDropouts(items, history, today) {
  const present = new Set(items.map((i) => i.key));
  const out = [];
  for (const [key, series] of Object.entries(history)) {
    if (present.has(key)) continue;
    const last = series[series.length - 1];
    if (!last) continue;
    const gap = daysBetween(last.date, today);
    if (gap >= 1 && gap <= 4) {
      out.push({
        key,
        label: series.label || key,
        lastRank: last.rank,
        lastSeen: last.date,
        daysGone: gap,
        stage: 'expired',
        verdict: 'too-late',
      });
    }
  }
  return out.sort((a, b) => a.lastRank - b.lastRank).slice(0, 25);
}

/**
 * Cross-source confirmation. A sound that shows up on the TikTok CML chart AND
 * in Apple Music Egypt or Shazam Egypt has independent demand behind it, which
 * historically means a longer runway than a TikTok-only spike.
 */
export function markCrossover(sounds, charts) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const chartIndex = new Map();
  for (const c of charts) {
    for (const row of c.rows || []) {
      const k = norm(row.title);
      if (!k) continue;
      if (!chartIndex.has(k)) chartIndex.set(k, []);
      chartIndex.get(k).push({ source: c.source, rank: row.rank, artist: row.artist });
    }
  }

  return sounds.map((s) => {
    const k = norm(s.label);
    const artistK = norm(s.artist);
    let matches = chartIndex.get(k) || [];
    if (!matches.length && artistK) {
      // Fall back to artist-level confirmation: weaker, so label it as such.
      for (const [ck, entries] of chartIndex) {
        if (entries.some((e) => norm(e.artist) === artistK) && ck.includes(k.slice(0, 8))) {
          matches = entries;
          break;
        }
      }
    }
    return {
      ...s,
      crossover: matches.length > 0,
      crossoverSources: matches.map((m) => m.source),
      alerts: matches.length
        ? [...(s.alerts || []), `crossover:${matches.map((m) => m.source).join('+')}`]
        : s.alerts,
    };
  });
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
