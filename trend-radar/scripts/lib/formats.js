/**
 * Format and challenge detection.
 *
 * Sounds and hashtags are things. A *format* is an idea — "the 80s challenge",
 * "before and after", "room tour" — and it shows up as a hashtag, a sound, an
 * effect and a caption pattern all at once. By the time #80schallenge is in a
 * top-200 hashtag list you are late, so this module does not wait for that.
 *
 * Three parts:
 *   1. ARCHETYPES     — classify any phrase into a repeatable format shape
 *   2. emergingPhrases — n-gram spike detection across every text we collect
 *   3. clusterFormat   — pull the sibling hashtags and sounds around a candidate
 *
 * Everything here runs on text the collector already gathers. No extra API cost.
 */

import { normalizeText, scoreRelevance } from './momentum.js';

/* ------------------------------------------------------------------ *
 * 1. Format archetypes
 *
 * `terms` are matched against normalised text (Arabic letter forms folded,
 * underscores treated as spaces — see normalizeText). `playbook` is the whole
 * point of the taxonomy: knowing "#80s is spiking" is trivia until you know
 * what to shoot on Sunday.
 * ------------------------------------------------------------------ */

export const ARCHETYPES = {
  challenge: {
    label: 'Challenge',
    terms: ['challenge', 'challeng', 'تحدي', 'تحديات', 'تشالنج'],
    playbook: {
      realestate: 'Give it a rule anyone can copy in one take — "show your flat in 3 seconds", "guess the price".',
      automotive: 'Make it a test with a pass/fail — "name the engine from the sound", "0–100 blindfold guess".',
    },
  },
  era: {
    label: 'Era / decade',
    terms: [
      '80s', '90s', '70s', '2000s', 'y2k', 'retro', 'vintage', 'nostalgia',
      'الثمانينات', 'التسعينات', 'الالفينات', 'زمن الطيبين', 'قديم', 'ذكريات', 'ريترو',
    ],
    playbook: {
      realestate: 'Then-and-now on a neighbourhood: old Cairo footage against the same street today, or 80s-styled apartment staging.',
      automotive: 'Era-matched cars — a 1985 model shot on period-graded film, engine sound over the era track.',
    },
  },
  transition: {
    label: 'Transition',
    terms: ['transition', 'transformation', 'glowup', 'glow up', 'تحول', 'انتقال', 'ترانزيشن'],
    playbook: {
      realestate: 'Hard cut on the beat from bare concrete to finished room, same camera position both times.',
      automotive: 'Dirty-to-detailed, or stock-to-modified, cut on the sound hit.',
    },
  },
  beforeafter: {
    label: 'Before / after',
    // Note: "تشطيب" is deliberately NOT here. It is a topic (fit-out), not a
    // format, and putting it here made every finishing hashtag look like a
    // before/after. It lives in the real-estate vertical list instead.
    terms: [
      'beforeandafter', 'before after', 'before and after', 'makeover', 'renovation',
      'قبل وبعد', 'قبل و بعد', 'تجديد',
    ],
    playbook: {
      realestate: 'The single highest-fit format you have. Shoot every handover in the same frame twice, months apart.',
      automotive: 'Restoration or detailing, with a locked-off tripod shot so the reveal lands.',
    },
  },
  pov: {
    label: 'POV',
    terms: ['pov', 'point of view', 'لو كنت', 'تخيل', 'من عيون'],
    playbook: {
      realestate: '"POV: you just got the keys" — shoot handheld at eye level walking through the door.',
      automotive: '"POV: first drive at 6am" — dash-level, no narration, engine audio only.',
    },
  },
  grwm: {
    label: 'Get ready with me',
    terms: ['grwm', 'getreadywithme', 'get ready with me', 'استعدي معايا', 'روتين', 'routine'],
    playbook: {
      realestate: '"Get ready to view 3 compounds with me" — the day of a viewing, in real time.',
      automotive: '"Get ready for track day with me" — prep, tyre pressures, kit, in one take.',
    },
  },
  tour: {
    label: 'Tour / walkthrough',
    terms: [
      'roomtour', 'hometour', 'housetour', 'apartmenttour', 'officetour', 'tour',
      'جولة', 'روم تور', 'هوم تور', 'جوله',
    ],
    playbook: {
      realestate: 'Your bread and butter. One continuous walk, no cuts, sound on, price on screen at second one.',
      automotive: 'Interior walkaround with the door shut and engine off, so the cabin sounds real.',
    },
  },
  tierlist: {
    label: 'Ranking / tier list',
    terms: ['tierlist', 'tier list', 'ranking', 'ranked', 'top5', 'top10', 'ترتيب', 'افضل', 'ترتيبي'],
    playbook: {
      realestate: 'Rank compounds on one honest axis — commute, service charge, delivery record. Commit to an opinion.',
      automotive: 'Tier the same segment by one criterion, not vibes: parts availability, resale, running cost.',
    },
  },
  versus: {
    label: 'Versus',
    terms: [' vs ', 'versus', 'ضد', 'مقارنة', 'comparison', 'ولا'],
    playbook: {
      realestate: 'Two units at the same price, side by side, same checklist. Let the viewer argue in the comments.',
      automotive: 'Same budget, two cars, five identical tests. Never declare a winner in the caption.',
    },
  },
  expectation: {
    label: 'Expectation vs reality',
    terms: ['expectation vs reality', 'expectation', 'توقع', 'الحقيقة', 'التوقع'],
    playbook: {
      realestate: 'Render versus delivered unit. Risky and honest — the most shared thing this industry can post.',
      automotive: 'Brochure figures against your own measured numbers.',
    },
  },
  dayinlife: {
    label: 'Day in the life',
    terms: ['dayinmylife', 'day in my life', 'يوم في حياة', 'روتيني اليومي', 'يوم من حياتي'],
    playbook: {
      realestate: '"A day as a property consultant in New Cairo" — the job, not the sales pitch.',
      automotive: 'A day with one car as a daily driver, including the annoying parts.',
    },
  },
  tutorial: {
    label: 'How-to / hack',
    terms: ['tutorial', 'howto', 'how to', 'hack', 'hacks', 'tips', 'ازاي', 'طريقة', 'نصائح', 'ازای'],
    playbook: {
      realestate: '"How to read a contract clause", "how to check a delivery date". Teach one thing, 20 seconds.',
      automotive: 'One maintenance job, shot close, no music, real time.',
    },
  },
  duetbait: {
    label: 'Duet / stitch bait',
    terms: ['duet', 'stitch', 'ديو', 'رد على', 'reply to'],
    playbook: {
      realestate: 'Ask one divisive question to camera and leave silence for the stitch — "would you buy this at this price?"',
      automotive: 'Post a wrong take on purpose and invite corrections. Comments do the reach.',
    },
  },
  storytime: {
    label: 'Storytime',
    terms: ['storytime', 'story time', 'حكاية', 'قصة', 'حصل معايا'],
    playbook: {
      realestate: 'The deal that fell apart, and what you learned. Nobody in this market posts these.',
      automotive: 'The purchase you regret. Credibility compounds.',
    },
  },
  reveal: {
    label: 'Reveal / unboxing',
    terms: ['reveal', 'revealed', 'unboxing', 'كشف', 'مفاجأة', 'فتح'],
    playbook: {
      realestate: 'Key handover, filmed from the buyer\'s side, no branding until the last second.',
      automotive: 'Delivery day, plates on, first start.',
    },
  },
  check: {
    label: 'Check / rate mine',
    terms: ['fitcheck', 'outfitcheck', 'roomcheck', 'ratemy', 'rate my', 'قيم', 'check'],
    playbook: {
      realestate: '"Rate my balcony" as a UGC prompt — invite followers to send theirs.',
      automotive: '"Rate my setup" with a fixed template so submissions are comparable.',
    },
  },
  aesthetic: {
    label: 'Aesthetic / -core',
    terms: ['core', 'aesthetic', 'moodboard', 'استايل', 'ستايل'],
    playbook: {
      realestate: 'Name a look and own it — a "quiet luxury" or "Sahel-core" interior series.',
      automotive: 'Build an aesthetic lane (JDM, restomod) and shoot everything in that grade.',
    },
  },
  satisfying: {
    label: 'Satisfying / ASMR',
    terms: ['satisfying', 'oddlysatisfying', 'asmr', 'مريح'],
    playbook: {
      realestate: 'Tile laying, paint rolling, key turning. No voice, no music, mic close.',
      automotive: 'Foam, water, panel wipe. Sound is the whole product.',
    },
  },
  trendgeneric: {
    label: 'Named trend',
    terms: ['trend', 'trending', 'تريند', 'ترند'],
    playbook: {
      realestate: 'A bare "trend" tag means the format is still unnamed — check the sound and the top videos before copying.',
      automotive: 'Same: identify the underlying mechanic before you shoot, or you copy the surface and miss the joke.',
    },
  },
};

