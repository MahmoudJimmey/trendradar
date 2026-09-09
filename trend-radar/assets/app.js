/* Trend Radar — Egypt
 *
 * Static frontend. Reads ./data/latest.json produced by scripts/collect.js in
 * GitHub Actions. No build step, no framework, no dependencies.
 *
 * When window.__TREND_DATA__ is present the page uses it directly instead of
 * fetching — that is how the hosted preview runs off inlined sample data.
 */

const LS = {
  log: 'trendradar.log.v1',
  theme: 'trendradar.theme.v1',
  pat: 'trendradar.pat.v1',
  repo: 'trendradar.repo.v1',
};

const state = {
  data: null,
  tab: 'formats',
  query: '',
  verdict: 'all',
  vertical: 'all',
  safeOnly: false,
  sort: { key: 'score', dir: -1 },
  selected: null,
};

/* ---------------------------------------------------------------- *
 * Tab definitions — each declares its own columns so one renderer
 * can serve sounds, hashtags, keywords, search demand and charts.
 * ---------------------------------------------------------------- */

const TABS = [
  { id: 'formats', label: 'Formats', section: 'formats', kind: 'formats' },
  { id: 'sounds', label: 'Sounds', section: 'sounds', kind: 'momentum', hasSafety: true },
  { id: 'hashtags', label: 'Hashtags', section: 'hashtags', kind: 'momentum' },
  { id: 'keywords', label: 'TikTok search', section: 'keywords', kind: 'simple' },
  { id: 'searchDemand', label: 'Google Egypt', section: 'searchDemand', kind: 'search' },
  { id: 'audioCharts', label: 'Apple Music EG', section: 'audioCharts', kind: 'chart' },
  { id: 'igSounds', label: 'Instagram audio', section: 'igSounds', kind: 'ig' },
  { id: 'videos', label: 'YouTube EG', section: 'videos', kind: 'video' },
  { id: 'dropouts', label: 'Fell off', section: null, kind: 'dropouts' },
];

/* ---------------------------------------------------------------- *
 * Formatting
 * ---------------------------------------------------------------- */

const AR = /[؀-ۿ]/;
const isRTL = (s) => AR.test(String(s || ''));

function compact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** Bidi-safe label: Arabic text gets its own isolated RTL run. */
function label(s) {
  const t = esc(s);
  return isRTL(s) ? `<span class="rtl" dir="rtl">${t}</span>` : t;
}

/**
 * Join a mixed Arabic/Latin list without the runs bleeding into each other.
 * Naively joining "تحدي, 80s, الثمانينات" reorders on screen into nonsense —
 * each item needs its own isolate, and so does the separator.
 */
function labelList(items) {
  return items
    .map((s) => `<span class="bidi">${label(s)}</span>`)
    .join('<span class="vsep">·</span>');
}

const VERTICAL_LABEL = { realestate: 'Real estate', automotive: 'Automotive' };
const verticalNames = (v = []) => v.map((x) => VERTICAL_LABEL[x] || x).join(' + ');

function deltaCell(d, blank = 'new') {
  if (d == null) return `<span class="delta flat">${blank}</span>`;
  if (d === 0) return '<span class="delta flat">0</span>';
  const cls = d > 0 ? 'up' : 'down';
  const arrow = d > 0 ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(d)}</span>`;
}

const STAGE_LABEL = {
  emerging: 'emerging', rising: 'rising', peaking: 'peaking',
  plateau: 'flat', declining: 'fading', expired: 'gone',
};

const VERDICT_LABEL = {
  'act-now': 'act now', 'ride-fast': 'ride fast', monitor: 'monitor',
  'too-late': 'too late', blocked: 'blocked', skip: 'skip',
};

/** Formats have their own lifecycle, mapped onto the existing pill colours. */
function fmtStageClass(status) {
  return {
    unseen: 'emerging', spiking: 'emerging', spreading: 'rising',
    building: 'rising', steady: 'plateau', fading: 'declining', watching: 'plateau',
  }[status] || 'plateau';
}

/**
 * Rank sparkline. Drawn to the series' own scale and inverted, because a lower
 * rank number is a better position — so a line going UP means improving.
 */
function sparkline(points, w = 96, h = 26, big = false) {
  const pts = (points || []).filter((p) => Number.isFinite(p.rank));
  const cls = big ? 'spark big' : 'spark';
  if (pts.length < 2) {
    return `<svg class="${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Not enough history yet"><line x1="2" y1="${h / 2}" x2="${w - 2}" y2="${h / 2}" stroke="var(--rule-strong)" stroke-width="1" stroke-dasharray="2 3" fill="none"/></svg>`;
  }
  const ranks = pts.map((p) => p.rank);
  const lo = Math.min(...ranks);
  const hi = Math.max(...ranks);
  // Leave room for the endpoint marker and its stroke inside the viewBox.
  const pad = big ? 8 : 4;
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (w - pad * 2)) / (pts.length - 1);
  const y = (r) => pad + ((r - lo) / span) * (h - pad * 2); // low rank -> top
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join('');
  const area = `${d}L${x(pts.length - 1).toFixed(1)},${h - pad}L${x(0).toFixed(1)},${h - pad}Z`;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const improving = last.rank <= first.rank;
  const stroke = improving ? 'var(--good)' : 'var(--bad)';

  return `<svg class="${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
    preserveAspectRatio="none" role="img"
    aria-label="Rank ${first.rank} on ${esc(first.date)} improving to ${last.rank} on ${esc(last.date)}">
    <path d="${area}" fill="${stroke}" fill-opacity="0.10" stroke="none"/>
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${big ? 2 : 1.5}"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.rank).toFixed(1)}" r="${big ? 3.4 : 2.4}" fill="${stroke}"/>
    ${big ? `<text x="${pad}" y="${h - 1}" fill="var(--ink-3)" font-size="9" font-family="var(--mono)">#${first.rank}</text>
      <text x="${w - pad}" y="${h - 1}" fill="var(--ink-3)" font-size="9" font-family="var(--mono)" text-anchor="end">#${last.rank}</text>` : ''}
  </svg>`;
}

function safetyPill(v) {
  if (v === true) return '<span class="pill safe" title="In TikTok\'s Commercial Music Library — cleared for brand use">cleared</span>';
  if (v === false) return '<span class="pill unsafe" title="Not cleared for commercial use">not cleared</span>';
  return '<span class="pill unknown" title="Licensing status unknown from this source">unknown</span>';
}

function creatorCell(row) {
  const cs = row.creators || [];
  if (!cs.length) return '<span class="sub">—</span>';
  const shown = cs.slice(0, 3).map((c) =>
    // Link the PROFILE, never a video. Profiles survive; individual posts get
    // deleted, set private or region-locked, and a dead link reads as a broken
    // dashboard. Placeholder rows from sample data get no link at all.
    c.profileUrl
      ? `<a class="h" href="${esc(c.profileUrl)}" target="_blank" rel="noopener nofollow"
           title="Open ${esc(c.handle)} on TikTok">${esc(c.handle)}</a>`
      : `<span class="h ph" title="Placeholder — this account does not exist">${esc(c.handle)}</span>`
  );
  const extra = cs.length > 3 ? `<span class="more">+${cs.length - 3}</span>` : '';
  return `<span class="faces">${shown.join('')}${extra}</span>`;
}

/**
 * One creator in the drawer list: the handle opens their profile (durable), and
 * a separate small link opens an example post (which may 404 — see the note under
 * the list). Placeholder creators from sample data render as plain text.
 */
function creatorRow(c) {
  const uses = `<span class="uses">${c.uses} post${c.uses === 1 ? '' : 's'}</span>`;

  if (!c.profileUrl) {
    return `<li><span class="ph-row"><span>${esc(c.handle)}</span>${uses}</span></li>`;
  }

  const post = c.examples?.[0]
    ? `<a class="postlink" href="${esc(c.examples[0])}" target="_blank" rel="noopener nofollow"
         title="Open an example post. May show &quot;video isn't available&quot; if it was deleted, made private or is region-locked.">post ↗</a>`
    : '';

  return `<li class="crow">
    <a class="profile" href="${esc(c.profileUrl)}" target="_blank" rel="noopener nofollow"
       title="Open ${esc(c.handle)}'s profile on TikTok">
      <span>${esc(c.handle)}</span>${uses}
    </a>${post}</li>`;
}

function saturationCell(v) {
  if (v == null) return '<span class="sub">—</span>';
  const cls = v < 0.4 ? 'low' : v > 0.7 ? 'high' : '';
  return `<span class="num">${Math.round(v * 100)}%</span>
    <span class="meter ${cls}" role="img" aria-label="Saturation ${Math.round(v * 100)} percent"><i style="width:${Math.round(v * 100)}%"></i></span>`;
}

/* ---------------------------------------------------------------- *
 * Column sets
 * ---------------------------------------------------------------- */

const SOURCE_LABEL = {
  hashtags: 'hashtags', sounds: 'sounds', keywords: 'TikTok search',
  searchDemand: 'Google EG', videos: 'YouTube EG',
};

const FORMAT_STATUS_LABEL = {
  unseen: 'brand new', spiking: 'spiking', spreading: 'spreading',
  building: 'building', steady: 'steady', fading: 'fading', watching: 'watching',
};

/** Which feeds carry this format today. Breadth is the strongest quality signal. */
function sourceChips(sources = []) {
  if (!sources.length) return '<span class="sub">—</span>';
  return `<span class="faces">${sources
    .map((s) => `<span class="h src">${esc(SOURCE_LABEL[s] || s)}</span>`)
    .join('')}</span>`;
}

/** Spike multiplier against the phrase's own trailing baseline. */
function liftCell(lift) {
  if (lift == null) return '<span class="sub">—</span>';
  const cls = lift >= 3 ? 'up' : lift <= 0.7 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${lift >= 1 ? '×' : ''}${lift}</span>`;
}

