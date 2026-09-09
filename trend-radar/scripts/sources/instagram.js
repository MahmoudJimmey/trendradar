/**
 * Instagram — the honest version.
 *
 * Meta ships GET /ig_audio, and with no search_query it returns trending sounds.
 * But read what it does NOT return: no use count, no rank, no velocity, no
 * history, and no country parameter. The catalogue is also licensing-filtered,
 * so it differs from what Egyptian users actually hear in the app.
 *
 * On top of that, Instagram media objects carry no audio field at all — so the
 * API can never tell you which sound made a Reel work. That is why the dashboard
 * keeps an explicit manual log for Instagram and labels these rows as unranked.
 *
 * Requires Facebook Login (NOT Instagram Login) and a Business/Creator account
 * with a connected Facebook Page.
 */

import { getJson } from '../lib/http.js';

// Overridable, because a Meta app pinned to an older version will 404 on a
// newer path and the error looks like "no data" rather than "wrong version".
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v23.0'}`;

/**
 * Meta returns rich, actionable errors and then everything upstream flattens
 * them into "request failed". These are the causes that actually happen with
 * /ig_audio, mapped to what to do about each — because "Instagram audio got no
 * data" is the least useful thing a dashboard can tell you.
 */
export function diagnose(raw) {
  const text = String(raw || '');
  let err = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) err = JSON.parse(m[0]).error || {};
  } catch { /* not JSON — fall through to substring matching */ }

  const code = err.code ?? null;
  const sub = err.error_subcode ?? null;
  const msg = err.message || text;

  const hint = (() => {
    if (code === 190 || /access token/i.test(msg)) {
      return 'Token is invalid or expired. IG_ACCESS_TOKEN must be a long-lived Page token from FACEBOOK Login — Instagram Login tokens do not work on this endpoint at all.';
    }
    if (code === 200 || code === 10 || /permission/i.test(msg)) {
      return 'Missing permissions. This needs instagram_basic + instagram_content_publish, and Advanced Access via App Review to read anything beyond your own test account.';
    }
    if (code === 100 && /nonexisting field|unknown field/i.test(msg)) {
      return 'A requested field is not available on this Graph version. Set GRAPH_VERSION to the version your Meta app is pinned to.';
    }
    if (code === 100 && /user_id/i.test(msg)) {
      return 'IG_USER_ID looks wrong. It must be the Instagram *professional account* ID (from the connected Page), not your @handle and not the Facebook user ID.';
    }
    if (code === 803 || /does not exist|cannot be loaded/i.test(msg)) {
      return 'The account ID resolved to nothing. Confirm the Instagram account is Business or Creator AND linked to a Facebook Page.';
    }
    if (code === 4 || code === 17 || code === 32 || /rate limit/i.test(msg)) {
      return 'Rate limited. Instagram\'s budget is 4800 x impressions per 24h, so a low-reach account has a small daily allowance.';
    }
    if (/HTTP 404/i.test(text)) {
      return 'Endpoint 404. Either the Graph version predates the Audio API (needs v22.0+) or the account cannot access it.';
    }
    return null;
  })();

  return {
    code, subcode: sub, message: msg,
    hint: hint || 'Unrecognised error — check the raw message against Meta\'s error reference.',
  };
}

const FIELDS = [
  'id',
  'title',
  'display_artist',
  'duration_in_ms',
  'audio_type',
  'cover_artwork_thumbnail_uri',
  'on_platform_audio_preview_link',
  'is_ads_eligible',
].join(',');

/**
 * Trending audio. `audioType` is 'music' or 'original_sound'.
 * Order is Meta's own ranking, so we use array position as a rank surrogate —
 * clearly labelled as such, because it is not a published metric.
 */