/** Tag a phrase with every format archetype it matches. */
export function classifyFormat(text) {
  const hay = ` ${normalizeText(text)} `;
  const tight = hay.replace(/\s+/g, '');
  const hits = [];

  for (const [key, a] of Object.entries(ARCHETYPES)) {
    for (const term of a.terms) {
      const t = normalizeText(term);
      const tt = t.replace(/\s+/g, '');
      // " vs " style terms carry their own padding and must match with spaces.
      const spaced = /^\s|\s$/.test(term);
      const hit = spaced
        ? hay.includes(` ${t.trim()} `)
        : hay.includes(t) || (tt.length >= 4 && tight.includes(tt));
      if (hit) { hits.push(key); break; }
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * 2. Emerging phrases
 * ------------------------------------------------------------------ */

const STOP = new Set([
  // English
  'the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'are', 'was', 'from',
  'have', 'has', 'not', 'but', 'all', 'out', 'get', 'got', 'can', 'will', 'just',
  'its', 'his', 'her', 'they', 'them', 'their', 'been', 'were', 'she', 'him',
  'video', 'videos', 'tiktok', 'reels', 'shorts', 'official', 'full', 'watch',
  // Arabic
  'في', 'من', 'على', 'عن', 'الى', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي',
  'كل', 'ما', 'لا', 'ان', 'او', 'يا', 'هو', 'هي', 'كان', 'كانت', 'اللي', 'دي',
  'ده', 'يعني', 'علي', 'انا', 'احنا', 'فيديو',
  // Place and platform names. These spike constantly in an Egypt-filtered feed
  // and are never themselves a format — "egypt" is not something you can shoot.
  'egypt', 'egyptian', 'masr', 'مصر', 'مصري', 'cairo', 'القاهره', 'الاسكندريه',
  'arab', 'arabic', 'عربي', 'عربى', 'اغنيه', 'اغنية', 'موسيقى', 'موسيقي',
  'music', 'song', 'songs', 'audio', 'sound', 'remix', 'edit', 'edits',
  'new', 'جديد', 'best', 'top', 'viral', 'فيرال',
]);

/**
 * The same format is written two ways in this market — "80s" and "الثمانينات"
 * are one trend, and clustering has to know that or it splits every Egyptian
 * format in half. Only the pairs that actually recur are listed.
 */
export const PHRASE_ALIASES = [
  ['80s', 'الثمانينات', 'ثمانينات'],
  ['90s', 'التسعينات', 'تسعينات'],
  ['2000s', 'الالفينات', 'الفينات', 'y2k'],
  ['challenge', 'تحدي', 'تشالنج'],
  ['before after', 'قبل وبعد', 'beforeandafter'],
  ['tour', 'جولة', 'روم تور'],
  ['pov', 'لو كنت'],
  ['routine', 'روتين', 'grwm'],
  ['transition', 'تحول', 'ترانزيشن'],
  ['tutorial', 'ازاي', 'طريقة'],
  ['vs', 'ضد', 'مقارنة'],
  ['retro', 'ريترو', 'قديم'],
];

/** Every way a phrase might be written, for cross-script matching. */
export function aliasesOf(phrase) {
  const p = normalizeText(phrase);
  const set = new Set([p]);
  for (const group of PHRASE_ALIASES) {
    const normed = group.map((g) => normalizeText(g));
    if (normed.some((g) => p === g || p.includes(g))) normed.forEach((g) => set.add(g));
  }
  return [...set];
}

/**
 * Split concatenated hashtags where the seam is guessable.
 * "80schallenge" -> ["80s", "challenge"]; "roomtourmasr" -> ["room","tour","masr"].
 * Deliberately conservative: only splits on digit/letter seams and a list of
 * suffixes that actually appear in format names.
 */
const SEAMS = [
  'challenge', 'trend', 'tour', 'check', 'core', 'tok', 'hack', 'hacks', 'tips',
  'transition', 'transformation', 'reveal', 'unboxing', 'routine', 'review',
  'masr', 'egypt', 'cairo', 'edition', 'series', 'vlog', 'asmr', 'life',
];

export function splitConcat(token) {
  let parts = [token];
  // digit/letter seams: 80schallenge -> 80s | challenge
  parts = parts.flatMap((p) =>
    p.replace(/(\d+[a-z]?)(?=[a-z]{3,})/g, '$1 ').split(/\s+/).filter(Boolean)
  );
  // known suffixes
  parts = parts.flatMap((p) => {
    for (const s of SEAMS) {
      if (p.length > s.length + 2 && p.endsWith(s)) return [p.slice(0, -s.length), s];
      if (p.length > s.length + 2 && p.startsWith(s)) return [s, p.slice(s.length)];
    }
    return [p];
  });
  return parts.filter((p) => p.length >= 2);
}

function tokenize(text) {
  const norm = normalizeText(text).replace(/[#@]/g, ' ');
  const raw = norm.split(/[\s،,.:;!?()"'\/\\|—–-]+/).filter(Boolean);
  const out = [];
  for (const t of raw) {
    for (const piece of splitConcat(t)) {
      if (piece.length < 2) continue;
      if (STOP.has(piece)) continue;
      if (/^\d+$/.test(piece) && piece.length < 2) continue;
      out.push(piece);
    }
  }
  return out;
}

/** 1-grams and 2-grams worth counting. */
function grams(tokens) {
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length >= 3) out.add(tokens[i]);
    if (i + 1 < tokens.length) out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return [...out];
}

/**
 * Build today's weighted corpus counts.
 *
 * @param {Array} docs  [{ text, source, weight }]
 * @returns {Object} { [gram]: { weight, sources: Set, docs: [] } }
 */
export function countCorpus(docs) {
  const table = {};
  for (const doc of docs) {
    if (!doc?.text) continue;
    const w = Number.isFinite(doc.weight) ? doc.weight : 1;
    for (const g of grams(tokenize(doc.text))) {
      table[g] = table[g] || { weight: 0, sources: new Set(), docs: [] };
      table[g].weight += w;
      table[g].sources.add(doc.source);
      if (table[g].docs.length < 6) table[g].docs.push({ text: doc.text, source: doc.source, ref: doc.ref });
    }
  }
  return table;
}

/**
 * Score today's grams against their own trailing history.
 *
 * lift    — today's weight over the trailing mean, with a +1 prior so a brand
 *           new phrase does not divide by zero
 * breadth — how many independent sources carry it today. A phrase in the
 *           hashtag list AND in Google Egypt queries is a far better bet than
 *           one that only exists in a single feed.
 *
 * @param {Object} table     output of countCorpus
 * @param {Object} history   { [gram]: [{date, weight, sources}] } oldest first
 * @param {String} today     ISO date
 * @param {Object} opts      { minWeight, baselineDays, limit }
 */
export function emergingPhrases(table, history, today, opts = {}) {
  const { minWeight = 2, baselineDays = 10, limit = 60 } = opts;
  const out = [];

  for (const [gram, cur] of Object.entries(table)) {
    if (cur.weight < minWeight) continue;

    const series = (history[gram] || []).filter((p) => p.date < today).slice(-baselineDays);
    const baseline = series.length
      ? series.reduce((s, p) => s + (p.weight || 0), 0) / series.length
      : 0;
    const peak = series.length ? Math.max(...series.map((p) => p.weight || 0)) : 0;

    const lift = round((cur.weight + 1) / (baseline + 1), 2);
    const breadth = cur.sources.size;
    const daysSeen = series.length + 1;
    const isNew = series.length === 0;

    // A phrase that is merely large but flat is not a trend. Require either a
    // real lift, or newness, or multi-source breadth.
    if (!isNew && lift < 1.6 && breadth < 3) continue;

    const archetypes = classifyFormat(gram);
    const rel = scoreRelevance(gram);

    // We are hunting formats, not topics. A phrase that matches no format
    // archetype and neither vertical has to clear a much higher bar before it
    // earns a row — otherwise the list fills with whatever words happen to be
    // frequent this week.
    const isTopicalOnly = archetypes.length === 0 && rel.score < 2;
    if (isTopicalOnly && !(lift >= 4 && breadth >= 2)) continue;

    const score = round(
      lift * (1 + 0.45 * (breadth - 1)) * (isNew ? 1.4 : 1) * (archetypes.length ? 1.25 : 1),
      2
    );

    out.push({
      key: `fmt:${gram}`,
      label: gram,
      phrase: gram,
      weight: round(cur.weight, 1),
      baseline: round(baseline, 2),
      peakBefore: round(peak, 1),
      lift,
      breadth,
      sources: [...cur.sources],
      daysSeen,
      isNew,
      firstSeen: series[0]?.date || today,
      archetypes,
      archetypeLabels: archetypes.map((a) => ARCHETYPES[a].label),
      relevance: rel.score,
      verticals: rel.verticals,
      score,
      status: statusOf({ isNew, lift, daysSeen, breadth }),
      examples: cur.docs,
      isRTL: /[؀-ۿ]/.test(gram),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * A format's own lifecycle, which is not the same shape as a hashtag's:
 * formats do not have a rank, they have a spread.
 */
function statusOf({ isNew, lift, daysSeen, breadth }) {
  if (isNew) return 'unseen';                       // never appeared before today
  if (lift >= 3) return 'spiking';
  if (lift >= 1.6) return breadth >= 3 ? 'spreading' : 'building';
  if (lift <= 0.6) return 'fading';
  return 'steady';
}

/** Merge today's counts into the rolling n-gram history. */
export function mergeCorpusHistory(history, table, date, keepDays = 30) {
  const next = { ...history };
  const cutoff = new Date(new Date(date) - keepDays * 86400000).toISOString().slice(0, 10);

  for (const [gram, cur] of Object.entries(table)) {
    const series = (next[gram] || []).filter((p) => p.date !== date && p.date >= cutoff);
    series.push({ date, weight: round(cur.weight, 1), sources: cur.sources.size });
    next[gram] = series;
  }
  // Drop grams that have gone quiet, so the file does not grow without bound.
  for (const [gram, series] of Object.entries(next)) {
    const kept = series.filter((p) => p.date >= cutoff);
    if (!kept.length) delete next[gram];
    else next[gram] = kept;
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * 3. Clustering
 * ------------------------------------------------------------------ */

/**
 * Attach the concrete signals sitting around a phrase: which charting hashtags
 * contain it, which sounds, which search queries — and the creators already
 * running it. This is what turns "80s is spiking" into something you can shoot.
 */
export function clusterFormat(phrase, { hashtags = [], sounds = [], keywords = [], searchDemand = [] }) {
  // Match on every alias, so an Arabic hashtag clusters with its Latin phrase.
  const forms = aliasesOf(phrase).map((f) => ({ loose: f, tight: f.replace(/\s+/g, '') }));
  const matches = (text) => {
    const n = normalizeText(text);
    const t = n.replace(/\s+/g, '');
    return forms.some((f) => n.includes(f.loose) || (f.tight.length >= 3 && t.includes(f.tight)));
  };

  const tags = hashtags.filter((h) => matches(h.rawName || h.label));
  const snds = sounds.filter((s) => matches([s.label, s.artist].filter(Boolean).join(' ')));
  const kws = keywords.filter((k) => matches(k.label));
  const queries = searchDemand.filter((q) => matches(q.label));

  const creators = new Map();
  for (const src of [...tags, ...snds]) {
    for (const c of src.creators || []) {
      if (!creators.has(c.handle)) creators.set(c.handle, { ...c, via: [] });
      creators.get(c.handle).via.push(src.label);
    }
  }

  return {
    hashtags: tags.slice(0, 8).map((h) => ({ label: h.label, rank: h.rank, stage: h.stage, views: h.views })),
    sounds: snds.slice(0, 8).map((s) => ({ label: s.label, artist: s.artist, rank: s.rank, stage: s.stage, songClipId: s.songClipId })),
    keywords: kws.slice(0, 8).map((k) => k.label),
    queries: queries.slice(0, 8).map((q) => ({ label: q.label, traffic: q.approxTraffic })),
    creators: [...creators.values()].slice(0, 8),
    // A format with a cleared sound attached is immediately actionable for a brand.
    hasClearedSound: snds.some((s) => s.commercialSafe === true),
  };
}

/**
 * Collapse the many ways one trend gets written into a single row.
 *
 * Left alone, an 80s challenge breaking out produces nine rows — "80s",
 * "80s challenge", "challenge", "تحدي", "تحدي الثمانينات", "الثمانينات",
 * "retro", "80s retro", "nights 80s" — and buries everything else. Two phrases
 * are the same trend when their alias sets overlap, when one contains the
 * other, or when their clusters point at the same hashtag or sound.
 *
 * Merging also *improves* the signal: breadth becomes the union of sources
 * across all variants, so the trend is correctly credited with appearing in
 * hashtags AND sounds AND search rather than being split three ways.
 *
 * Expects rows that already carry `cluster` (see clusterFormat).
 */
export function dedupeFormats(rows) {
  const groups = [];

  const clusterKeys = (r) => new Set([
    ...(r.cluster?.hashtags || []).map((h) => `h:${normalizeText(h.label)}`),
    ...(r.cluster?.sounds || []).map((s) => `s:${normalizeText(s.label)}`),
  ]);

  for (const row of [...rows].sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const aliases = new Set(aliasesOf(row.phrase));
    const ckeys = clusterKeys(row);
    const phrase = normalizeText(row.phrase);

    const home = groups.find((g) => {
      if ([...aliases].some((a) => g.aliases.has(a))) return true;
      if ([...g.phrases].some((p) => p.includes(phrase) || phrase.includes(p))) return true;
      // Sharing a concrete hashtag or sound is the strongest evidence of all.
      if (ckeys.size && [...ckeys].some((k) => g.clusterKeys.has(k))) return true;
      return false;
    });

    if (home) {
      home.members.push(row);
      aliases.forEach((a) => home.aliases.add(a));
      ckeys.forEach((k) => home.clusterKeys.add(k));
      home.phrases.add(phrase);
    } else {
      groups.push({
        members: [row],
        aliases,
        clusterKeys: ckeys,
        phrases: new Set([phrase]),
      });
    }
  }

  return groups
    .map((g) => {
      // Representative: highest score, preferring the more descriptive phrase
      // (more archetypes, then longer) so "80s challenge" wins over "challenge".
      const rep = [...g.members].sort(
        (a, b) =>
          (b.score || 0) - (a.score || 0) ||
          (b.archetypes?.length || 0) - (a.archetypes?.length || 0) ||
          String(b.phrase).length - String(a.phrase).length
      )[0];

      const sources = [...new Set(g.members.flatMap((m) => m.sources || []))];
      const archetypes = [...new Set(g.members.flatMap((m) => m.archetypes || []))];
      const verticals = [...new Set(g.members.flatMap((m) => m.verticals || []))];
      const maxLift = Math.max(...g.members.map((m) => m.lift ?? 0));
      const isNew = g.members.some((m) => m.isNew);
      const breadth = sources.length;

      // Rescore on the merged evidence, not the fragment's.
      const score = Math.round(
        maxLift * (1 + 0.45 * Math.max(0, breadth - 1)) * (isNew ? 1.4 : 1) *
          (archetypes.length ? 1.25 : 1) * 100
      ) / 100;

      return {
        ...rep,
        sources,
        breadth,
        archetypes,
        archetypeLabels: archetypes.map((a) => ARCHETYPES[a]?.label || a),
        verticals,
        relevance: Math.max(...g.members.map((m) => m.relevance || 0)),
        lift: maxLift,
        isNew,
        score,
        weight: Math.round(g.members.reduce((s, m) => s + (m.weight || 0), 0) * 10) / 10,
        // The other spellings, kept so you can search for any of them and so it
        // is obvious the row represents a cluster rather than a single phrase.
        variants: g.members
          .filter((m) => m.phrase !== rep.phrase)
          .map((m) => ({ phrase: m.phrase, lift: m.lift, sources: m.sources }))
          .slice(0, 8),
        variantCount: g.members.length - 1,
        cluster: mergeClusters(g.members.map((m) => m.cluster).filter(Boolean)),
        hasClearedSound: g.members.some((m) => m.hasClearedSound),
        playbook: playbookFor(archetypes, verticals),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function mergeClusters(clusters) {
  const byLabel = (arr, key = 'label') => {
    const seen = new Map();
    for (const item of arr) {
      const k = normalizeText(item?.[key] ?? item);
      if (k && !seen.has(k)) seen.set(k, item);
    }
    return [...seen.values()];
  };
  return {
    hashtags: byLabel(clusters.flatMap((c) => c.hashtags || [])).slice(0, 10),
    sounds: byLabel(clusters.flatMap((c) => c.sounds || [])).slice(0, 10),
    keywords: [...new Set(clusters.flatMap((c) => c.keywords || []))].slice(0, 10),
    queries: byLabel(clusters.flatMap((c) => c.queries || [])).slice(0, 10),
    creators: byLabel(clusters.flatMap((c) => c.creators || []), 'handle').slice(0, 10),
    hasClearedSound: clusters.some((c) => c.hasClearedSound),
  };
}

/**
 * Playbook lines for whichever verticals matched, so the row answers
 * "what do I actually shoot" and not just "what is happening".
 */
export function playbookFor(archetypes, verticals) {
  const want = verticals?.length ? verticals : ['realestate', 'automotive'];
  const out = [];
  for (const a of archetypes) {
    const spec = ARCHETYPES[a];
    if (!spec) continue;
    for (const v of want) {
      if (spec.playbook[v]) out.push({ archetype: spec.label, vertical: v, line: spec.playbook[v] });
    }
  }
  return out.slice(0, 4);
}

const round = (n, dp = 2) =>
  Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null;