const COLS = {
  formats: () => [
    {
      key: 'label', label: 'Format', sort: true,
      cell: (r) => `<span class="title">${label(r.label)}${r.isNew ? '<span class="newdot" title="Not seen before today"></span>' : ''}</span>
        <span class="sub">${r.variantCount
          ? `also: ${labelList(r.variants.slice(0, 3).map((v) => v.phrase))}${r.variantCount > 3 ? ` <span class="vsep">+${r.variantCount - 3}</span>` : ''}`
          : (r.isSeed ? 'on your watch list' : '&nbsp;')}</span>`,
    },
    {
      key: 'archetypes', label: 'Shape',
      cell: (r) => r.archetypeLabels?.length
        ? `<span class="faces">${r.archetypeLabels.map((a) => `<span class="h arch">${esc(a)}</span>`).join('')}</span>`
        : '<span class="sub">unnamed</span>',
    },
    { key: 'lift', label: 'Spike', num: true, sort: true, cell: (r) => liftCell(r.lift) },
    { key: 'breadth', label: 'Feeds', num: true, sort: true, cell: (r) => `<span class="num">${r.breadth || 0}</span>` },
    { key: 'sources', label: 'Seen in', cell: (r) => sourceChips(r.sources) },
    {
      key: 'cluster', label: 'Attached to',
      cell: (r) => {
        const c = r.cluster || {};
        const bits = [];
        if (c.hashtags?.length) bits.push(`${c.hashtags.length} hashtag${c.hashtags.length === 1 ? '' : 's'}`);
        if (c.sounds?.length) bits.push(`${c.sounds.length} sound${c.sounds.length === 1 ? '' : 's'}`);
        if (c.queries?.length) bits.push(`${c.queries.length} quer${c.queries.length === 1 ? 'y' : 'ies'}`);
        if (!bits.length) return '<span class="sub">nothing charting yet</span>';
        return `<span class="sub" style="white-space:normal">${esc(bits.join(' · '))}</span>`;
      },
    },
    {
      key: 'hasClearedSound', label: 'Sound',
      cell: (r) => r.hasClearedSound
        ? '<span class="pill safe" title="A Commercial Music Library sound is already attached — usable by a brand account">cleared</span>'
        : '<span class="sub">—</span>',
    },
    { key: 'relevance', label: 'Fit', num: true, sort: true, cell: (r) => (r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : '<span class="sub">—</span>') },
    { key: 'status', label: 'Status', sort: true, cell: (r) => `<span class="pill ${fmtStageClass(r.status)}">${FORMAT_STATUS_LABEL[r.status] || r.status}</span>` },
    { key: 'verdict', label: 'Call', sort: true, cell: (r) => `<span class="pill v-${r.verdict}">${VERDICT_LABEL[r.verdict] || r.verdict}</span>` },
    {
      key: 'creators', label: 'Who used it',
      cell: (r) => creatorCell({ creators: r.cluster?.creators || [] }),
    },
  ],

  momentum: (tab) => [
    { key: 'rank', label: '#', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank ?? '—'}</span>` },
    {
      key: 'label', label: tab.id === 'sounds' ? 'Sound' : 'Hashtag', sort: true,
      cell: (r) => `<span class="title">${label(r.label)}${r.isNew ? '<span class="newdot" title="New today"></span>' : ''}</span>
        ${r.artist ? `<span class="sub">${esc(r.artist)}</span>` : ''}
        ${!r.artist && r.categories?.length ? `<span class="sub">${esc(r.categories.filter((c) => c !== 'ALL').join(' · ') || 'all industries')}</span>` : ''}`,
    },
    { key: 'sparkline', label: '14-day rank', cell: (r) => sparkline(r.sparkline) },
    { key: 'rankDelta', label: 'vs yest.', num: true, sort: true, cell: (r) => deltaCell(r.rankDelta) },
    { key: 'rankDelta7d', label: 'vs 7d', num: true, sort: true, cell: (r) => deltaCell(r.rankDelta7d, '—') },
    { key: 'velocity3d', label: 'Velocity', num: true, sort: true, cell: (r) => `<span class="delta ${r.velocity3d > 0 ? 'up' : r.velocity3d < 0 ? 'down' : 'flat'}">${r.velocity3d > 0 ? '+' : ''}${r.velocity3d ?? '—'}/d</span>` },
    { key: 'daysTracked', label: 'Age', num: true, sort: true, cell: (r) => `<span class="num">${r.daysTracked}d</span>` },
    { key: 'runwayDays', label: 'Runway', num: true, sort: true, cell: (r) => `<span class="num">${r.runwayDays}d</span><span class="sub">est.</span>` },
    { key: 'views', label: 'Views', num: true, sort: true, cell: (r) => `<span class="num">${compact(r.views)}</span>${r.viewsGrowthPct != null ? `<span class="sub">${r.viewsGrowthPct > 0 ? '+' : ''}${r.viewsGrowthPct}%</span>` : ''}` },
    { key: 'posts', label: 'Posts', num: true, sort: true, cell: (r) => `<span class="num">${compact(r.posts)}</span>${r.postsGrowthPct != null ? `<span class="sub">${r.postsGrowthPct > 0 ? '+' : ''}${r.postsGrowthPct}%</span>` : ''}` },
    { key: 'saturation', label: 'Crowding', num: true, sort: true, cell: (r) => saturationCell(r.saturation) },
    { key: 'stage', label: 'Stage', sort: true, cell: (r) => `<span class="pill ${r.stage}">${STAGE_LABEL[r.stage] || r.stage}</span>` },
    { key: 'verdict', label: 'Call', sort: true, cell: (r) => `<span class="pill v-${r.verdict}">${VERDICT_LABEL[r.verdict] || r.verdict}</span>` },
    ...(tab.hasSafety
      ? [
          { key: 'commercialSafe', label: 'Licence', cell: (r) => safetyPill(r.commercialSafe) },
          { key: 'crossover', label: 'Confirmed', cell: (r) => (r.crossover ? `<span class="pill x" title="Also charting on ${esc((r.crossoverSources || []).join(', '))}">2 sources</span>` : '<span class="sub">—</span>') },
        ]
      : []),
    { key: 'creators', label: 'Who used it', cell: creatorCell },
  ],

  simple: () => [
    { key: 'rank', label: '#', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank}</span>` },
    { key: 'label', label: 'Keyword', sort: true, cell: (r) => `<span class="title">${label(r.label)}</span>` },
    { key: 'rankDelta', label: 'vs yest.', num: true, sort: true, cell: (r) => deltaCell(r.rankDelta) },
    { key: 'daysTracked', label: 'Days on list', num: true, sort: true, cell: (r) => `<span class="num">${r.daysTracked}d</span>` },
    { key: 'relevance', label: 'Fit', num: true, sort: true, cell: (r) => (r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : '<span class="sub">—</span>') },
    { key: 'stage', label: 'Stage', sort: true, cell: (r) => `<span class="pill ${r.stage}">${STAGE_LABEL[r.stage]}</span>` },
  ],

  search: () => [
    { key: 'rank', label: '#', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank}</span>` },
    { key: 'label', label: 'Query', sort: true, cell: (r) => `<span class="title">${label(r.label)}</span>` },
    { key: 'views', label: 'Searches', num: true, sort: true, cell: (r) => `<span class="num">${r.approxTraffic || compact(r.views)}</span>` },
    { key: 'rankDelta', label: 'vs yest.', num: true, sort: true, cell: (r) => deltaCell(r.rankDelta) },
    { key: 'relevance', label: 'Fit', num: true, sort: true, cell: (r) => (r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : '<span class="sub">—</span>') },
    {
      key: 'why', label: 'Why it is trending',
      cell: (r) =>
        r.why?.length
          ? `<span class="sub" style="max-width:340px;white-space:normal">${label(r.why[0].title)}${r.why[0].source ? ` — ${esc(r.why[0].source)}` : ''}</span>`
          : '<span class="sub">—</span>',
    },
  ],

  chart: () => [
    { key: 'rank', label: '#', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank}</span>` },
    { key: 'label', label: 'Track', sort: true, cell: (r) => `<span class="title">${label(r.label)}</span><span class="sub">${esc(r.artist || '')}</span>` },
    { key: 'rankDelta', label: 'vs yest.', num: true, sort: true, cell: (r) => deltaCell(r.rankDelta) },
    { key: 'daysSinceRelease', label: 'Age of track', num: true, sort: true, cell: (r) => `<span class="num">${r.daysSinceRelease != null ? r.daysSinceRelease + 'd' : '—'}</span>` },
    { key: 'genre', label: 'Genre', cell: (r) => `<span class="sub">${esc(r.genre || '—')}</span>` },
    { key: 'commercialSafe', label: 'Licence', cell: (r) => safetyPill(r.commercialSafe) },
  ],

  ig: () => [
    { key: 'rank', label: 'Order', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank}</span><span class="sub">not a rank</span>` },
    { key: 'label', label: 'Audio', sort: true, cell: (r) => `<span class="title">${label(r.label)}</span><span class="sub">${esc(r.artist || r.audioType || '')}</span>` },
    {
      key: 'audioType', label: 'Type',
      cell: (r) => `<span class="pill unknown">${esc(String(r.audioType || '—').replace(/_/g, ' '))}</span>`,
    },
    { key: 'durationSec', label: 'Length', num: true, sort: true, cell: (r) => `<span class="num">${r.durationSec != null ? r.durationSec + 's' : '—'}</span>` },
    { key: 'commercialSafe', label: 'Ads eligible', cell: (r) => safetyPill(r.commercialSafe) },
    { key: 'daysTracked', label: 'Days seen', num: true, sort: true, cell: (r) => `<span class="num">${r.daysTracked}d</span>` },
  ],

  video: () => [
    { key: 'rank', label: '#', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.rank}</span>` },
    { key: 'label', label: 'Video', sort: true, cell: (r) => `<span class="title" style="display:block;max-width:380px;white-space:normal">${label(r.label)}</span><span class="sub">${esc(r.channel || '')}</span>` },
    { key: 'probableShort', label: 'Format', cell: (r) => (r.probableShort ? '<span class="pill rising">short</span>' : '<span class="pill unknown">long</span>') },
    { key: 'views', label: 'Views', num: true, sort: true, cell: (r) => `<span class="num">${compact(r.views)}</span>` },
    { key: 'likes', label: 'Likes', num: true, sort: true, cell: (r) => `<span class="num">${compact(r.likes)}</span>` },
    { key: 'relevance', label: 'Fit', num: true, sort: true, cell: (r) => (r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : '<span class="sub">—</span>') },
  ],

  dropouts: () => [
    { key: 'lastRank', label: 'Last #', num: true, sort: true, cell: (r) => `<span class="rankcell">${r.lastRank ?? '—'}</span>` },
    { key: 'label', label: 'Was charting', sort: true, cell: (r) => `<span class="title">${label(r.label)}</span>` },
    { key: 'lastSeen', label: 'Last seen', sort: true, cell: (r) => `<span class="sub">${esc(r.lastSeen)}</span>` },
    { key: 'daysGone', label: 'Gone for', num: true, sort: true, cell: (r) => `<span class="num">${r.daysGone}d</span>` },
    { key: 'verdict', label: 'Call', cell: () => '<span class="pill v-too-late">window shut</span>' },
  ],
};

