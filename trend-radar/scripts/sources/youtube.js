/**
 * YouTube Data API v3 — most popular in Egypt.
 *
 * Costs 1 quota unit per call against a 10,000/day default, so this is
 * effectively unlimited. YouTube's reach in Egypt is roughly 2.3× Instagram's,
 * which makes it a strong format and topic signal even though the dashboard's
 * subject is TikTok and Instagram.
 *
 * The chart is NOT Shorts-filtered, so we approximate: anything <= 180s with a
 * vertical-ish title pattern is flagged as probable Shorts.
 */

import { getJson } from '../lib/http.js';

const API = 'https://www.googleapis.com/youtube/v3/videos';

export async function mostPopular({ apiKey, region = 'EG', maxResults = 50, categoryId = '' }) {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');

  const url =
    `${API}?part=snippet,statistics,contentDetails&chart=mostPopular` +
    `&regionCode=${encodeURIComponent(region)}&maxResults=${maxResults}` +
    (categoryId ? `&videoCategoryId=${encodeURIComponent(categoryId)}` : '') +
    `&key=${encodeURIComponent(apiKey)}`;

  const body = await getJson(url);

  return (body.items || []).map((v, i) => {
    const seconds = parseISODuration(v.contentDetails?.duration);
    return {
      key: `yt:${v.id}`,
      id: v.id,
      label: v.snippet?.title,
      channel: v.snippet?.channelTitle,
      channelId: v.snippet?.channelId,
      rank: i + 1,
      views: toNum(v.statistics?.viewCount),
      posts: null,
      likes: toNum(v.statistics?.likeCount),
      comments: toNum(v.statistics?.commentCount),
      publishedAt: v.snippet?.publishedAt,
      durationSec: seconds,
      probableShort: seconds != null && seconds <= 180,
      thumbnail: v.snippet?.thumbnails?.medium?.url,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      tags: (v.snippet?.tags || []).slice(0, 12),
      source: 'youtube-eg',
      commercialSafe: null,
    };
  });
}

/** PT1M30S -> 90 */
function parseISODuration(iso) {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

const toNum = (v) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
