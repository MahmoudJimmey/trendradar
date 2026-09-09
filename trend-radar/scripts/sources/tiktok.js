/**
 * TikTok Discovery API (part of the TikTok for Business Marketing API).
 *
 * This is the only free, official, country-filterable source of ranked trending
 * hashtags AND ranked trending Commercial Music Library sounds. It is NOT the
 * academic Research API, which we are ineligible for.
 *
 * Two different token types — this trips everyone up:
 *   advertiser token (TIKTOK_ACCESS_TOKEN + TIKTOK_ADVERTISER_ID)
 *     → hashtags, hashtag detail, hashtag videos
 *   TikTok account token (TIKTOK_ACCOUNT_TOKEN + TIKTOK_BUSINESS_ID)
 *     → CML sounds, sound videos, trending search keywords
 *
 * Docs: https://business-api.tiktok.com/portal/docs?id=1825127388184577
 */

import { getJson } from '../lib/http.js';

const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

/** Industry categories to sweep. There is no literal "real estate" category. */
export const CATEGORIES = [
  'ALL',
  'HOME_IMPROVEMENT',
  'FINANCIAL_SERVICES',
  'LIFE_SERVICES',
  'VEHICLE_AND_TRANSPORTATION',
  'TRAVEL',
];

/** Genres worth sweeping for an Egyptian audience. */
export const GENRES = ['ALL', 'ARABIC_POP', 'POP', 'HIP_HOP_RAP', 'ELECTRONIC'];

async function call(url, token) {
  const body = await getJson(url, { headers: { 'Access-Token': token } });
  if (body.code !== 0) {
    throw new Error(`TikTok API code ${body.code}: ${body.message || 'unknown'}`);
  }
  return body.data || {};
}

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

/* ------------------------------------------------------------------ *
 * Hashtags  (advertiser token)
 * ------------------------------------------------------------------ */

export async function trendingHashtags({ token, advertiserId, country = 'EG', dateRange = '7DAY', category = 'ALL' }) {
  const url = `${BASE}/discovery/trending_list/?${qs({
    advertiser_id: advertiserId,
    discovery_type: 'HASHTAG',
    country_code: country,
    date_range: dateRange,
    category_name: category,
  })}`;
  const data = await call(url, token);
  const list = data.list || [];

  return list.map((h) => ({
    key: `tag:${h.hashtag_id || h.hashtag_name}`,
    id: h.hashtag_id,
    label: h.hashtag_name ? `#${h.hashtag_name}` : String(h.hashtag_id),
    rawName: h.hashtag_name,
    rank: num(h.rank_position),
    // rank_change arrives either as a signed integer or the literal string "NEW".
    reportedChange: h.rank_change === 'NEW' ? 'NEW' : num(h.rank_change),
    views: num(h.views),
    posts: num(h.posts),
    viewsLifetime: num(h.views_global_lifetime),
    postsLifetime: num(h.posts_global_lifetime),
    topCountries: (h.top_country_list || []).map((c) => c.country_code || c),
    category,
    // trending_history gives up to 30 days of daily rank without us storing anything —
    // valuable on day one, before our own history has accumulated.
    reportedHistory: (h.trending_history || []).map((p) => ({
      date: p.date,
      rank: num(p.rank_position_daily),
      views: num(p.views_daily),
    })),
    source: 'tiktok-discovery',
    commercialSafe: true, // hashtags carry no licensing exposure
  }));
}

export async function hashtagDetail({ token, advertiserId, hashtagId, country = 'EG', dateRange = '7DAY' }) {
  const url = `${BASE}/discovery/detail/?${qs({
    advertiser_id: advertiserId,
    discovery_type: 'HASHTAG',
    hashtag_id: hashtagId,
    country_code: country,
    date_range: dateRange,
  })}`;
  return call(url, token);
}

/**
 * Sibling hashtags for a name — TikTok's own "related hashtags" recommender.
 *
 * This is the cheapest way to expand a format candidate into its real cluster:
 * given "80s" it returns the neighbouring tags people are actually using, which
 * is how #80schallenge, #80smusic and #retro end up grouped as one trend rather
 * than three unrelated rows. It also lets you probe a term that has NOT charted
 * yet, instead of waiting for it to reach the top 200.
 */
export async function relatedHashtags({ token, advertiserId, name, country = 'EG', limit = 20 }) {
  const url = `${BASE}/tool/hashtag/recommend/?${qs({
    advertiser_id: advertiserId,
    keyword: name,
    country_code: country,
    limit,
  })}`;
  const data = await call(url, token);
  const list = data.list || data.hashtag_list || data.recommend_list || [];
  return list
    .map((h) => ({
      id: h.hashtag_id ?? h.id ?? null,
      name: h.hashtag_name ?? h.name ?? String(h),
      views: num(h.views),
      posts: num(h.posts),
    }))
    .filter((h) => h.name);
}

