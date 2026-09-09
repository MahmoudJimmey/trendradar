/**
 * Apple Music Egypt — most-played chart.
 *
 * Public JSON, no key, no auth, updated daily, and genuinely Egyptian repertoire.
 * This is the cross-check that separates a real audio trend from a TikTok-only
 * spike: a track that is climbing here AND on the TikTok CML chart has demand
 * behind it, and historically a longer runway.
 *
 * Feed generator: https://rss.marketingtools.apple.com/
 */

import { getJson } from '../lib/http.js';

const FEED = (country, limit) =>
  `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${limit}/songs.json`;

export async function mostPlayed({ country = 'eg', limit = 50 } = {}) {
  const body = await getJson(FEED(country, limit));
  const feed = body.feed || {};
  const rows = (feed.results || []).map((r, i) => ({
    key: `apple:${r.id}`,
    id: r.id,
    label: r.name,
    artist: r.artistName,
    rank: i + 1,
    views: null,
    posts: null,
    releaseDate: r.releaseDate,
    genre: (r.genres || [])
      .map((g) => g.name)
      .filter((n) => n && n !== 'Music')
      .join(', '),
    artwork: r.artworkUrl100,
    url: r.url,
    artistUrl: r.artistUrl,
    // Age is the useful derived field: a three-week-old song entering the chart
    // is a different bet from a two-day-old release.
    daysSinceRelease: r.releaseDate
      ? Math.max(0, Math.round((Date.now() - new Date(r.releaseDate)) / 86400000))
      : null,
    source: 'apple-music-eg',
    // Chart presence says nothing about licensing. Only the TikTok CML flag does.
    commercialSafe: null,
  }));

  return {
    source: 'apple-music-eg',
    country: feed.country || country,
    updated: feed.updated || null,
    rows,
  };
}