/* ---------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------- */

function currentRows() {
  const tab = TABS.find((t) => t.id === state.tab);
  const d = state.data;
  if (!d) return { tab, rows: [] };

  let rows =
    tab.kind === 'dropouts'
      ? [...(d.dropouts?.sounds || []), ...(d.dropouts?.hashtags || [])]
      : [...(d.sections?.[tab.section] || [])];

  if (state.query) {
    const q = state.query.toLowerCase();
    rows = rows.filter((r) =>
      [
        r.label, r.artist, r.channel,
        // Search hits a format's merged spellings too, so looking for "80s"
        // finds the row even when it is titled تحدي الثمانينات.
        ...(r.variants || []).map((v) => v.phrase),
        ...(r.archetypeLabels || []),
        ...(r.creators || []).map((c) => c.handle),
        ...(r.cluster?.creators || []).map((c) => c.handle),
        ...(r.cluster?.hashtags || []).map((h) => h.label),
      ].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }
  if (state.verdict !== 'all') rows = rows.filter((r) => r.verdict === state.verdict);
  if (state.vertical !== 'all') rows = rows.filter((r) => (r.verticals || []).includes(state.vertical));
  if (state.safeOnly) rows = rows.filter((r) => r.commercialSafe === true);

  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    const an = av == null, bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === 'string') return av.localeCompare(bv, 'en') * dir;
    return (av - bv) * dir;
  });
  return { tab, rows };
}