/* ------------------------------------------------------------------ *
 * Who used it  (advertiser token)
 * ------------------------------------------------------------------ */

/**
 * Top videos for up to 10 hashtag ids, 20 videos each.
 *
 * Known limitation: `country_code` must be one of the hashtag's own
 * top_country_list, so for a hashtag where Egypt is not in the global top five
 * this falls back to whatever market IS listed. We record which country was
 * actually used so the dashboard can say so rather than implying EG data.
 */
export async function hashtagVideos({ token, advertiserId, hashtagIds, country = 'EG' }) {
  const url = `${BASE}/discovery/video_list/?${qs({
    advertiser_id: advertiserId,
    hashtag_ids: JSON.stringify(hashtagIds.slice(0, 10)),
    country_code: country,
  })}`;
  const data = await call(url, token);
  return (data.list || []).map((v) => ({
    hashtagId: v.hashtag_id,
    videoId: v.video_id,
    shareUrl: v.share_url,
    embedUrl: v.embed_url,
    creator: creatorFromUrl(v.share_url),
    countryUsed: country,
  }));
}

/**
 * TikTok's Discovery API does not hand back creator objects, but the share URL
 * is shaped https://www.tiktok.com/@handle/video/123… so the handle is right there.
 * That is how the "who has used this" column gets populated for free.
 */
export function creatorFromUrl(shareUrl) {
  const m = /tiktok\.com\/@([\w.\-]+)/i.exec(String(shareUrl || ''));
  if (!m) return null;
  return { handle: `@${m[1]}`, profileUrl: `https://www.tiktok.com/@${m[1]}` };
}

/* ------------------------------------------------------------------ *
 * Commercial Music Library sounds  (account token)
 * ------------------------------------------------------------------ */

export async function trendingSounds({ token, businessId, country = 'EG', dateRange = '7DAY', genre = 'ALL' }) {
  const url = `${BASE}/discovery/cml/trending_list/?${qs({
    business_id: businessId,
    country_code: country,
    date_range: dateRange,
    genre,
  })}`;
  const data = await call(url, token);
  const list = data.list || data.music_list || [];

  return list.map((m) => ({
    key: `sound:${m.commercial_music_id || m.commercial_music_name}`,
    id: m.commercial_music_id,
    label: m.commercial_music_name,
    artist: m.artist,
    genre: Array.isArray(m.genres) ? m.genres.join(', ') : m.genres || genre,
    durationSec: num(m.duration),
    rank: num(m.rank_position),
    thumbnail: m.thumbnail_url,
    previewUrl: m.preview_url, // documented as non-expiring
    // The clip id is what makes this loop closeable: it can be passed as
    // music_sound_id to /business/video/publish/, so a detected sound becomes a post.
    songClipId:
      m.trending_song_clip?.song_clip_id || m.full_duration_song_clip?.song_clip_id || null,
    reportedHistory: (m.trending_history || []).map((p) => ({
      date: p.date,
      rank: num(p.rank_position_daily),
    })),
    genreQueried: genre,
    source: 'tiktok-cml',
    // Every track in the CML is pre-cleared for brand use. This is the whole
    // reason to prefer this endpoint over any raw sound chart.
    commercialSafe: true,
  }));
}

/** Videos using a given CML track — the influencer list for sounds. */
export async function soundVideos({ token, businessId, musicIds, country = 'EG' }) {
  const url = `${BASE}/discovery/cml/video_list/?${qs({
    business_id: businessId,
    commercial_music_ids: JSON.stringify(musicIds.slice(0, 10)),
    country_code: country,
  })}`;
  const data = await call(url, token);
  return (data.list || []).map((v) => ({
    musicId: v.commercial_music_id,
    videoId: v.video_id,
    shareUrl: v.share_url,
    embedUrl: v.embed_url,
    creator: creatorFromUrl(v.share_url),
    countryUsed: country,
  }));
}

/* ------------------------------------------------------------------ *
 * Trending search keywords  (account token)
 * ------------------------------------------------------------------ */

/**
 * Returns 20 keyword strings and nothing else — no volume, no rank change, no
 * history, and no country parameter (geography is implied by the authorising
 * Business Account). Treat as a hint list, not a metric. We synthesise a rank
 * from array order purely so the momentum engine can track entries and exits.
 */
export async function trendingKeywords({ token, businessId, personalized = false }) {
  const url = `${BASE}/discovery/trending/search/?${qs({
    business_id: businessId,
    is_personalized: personalized,
  })}`;
  const data = await call(url, token);
  const words = data.search_keywords || data.list || [];
  return words.map((w, i) => ({
    key: `kw:${String(w).toLowerCase()}`,
    label: String(w),
    rank: i + 1,
    views: null,
    posts: null,
    source: 'tiktok-search',
    note: 'Order only — this endpoint returns no volume and no country filter',
    commercialSafe: true,
  }));
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