export async function trendingAudio({ token, igUserId, audioType = 'music' }) {
  if (!token || !igUserId) throw new Error('IG_ACCESS_TOKEN / IG_USER_ID not set');

  const url =
    `${GRAPH}/ig_audio?audio_type=${encodeURIComponent(audioType)}` +
    `&user_id=${encodeURIComponent(igUserId)}` +
    `&fields=${FIELDS}&access_token=${encodeURIComponent(token)}`;

  let body;
  try {
    body = await getJson(url);
  } catch (err) {
    const d = diagnose(err.message);
    // Re-throw with the diagnosis attached, so the health panel says what to fix
    // instead of just that something broke.
    const wrapped = new Error(`${d.message}${d.code ? ` [code ${d.code}]` : ''} — ${d.hint}`);
    wrapped.diagnosis = d;
    throw wrapped;
  }

  const rows = body.data || [];

  // A 200 with an empty array is the most confusing outcome of all, so name the
  // usual cause rather than letting it read as "no trends today".
  if (!rows.length) {
    const e = new Error(
      `Endpoint returned 0 ${audioType} tracks. This is usually the account type: ` +
      'business accounts are cut off from most of the licensed music library, so ' +
      "audio_type=music comes back empty while original_sound still works. A Creator " +
      'account keeps broader access. Not a code failure — the call succeeded.'
    );
    e.emptyOk = true;
    throw e;
  }

  return rows.map((a, i) => ({
    key: `igaudio:${a.id}`,
    id: a.id,
    label: a.title,
    artist: a.display_artist || a.ig_username || null,
    rank: i + 1,
    rankIsOrderOnly: true, // Meta publishes no rank; this is array position
    views: null,
    posts: null,
    durationSec: a.duration_in_ms ? Math.round(a.duration_in_ms / 1000) : null,
    audioType: a.audio_type || audioType,
    artwork: a.cover_artwork_thumbnail_uri,
    previewUrl: a.on_platform_audio_preview_link,
    adsEligible: a.is_ads_eligible ?? null,
    // is_ads_eligible is the closest thing Instagram gives to a commercial-use flag.
    commercialSafe: a.is_ads_eligible === true ? true : null,
    geoNote: 'No country filter exists on this endpoint — treat as global',
    source: 'instagram-audio',
  }));
}

/**
 * Public engagement on a fixed panel of competitor accounts, via Business
 * Discovery. This is the most under-rated free asset in the whole stack: Meta
 * will not give you Egyptian trends, but it will let you watch which formats are
 * working for the Egyptian accounts you care about, over time.
 */
export async function competitorPanel({ token, igUserId, handles, perAccount = 12 }) {
  if (!token || !igUserId) throw new Error('IG_ACCESS_TOKEN / IG_USER_ID not set');
  const out = [];

  for (const handle of handles) {
    const clean = handle.replace(/^@/, '');
    const fields =
      `business_discovery.username(${clean}){followers_count,media_count,` +
      `media.limit(${perAccount}){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`;
    const url =
      `${GRAPH}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}` +
      `&access_token=${encodeURIComponent(token)}`;
    try {
      const body = await getJson(url);
      const bd = body.business_discovery || {};
      const media = bd.media?.data || [];
      const reels = media.filter((m) => m.media_product_type === 'REELS');
      const avgEng =
        media.length > 0
          ? Math.round(
              media.reduce((s, m) => s + (m.like_count || 0) + (m.comments_count || 0), 0) /
                media.length
            )
          : null;

      out.push({
        key: `igacct:${clean}`,
        label: `@${clean}`,
        followers: bd.followers_count ?? null,
        mediaCount: bd.media_count ?? null,
        avgEngagementPerPost: avgEng,
        reelShare: media.length ? Math.round((reels.length / media.length) * 100) : null,
        topPosts: [...media]
          .sort(
            (a, b) =>
              (b.like_count || 0) + (b.comments_count || 0) -
              ((a.like_count || 0) + (a.comments_count || 0))
          )
          .slice(0, 3)
          .map((m) => ({
            permalink: m.permalink,
            type: m.media_product_type || m.media_type,
            likes: m.like_count ?? null,
            comments: m.comments_count ?? null,
            timestamp: m.timestamp,
            caption: (m.caption || '').slice(0, 140),
          })),
        source: 'instagram-business-discovery',
      });
    } catch (err) {
      out.push({ key: `igacct:${clean}`, label: `@${clean}`, error: err.message, source: 'instagram-business-discovery' });
    }
  }
  return out;
}