function renderTabs() {
  const d = state.data;
  const el = document.getElementById('tabs');
  el.innerHTML = TABS.map((t) => {
    const n =
      t.kind === 'dropouts'
        ? (d?.dropouts?.sounds?.length || 0) + (d?.dropouts?.hashtags?.length || 0)
        : d?.sections?.[t.section]?.length || 0;
    return `<button class="tab" role="tab" data-tab="${t.id}"
      aria-selected="${state.tab === t.id}">${esc(t.label)}<span class="n">${n}</span></button>`;
  }).join('');
  el.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      // Formats have no rank — they sort by how hard they are spiking.
      state.sort =
        state.tab === 'formats' ? { key: 'score', dir: -1 }
        : state.tab === 'dropouts' ? { key: 'lastRank', dir: 1 }
        : { key: 'rank', dir: 1 };
      render();
    })
  );
}

/**
 * A blank tab should say why it is blank. "No data" sends you hunting; naming
 * the specific likely cause for THIS source sends you to the fix.
 */
function emptyState(tab) {
  const filtered = state.query || state.verdict !== 'all' || state.vertical !== 'all' || state.safeOnly;
  if (filtered) {
    return `<div class="empty">
      <p>No rows match these filters.</p>
      <p style="font-size:13.5px">Clear the search box and set the dropdowns back to “Every call” and “Both verticals”.</p>
    </div>`;
  }

  // Did the collector actually try this source, and what did it say?
  const health = (state.data?.health || []).filter((h) => (h.source || '').startsWith(SOURCE_PREFIX[tab.id] || ' '));
  const errored = health.filter((h) => h.status === 'error');
  const skipped = health.filter((h) => h.status === 'skipped');

  const detail = errored.length
    ? `<p class="ewhy err"><strong>The last run failed:</strong> ${esc(errored[0].note || 'no detail')}</p>`
    : skipped.length
      ? `<p class="ewhy"><strong>Skipped on the last run:</strong> ${esc(skipped[0].note || 'no detail')}</p>`
      : '';

  return `<div class="empty">
    <p>${esc(EMPTY_TITLE[tab.id] || 'Nothing here yet.')}</p>
    ${detail}
    ${EMPTY_HELP[tab.id] || '<p style="font-size:13.5px">Check <strong>Source health</strong> at the bottom of the page for what this source reported.</p>'}
  </div>`;
}

const SOURCE_PREFIX = {
  igSounds: 'instagram-audio',
  sounds: 'tiktok-sounds',
  hashtags: 'tiktok-hashtags',
  keywords: 'tiktok-keywords',
  searchDemand: 'google-trends',
  audioCharts: 'apple-music',
  videos: 'youtube',
  formats: 'format-detection',
};

const EMPTY_TITLE = {
  igSounds: 'No Instagram audio came back.',
  sounds: 'No TikTok sounds came back.',
  hashtags: 'No TikTok hashtags came back.',
  keywords: 'No TikTok search keywords came back.',
  searchDemand: 'No Google Egypt trends came back.',
  audioCharts: 'No Apple Music Egypt chart came back.',
  videos: 'No YouTube Egypt data came back.',
  formats: 'No formats detected yet.',
  dropouts: 'Nothing has fallen off the charts.',
};

const EMPTY_HELP = {
  igSounds: `<div class="ehelp">
    <p>This one is empty far more often than the others, and it is almost always one of these:</p>
    <ol>
      <li><strong>Instagram Login instead of Facebook Login.</strong> The most common cause by a wide
        margin. <code>/ig_audio</code> is <em>not supported</em> on the Instagram API with Instagram
        Login — the token has to come from Facebook Login for Business.</li>
      <li><strong>Account type.</strong> Business accounts are cut off from most of Meta's licensed
        music library, so <code>audio_type=music</code> returns nothing while original sounds still
        work. A Creator account keeps broader access.</li>
      <li><strong>Wrong ID.</strong> <code>IG_USER_ID</code> must be the Instagram professional
        account ID from the connected Facebook Page — not your @handle, not the Facebook user ID.</li>
      <li><strong>No Advanced Access.</strong> Without App Review you only reach your own test
        account.</li>
      <li><strong>Graph version.</strong> The Audio API needs v22.0 or later. Set
        <code>GRAPH_VERSION</code> if your app is pinned older.</li>
    </ol>
    <p class="ewhy">Worth knowing before you spend a day on this: even when it works, Meta returns
      <strong>names only</strong> — no play counts, no rank, no velocity, and no country filter. It
      cannot be made into an Egypt-specific ranking, because Meta does not publish one. Instagram is
      the tab to work by hand, using the in-app Edits feed and the Watchlist.</p>
  </div>`,
  sounds: `<div class="ehelp"><ol>
    <li>Needs <code>TIKTOK_ACCOUNT_TOKEN</code> + <code>TIKTOK_BUSINESS_ID</code> — a
      <em>TikTok account</em> token, not the advertiser token the hashtags tab uses.</li>
    <li>Since 20 March 2026 the TikTok Accounts scope requires the Accounts API application form to
      be approved first. That gates this tab specifically.</li>
    <li>Confirm <code>country_code=EG</code> returns rows — Egypt is in the Marketing API location
      list but this has not been verified live.</li>
  </ol></div>`,
  hashtags: `<div class="ehelp"><ol>
    <li>Needs <code>TIKTOK_ACCESS_TOKEN</code> + <code>TIKTOK_ADVERTISER_ID</code> (advertiser
      token). No application form for this half.</li>
    <li>If it returns 200 with nothing, test <code>country_code=US</code> to tell an Egypt coverage
      gap apart from an auth problem.</li>
  </ol></div>`,
  formats: `<div class="ehelp">
    <p>Format detection reads the other feeds, so it is empty when they are. Once hashtags and
      sounds are flowing it needs about <strong>four days</strong> of history before lift means
      anything — on day one every phrase is equally new.</p>
    <p style="font-size:13.5px">You can seed it now: add terms to <code>data/seeds.json</code> and
      anything matching gets clustered onto a row even before it charts.</p>
  </div>`,
  searchDemand: `<div class="ehelp"><p>This one needs no credentials at all, so an empty tab means the
    request itself failed. Check that the runner can reach <code>trends.google.com</code>.</p></div>`,
  audioCharts: `<div class="ehelp"><p>Also credential-free. If it is empty, the Apple RSS host was
    unreachable from the runner.</p></div>`,
  videos: `<div class="ehelp"><p>Needs <code>YOUTUBE_API_KEY</code>. It costs 1 quota unit per call
    against 10,000/day, so quota is almost never the problem — a missing key is.</p></div>`,
  dropouts: `<div class="ehelp"><p>Nothing dropped out, which on a young install usually just means
    there is not enough history yet to know what left.</p></div>`,
};

function renderTable() {
  const { tab, rows } = currentRows();
  const cols = COLS[tab.kind](tab);
  const wrap = document.getElementById('table');

  if (!rows.length) {
    wrap.innerHTML = emptyState(tab);
    return;
  }

  const head = cols
    .map((c) => {
      const active = state.sort.key === c.key;
      const dir = active ? (state.sort.dir === 1 ? '↑' : '↓') : '';
      return `<th class="${c.num ? 'num' : ''} ${c.sort ? 'sortable' : ''}"
        ${c.sort ? `data-sort="${c.key}"` : ''} scope="col">${esc(c.label)}<span class="dir">${dir}</span></th>`;
    })
    .join('');

  const body = rows
    .map(
      (r, i) => `<tr class="clickable" data-verdict="${esc(r.verdict || '')}" data-i="${i}" tabindex="0">
      ${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.cell(r)}</td>`).join('')}
    </tr>`
    )
    .join('');

  wrap.innerHTML = `<div class="tablewrap"><table>
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  wrap.querySelectorAll('th.sortable').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: 1 };
      renderTable();
    })
  );

  const open = (i) => { state.selected = rows[i]; renderDrawer(); };
  wrap.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      open(Number(tr.dataset.i));
    });
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(Number(tr.dataset.i)); }
    });
  });
}

function renderKpis() {
  const s = state.data?.summary || {};
  const cards = [
    { k: 'formats spiking', v: s.formatsSpiking, cls: 'hot' },
    { k: 'tracked', v: s.tracked, cls: '' },
    { k: 'new today', v: s.newToday, cls: 'hot' },
    { k: 'rising', v: s.rising, cls: 'hot' },
    { k: 'act now', v: s.actNow, cls: 'hot' },
    { k: 'fit your verticals', v: s.verticalFit, cls: '' },
    { k: 'cleared sounds', v: s.commercialSafeSounds, cls: '' },
    { k: '2-source confirmed', v: s.crossovers, cls: '' },
    { k: 'too late', v: s.tooLate, cls: 'cold' },
    { k: 'fell off', v: s.droppedOut, cls: 'cold' },
  ];
  document.getElementById('kpis').innerHTML = cards
    .map((c) => `<div class="kpi ${c.cls}"><div class="v">${c.v ?? '—'}</div><div class="k">${esc(c.k)}</div></div>`)
    .join('');
}

function renderAlerts() {
  const d = state.data;
  if (!d) return;
  const all = [...(d.sections?.sounds || []), ...(d.sections?.hashtags || [])];
  const fmts = d.sections?.formats || [];
  const out = [];

  // Formats lead, because a spiking format is the earliest signal on the page.
  const newFormats = fmts.filter((f) => f.status === 'unseen' || f.status === 'spiking');
  if (newFormats.length) {
    out.push({ cls: 'a-good', n: newFormats.length, t: `format${newFormats.length === 1 ? '' : 's'} spiking — ${newFormats.slice(0, 2).map((f) => f.label).join(', ')}` });
  }
  const broadFormats = fmts.filter((f) => f.breadth >= 3);
  if (broadFormats.length) out.push({ cls: 'a-cool', n: broadFormats.length, t: 'formats confirmed across 3+ feeds' });

  const readyFormats = fmts.filter((f) => f.hasClearedSound && (f.verdict === 'act-now' || f.verdict === 'ride-fast'));
  if (readyFormats.length) out.push({ cls: 'a-good', n: readyFormats.length, t: 'formats with a cleared sound ready to use' });

  const fastEntries = all.filter((r) => (r.alerts || []).includes('fast-entry-top-20'));
  if (fastEntries.length) out.push({ cls: 'a-good', n: fastEntries.length, t: 'entered the top 20 in under 3 days' });

  const jumps = all.filter((r) => (r.alerts || []).some((a) => a.startsWith('jumped-')));
  if (jumps.length) out.push({ cls: 'a-good', n: jumps.length, t: 'jumped 10+ places since yesterday' });

  const xo = (d.sections?.sounds || []).filter((r) => r.crossover);
  if (xo.length) out.push({ cls: 'a-cool', n: xo.length, t: 'sounds confirmed by Apple Music Egypt' });

  const fit = all.filter((r) => r.relevance >= 2 && (r.verdict === 'act-now' || r.verdict === 'ride-fast'));
  if (fit.length) out.push({ cls: 'a-good', n: fit.length, t: 'actionable AND in your verticals' });

  const sat = all.filter((r) => (r.alerts || []).includes('saturated'));
  if (sat.length) out.push({ cls: 'a-warn', n: sat.length, t: 'saturating — creators outpacing viewers' });

  const gone = (d.dropouts?.sounds?.length || 0) + (d.dropouts?.hashtags?.length || 0);
  if (gone) out.push({ cls: 'a-bad', n: gone, t: 'dropped off the chart' });

  const broken = (d.health || []).filter((h) => h.status === 'error');
  if (broken.length) out.push({ cls: 'a-bad', n: broken.length, t: 'sources failed on the last run' });

  document.getElementById('alerts').innerHTML = out.length
    ? out.map((a) => `<span class="a ${a.cls}"><b>${a.n}</b> ${esc(a.t)}</span>`).join('')
    : '<span class="a a-cool">Nothing unusual since the last run</span>';
}

/**
 * Format drawer. A format has no rank, so this answers different questions:
 * what shape is it, which feeds carry it, what concrete hashtags and sounds are
 * attached, and what would you actually shoot.
 */
function formatDrawerBody(r) {
  const row = (k, v) => (v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`);
  const c = r.cluster || {};

  const list = (items, render) =>
    items?.length ? `<ul class="vidlist">${items.map(render).join('')}</ul>` : '';

  return `
    <div class="pills">
      ${r.archetypeLabels?.map((a) => `<span class="pill x">${esc(a)}</span>`).join('') || ''}
      <span class="pill ${fmtStageClass(r.status)}">${FORMAT_STATUS_LABEL[r.status] || r.status}</span>
      <span class="pill v-${r.verdict}">${VERDICT_LABEL[r.verdict] || r.verdict}</span>
      ${r.hasClearedSound ? '<span class="pill safe">cleared sound attached</span>' : ''}
      ${r.isSeed ? '<span class="pill unknown">on your watch list</span>' : ''}
      ${r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : ''}
    </div>

    <h3>Signal</h3>
    <dl>
      ${row('Spike', r.lift == null
        ? 'watching — no spike yet'
        : r.isNew
          ? 'first appearance — nothing to compare against yet'
          : `×${r.lift} against its ${r.daysSeen ? `${r.daysSeen}-day ` : ''}baseline`)}
      ${row('Feeds carrying it', r.breadth ? `${r.breadth} of 5 — ${(r.sources || []).map((s) => SOURCE_LABEL[s] || s).join(', ')}` : '—')}
      ${row('Weighted mentions', r.weight || null)}
      ${row('Typical before', r.isNew ? null : (r.baseline != null ? r.baseline : null))}
      ${row('First seen', r.isNew ? 'today' : r.firstSeen)}
      ${row('Days tracked', r.isNew ? null : r.daysSeen)}
    </dl>
    <p class="note" style="font-size:12.5px">Weighted mentions count each appearance by how prominent it was — a #3 hashtag
      counts for more than a #180 one, and Google's own traffic estimate weights the search rows. It is a relative number for
      comparing formats on this page, not a platform metric.</p>
    ${r.breadth >= 3
      ? '<p class="note">Three or more independent feeds carry this. That is the strongest quality signal here — a phrase in the hashtag chart <em>and</em> Egyptian search <em>and</em> a sound title is a real format, not one feed\'s noise.</p>'
      : r.breadth === 1
        ? '<p class="note">Only one feed carries this so far. Treat it as a lead to check by hand, not a confirmed format.</p>'
        : ''}

    ${r.variantCount ? `<h3>Also written as</h3>
      <div class="pills">${r.variants.map((v) => `<span class="pill unknown">${label(v.phrase)}</span>`).join('')}</div>
      <p class="note">These were detected separately and merged into one row — Arabic and Latin spellings of the same trend are counted together, so the spike above reflects all of them.</p>` : ''}

    ${c.hashtags?.length ? `<h3>Hashtags carrying it</h3>
      ${list(c.hashtags, (h) => `<li><span class="ph-row"><span>${label(h.label)}</span>
        <span class="uses">#${h.rank ?? '—'}${h.stage ? ` · ${esc(STAGE_LABEL[h.stage] || h.stage)}` : ''}</span></span></li>`)}` : ''}

    ${c.sounds?.length ? `<h3>Sounds carrying it</h3>
      ${list(c.sounds, (s) => `<li><span class="ph-row"><span>${label(s.label)}${s.artist ? ` — ${esc(s.artist)}` : ''}</span>
        <span class="uses">#${s.rank ?? '—'}</span></span></li>`)}
      ${c.sounds.some((s) => s.songClipId)
        ? `<p class="note">Publishable clip ID${c.sounds.filter((s) => s.songClipId).length > 1 ? 's' : ''}:
           ${c.sounds.filter((s) => s.songClipId).map((s) => `<code>${esc(s.songClipId)}</code>`).join(' ')}
           — pass as <code>music_sound_id</code> and store it against the post.</p>`
        : ''}` : ''}

    ${c.queries?.length ? `<h3>Egyptian searches</h3>
      ${list(c.queries, (q) => `<li><span class="ph-row"><span>${label(q.label)}</span>
        <span class="uses">${esc(q.traffic || '')}</span></span></li>`)}` : ''}

    ${r.relatedHashtags?.length ? `<h3>Related hashtags (TikTok's own suggestions)</h3>
      <div class="pills">${r.relatedHashtags.map((h) => `<span class="pill unknown">${label(h.name)}</span>`).join('')}</div>` : ''}

    <h3>What to shoot</h3>
    ${r.playbook?.length
      ? `<ul class="playbook">${r.playbook
          .map((p) => `<li><span class="pbk">${esc(p.vertical === 'realestate' ? 'Real estate' : 'Automotive')} · ${esc(p.archetype)}</span>${esc(p.line)}</li>`)
          .join('')}</ul>`
      : `<p class="note">No archetype matched, so there is no template for this one. That usually means the format has not been named yet —
         open the top videos on the attached hashtag and work out the mechanic before copying the surface.</p>`}

    ${c.creators?.length ? `<h3>Already running it (${c.creators.length})</h3>
      <ul class="vidlist">${c.creators.map((cr) => creatorRow(cr)).join('')}</ul>
      ${state.data?.sample ? '<p class="note">Placeholder names from the sample data — not real accounts.</p>' : ''}` : ''}

    ${r.examples?.length ? `<h3>Where it was detected</h3>
      ${list(r.examples.slice(0, 6), (e) => `<li><span class="ph-row"><span>${label(e.text)}</span>
        <span class="uses">${esc(SOURCE_LABEL[e.source] || e.source)}</span></span></li>`)}` : ''}`;
}

function renderDrawer() {
  const host = document.getElementById('drawer');
  const r = state.selected;
  if (!r) { host.innerHTML = ''; return; }

  const row = (k, v) => (v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${v}</dd>`);
  const creators = r.creators || [];
  const isFormat = !!r.phrase;

  host.innerHTML = `
    <div class="scrim" data-close></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(r.label || 'Detail')}">
      <button class="close" data-close>Close ✕</button>
      <h2>${label(r.label)}</h2>
      <p class="who">${isFormat
        ? esc(`format · ${r.archetypeLabels?.join(', ') || 'unnamed shape'}`)
        : esc(r.artist || r.channel || r.source || '')}</p>

      ${isFormat ? formatDrawerBody(r) : `
      <div class="pills">
        ${r.stage ? `<span class="pill ${r.stage}">${STAGE_LABEL[r.stage] || r.stage}</span>` : ''}
        ${r.verdict ? `<span class="pill v-${r.verdict}">${VERDICT_LABEL[r.verdict] || r.verdict}</span>` : ''}
        ${r.commercialSafe !== undefined ? safetyPill(r.commercialSafe) : ''}
        ${r.crossover ? '<span class="pill x">2-source confirmed</span>' : ''}
        ${r.relevance >= 2 ? `<span class="pill x">${esc(verticalNames(r.verticals))}</span>` : ''}
      </div>

      ${r.sparkline?.length > 1 ? `<div class="bigchart">${sparkline(r.sparkline, 460, 104, true)}</div>
        <p class="sub">Rank across ${r.sparkline.length} days — the line rises as the position improves</p>` : ''}

      <h3>Momentum</h3>
      <dl>
        ${row('Rank now', r.rank)}
        ${row('Yesterday', r.rankPrev)}
        ${row('7 days ago', r.rank7dAgo)}
        ${row('Best ever', r.peakRank != null ? `${r.peakRank}${r.daysSincePeak ? ` (${r.daysSincePeak}d ago)` : ' (today)'}` : null)}
        ${row('Velocity', r.velocity3d != null ? `${r.velocity3d > 0 ? '+' : ''}${r.velocity3d} places/day` : null)}
        ${row('Acceleration', r.acceleration != null ? `${r.acceleration > 0 ? '+' : ''}${r.acceleration}` : 'not enough history yet')}
        ${row('First seen', r.firstSeen)}
        ${row('Age', r.daysTracked != null ? `${r.daysTracked} days on chart` : null)}
        ${row('Runway left', r.runwayDays != null ? `~${r.runwayDays} days (estimate)` : null)}
      </dl>

      <h3>Scale</h3>
      <dl>
        ${row('Views', compact(r.views))}
        ${row('Views change', r.viewsGrowthPct != null ? `${r.viewsGrowthPct > 0 ? '+' : ''}${r.viewsGrowthPct}% vs yesterday` : null)}
        ${row('Posts', compact(r.posts))}
        ${row('Posts change', r.postsGrowthPct != null ? `${r.postsGrowthPct > 0 ? '+' : ''}${r.postsGrowthPct}% vs yesterday` : null)}
        ${row('Crowding', r.saturation != null ? `${Math.round(r.saturation * 100)}% — ${r.saturation > 0.7 ? 'creators are outpacing viewers' : 'still room'}` : null)}
        ${row('Top markets', (r.topCountries || []).join(', ') || null)}
      </dl>

      ${r.songClipId ? `<h3>Publish</h3>
        <dl>${row('Sound clip ID', `<code>${esc(r.songClipId)}</code>`)}</dl>
        <p class="note">Pass this as <code>music_sound_id</code> to <code>/business/video/publish/</code>.
        Save it against the post — neither platform will tell you later which sound a post used.</p>` : ''}

      <h3>Who has used it${creators.length ? ` (${creators.length})` : ''}</h3>
      ${creators.length
        ? `<ul class="vidlist">${creators.map((c) => creatorRow(c)).join('')}</ul>
           ${state.data?.sample
             ? '<p class="note">These are placeholder names from the sample data, not real accounts, so they are not clickable. Real runs return actual handles parsed from the share URLs TikTok gives back.</p>'
             : `<p class="note">Handles are parsed from the share URLs TikTok returns, so the profile link is reliable.
                <strong>A "post" link can still be dead</strong> — creators delete videos, switch to private, or the post is
                region-locked, and TikTok shows "video isn't available" in all three cases. Open the profile instead when that happens.
                Example videos may also come from another market: TikTok limits video lookups to a hashtag's own top-5 countries.</p>`}`
        : '<p class="note">No creator examples on this row. Either it fell outside the creator-lookup limit, or the video endpoint returned nothing for this market.</p>'}

      ${r.why?.length ? `<h3>Why it is trending</h3><ul class="vidlist">${r.why
          .map((w) => `<li><a href="${esc(w.url || '#')}" target="_blank" rel="noopener"><span>${label(w.title)}</span><span class="uses">${esc(w.source || '')}</span></a></li>`)
          .join('')}</ul>` : ''}

      ${r.alerts?.length ? `<h3>Flags</h3><div class="pills">${r.alerts
          .map((a) => `<span class="pill unknown">${esc(a)}</span>`).join('')}</div>` : ''}

      `}

      <h3>Log a decision</h3>
      <form class="logform" id="logform">
        <select name="verdict" aria-label="Your call">
          <option value="using">We are using it</option>
          <option value="shortlist">Shortlist</option>
          <option value="skip">Skip</option>
          <option value="too-late">Too late</option>
        </select>
        <textarea name="note" placeholder="What you would post with it, or why not. Kept in this browser — use Copy JSON to commit it to the repo."></textarea>
        <button type="submit" class="primary">Save to watchlist</button>
      </form>
    </aside>`;

  host.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => { state.selected = null; renderDrawer(); })
  );
  host.querySelector('#logform')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    addLog({
      date: new Date().toISOString().slice(0, 10),
      key: r.key,
      label: r.label,
      section: state.tab,
      rankAtDecision: r.rank ?? null,
      stage: r.stage ?? null,
      verdict: f.get('verdict'),
      note: String(f.get('note') || '').slice(0, 400),
    });
    state.selected = null;
    renderDrawer();
    renderLog();
  });

  const esckey = (e) => {
    if (e.key === 'Escape') { state.selected = null; renderDrawer(); document.removeEventListener('keydown', esckey); }
  };
  document.addEventListener('keydown', esckey);
  host.querySelector('.close')?.focus();
}

/* ---------------------------------------------------------------- *
 * Watchlist — the human layer. Automated feeds tell you what is
 * trending; this is the only place that records what you decided,
 * which is what makes next month's review worth anything.
 * ---------------------------------------------------------------- */

const readLog = () => { try { return JSON.parse(localStorage.getItem(LS.log)) || []; } catch { return []; } };
const writeLog = (v) => { try { localStorage.setItem(LS.log, JSON.stringify(v)); } catch {} };

function addLog(entry) {
  const log = readLog();
  log.unshift({ id: Date.now().toString(36), ...entry });
  writeLog(log.slice(0, 400));
}

function renderLog() {
  const log = readLog();
  const el = document.getElementById('loglist');
  const committed = state.data?.manualLog || [];
  const merged = [...log, ...committed];

  el.innerHTML = merged.length
    ? merged
        .map(
          (e) => `<li>
        <span class="when">${esc(e.date)}</span>
        <span class="what">${label(e.label)}<small>${esc(e.section || '')}${e.rankAtDecision ? ` · was #${e.rankAtDecision}` : ''}${e.note ? ` · ${esc(e.note.slice(0, 90))}` : ''}</small></span>
        <span class="pill v-${e.verdict === 'using' ? 'act-now' : e.verdict === 'shortlist' ? 'monitor' : 'too-late'}">${esc(e.verdict)}</span>
        ${e.id ? `<button class="del" data-del="${esc(e.id)}" aria-label="Delete entry">✕</button>` : '<span class="sub">repo</span>'}
      </li>`
        )
        .join('')
    : '<li><span class="sub">Nothing logged yet. Open any row and record what you decided — that is what makes the history useful later.</span></li>';

  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      writeLog(readLog().filter((x) => x.id !== b.dataset.del));
      renderLog();
    })
  );
}

/**
 * Copy the watchlist as JSON, ready to paste into data/manual-log.json.
 * Clipboard rather than a file download, because pasting into the repo file is
 * the actual next step — and because a download link is inert inside some
 * embedded viewers.
 */
async function exportLog(btn) {
  const log = readLog();
  if (!log.length) { toast('Nothing logged yet — open a row and record a decision first.'); return; }
  const json = JSON.stringify(log, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    toast(`Copied ${log.length} entr${log.length === 1 ? 'y' : 'ies'}. Paste into data/manual-log.json and commit.`);
    return;
  } catch { /* clipboard blocked — fall through */ }

  // Fallback: show it selected so it can be copied by hand.
  const el = document.getElementById('toast');
  el.hidden = false;
  el.innerHTML = `<div class="banner info"><div>
    <strong>Copy this into <code>data/manual-log.json</code>:</strong>
    <textarea readonly style="width:100%;min-height:150px;margin-top:8px;font-family:var(--mono);font-size:11.5px;
      background:var(--surface-2);color:var(--ink);border:1px solid var(--rule);border-radius:4px;padding:8px">${esc(json)}</textarea>
  </div></div>`;
  el.querySelector('textarea').select();
}

/* ---------------------------------------------------------------- *
 * Health
 * ---------------------------------------------------------------- */

function renderHealth() {
  const h = state.data?.health || [];
  document.getElementById('health').innerHTML = h.length
    ? h
        .map(
          (s) => `<div class="hsrc ${esc(s.status)}">
        <div class="n">${esc(s.source)} · ${esc(s.status)}${s.count ? ` · ${s.count}` : ''}</div>
        ${s.note ? `<div class="msg">${esc(s.note)}</div>` : ''}
      </div>`
        )
        .join('')
    : '<div class="hsrc skipped"><div class="n">no health data</div></div>';
}

/* ---------------------------------------------------------------- *
 * Refresh
 *
 * Soft refresh re-reads the JSON the last Actions run committed.
 * Hard refresh asks GitHub to run the collector now via workflow_dispatch,
 * which needs a fine-grained token with Actions: write on this repo only.
 * The token is kept in this browser and never sent anywhere but api.github.com.
 * ---------------------------------------------------------------- */

async function softRefresh(btn) {
  setBusy(btn, true, 'Reloading');
  try {
    await loadData(true);
    render();
    toast('Reloaded the latest committed snapshot.');
  } catch (err) {
    toast(`Could not reload: ${err.message}`, true);
  } finally {
    setBusy(btn, false, 'Refresh');
  }
}

async function hardRefresh(btn) {
  const repo = localStorage.getItem(LS.repo) || prompt('Repository, as owner/name:');
  if (!repo) return;
  const pat = localStorage.getItem(LS.pat) || prompt(
    'Fine-grained GitHub token with Actions: write on this repo.\n\nStored in this browser only. Leave blank to cancel.'
  );
  if (!pat) return;
  localStorage.setItem(LS.repo, repo);
  localStorage.setItem(LS.pat, pat);

  setBusy(btn, true, 'Collecting');
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/collect.yml/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (res.status === 204) {
      toast('Collector started on GitHub. It commits in about a minute — then hit Refresh.');
    } else {
      const body = await res.text();
      toast(`GitHub said ${res.status}: ${body.slice(0, 160)}`, true);
    }
  } catch (err) {
    toast(`Dispatch failed: ${err.message}`, true);
  } finally {
    setBusy(btn, false, 'Collect now');
  }
}

function setBusy(btn, busy, text) {
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? `<span class="spin">◠</span> ${esc(text)}` : esc(text);
}

let toastTimer;
function toast(msg, bad = false) {
  const el = document.getElementById('toast');
  el.innerHTML = `<div class="banner ${bad ? '' : 'info'}">${esc(msg)}</div>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

/* ---------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------- */

async function loadData(bust = false) {
  if (window.__TREND_DATA__ && !bust) { state.data = window.__TREND_DATA__; return; }
  if (window.__TREND_DATA__ && bust) { state.data = window.__TREND_DATA__; return; }
  const url = `./data/latest.json${bust ? `?t=${Date.now()}` : ''}`;
  const res = await fetch(url, { cache: bust ? 'reload' : 'default' });
  if (!res.ok) throw new Error(`data/latest.json returned ${res.status}`);
  state.data = await res.json();
}

function renderStamp() {
  const d = state.data;
  if (!d) return;
  const when = d.generatedAt ? new Date(d.generatedAt) : null;
  document.getElementById('stamp').innerHTML =
    `<span><b>Collected</b> ${when ? when.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'}</span>` +
    `<span><b>Market</b> ${esc(d.country || '—')}</span>` +
    `<span><b>Window</b> ${esc(d.dateRange || '—')}</span>` +
    `<span><b>History</b> ${d.daysOfHistory || 0} day${d.daysOfHistory === 1 ? '' : 's'}</span>`;
}

function renderBanners() {
  const d = state.data;
  const el = document.getElementById('banners');
  const out = [];

  if (d?.sample) {
    out.push(`<div class="banner"><span>⚠</span><div><strong>Sample data.</strong>
      Every row below is invented, shaped exactly like real collector output, so the page is
      legible before credentials are wired up. Run <code>npm run collect</code> with your
      tokens set — or trigger the workflow — to replace all of it.</div></div>`);
  }
  if (d && !d.sample && d.daysOfHistory < 3) {
    out.push(`<div class="banner info"><span>◔</span><div><strong>Day ${d.daysOfHistory} of history.</strong>
      Day-over-day columns fill in from the second snapshot, and 7-day momentum needs a week.
      TikTok's own <code>trending_history</code> is folded in where available, so hashtags and sounds
      may already show deltas.</div></div>`);
  }
  const broken = (d?.health || []).filter((h) => h.status === 'error');
  if (broken.length) {
    out.push(`<div class="banner"><span>✕</span><div><strong>${broken.length} source${broken.length === 1 ? '' : 's'} failed
      on the last run.</strong> ${esc(broken.map((b) => b.source).join(', '))} — see Source health below.
      Numbers on screen are from the last successful collection, not from now.</div></div>`);
  }
  el.innerHTML = out.join('');
}

function renderFilters() {
  const box = document.getElementById('filters');
  if (box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = `
    <input type="search" id="q" placeholder="Search sounds, tags, creators…" aria-label="Search">
    <select id="fverdict" aria-label="Filter by call">
      <option value="all">Every call</option>
      <option value="act-now">Act now</option>
      <option value="ride-fast">Ride fast</option>
      <option value="monitor">Monitor</option>
      <option value="too-late">Too late</option>
    </select>
    <select id="fvertical" aria-label="Filter by vertical">
      <option value="all">Both verticals</option>
      <option value="realestate">Real estate</option>
      <option value="automotive">Automotive</option>
    </select>
    <button class="toggle" id="fsafe" aria-pressed="false" title="Only sounds cleared for brand use">Cleared only</button>
    <span class="sep"></span>
    <button class="toggle icon" id="theme"></button>`;

  box.querySelector('#q').addEventListener('input', (e) => { state.query = e.target.value; renderTable(); });
  box.querySelector('#fverdict').addEventListener('change', (e) => { state.verdict = e.target.value; renderTable(); });
  box.querySelector('#fvertical').addEventListener('change', (e) => { state.vertical = e.target.value; renderTable(); });
  box.querySelector('#fsafe').addEventListener('click', (e) => {
    state.safeOnly = !state.safeOnly;
    e.currentTarget.setAttribute('aria-pressed', String(state.safeOnly));
    renderTable();
  });
  const themeBtn = box.querySelector('#theme');
  paintThemeButton(themeBtn);
  themeBtn.addEventListener('click', () => {
    const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(LS.theme, next); } catch {}
    paintThemeButton(themeBtn);
  });

  // Nothing is stamped on the root until the first click, so a viewer on "system"
  // follows their OS. Repaint the icon if that flips underneath us.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) paintThemeButton(themeBtn);
  });
}

/* ---------------------------------------------------------------- *
 * Theme icon
 *
 * Three states, not two: an explicit choice stamps data-theme on the root, and
 * the default "system" stamps nothing — so resolve through matchMedia before
 * deciding which icon to draw.
 * ---------------------------------------------------------------- */

function resolvedTheme() {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark' || stamped === 'light') return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const ICON_MOON = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <path d="M15.6 12.9A6.4 6.4 0 0 1 7.1 4.4 6.9 6.9 0 1 0 15.6 12.9Z"
    fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

const ICON_SUN = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
  <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <path d="M10 1.6v2.1M10 16.3v2.1M1.6 10h2.1M16.3 10h2.1"/>
    <path d="M4.1 4.1l1.5 1.5M14.4 14.4l1.5 1.5M15.9 4.1l-1.5 1.5M5.6 14.4l-1.5 1.5"/>
  </g>
</svg>`;

/** The button shows what you would switch TO, which is the convention people expect. */
function paintThemeButton(btn) {
  if (!btn) return;
  const dark = resolvedTheme() === 'dark';
  btn.innerHTML = dark ? ICON_SUN : ICON_MOON;
  const labelText = dark ? 'Switch to light theme' : 'Switch to dark theme';
  btn.setAttribute('aria-label', labelText);
  btn.setAttribute('title', labelText);
  btn.setAttribute('aria-pressed', String(dark));
}

function render() {
  renderStamp();
  renderBanners();
  renderAlerts();
  renderKpis();
  renderTabs();
  renderFilters();
  renderTable();
  renderLog();
  renderHealth();
}

async function boot() {
  try {
    const t = localStorage.getItem(LS.theme);
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {}

  document.getElementById('refresh').addEventListener('click', (e) => softRefresh(e.currentTarget));
  document.getElementById('collect').addEventListener('click', (e) => hardRefresh(e.currentTarget));
  document.getElementById('exportlog').addEventListener('click', (e) => exportLog(e.currentTarget));

  try {
    await loadData();
    render();
  } catch (err) {
    document.getElementById('banners').innerHTML = `<div class="banner"><span>✕</span><div>
      <strong>No data yet.</strong> ${esc(err.message)}. Run <code>npm run seed</code> for sample data,
      or <code>npm run collect</code> once your tokens are set.</div></div>`;
  }
}

boot();
