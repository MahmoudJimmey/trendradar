/**
 * Google Trends — Egypt.
 *
 * Two surfaces:
 *   1. The public Trending Now RSS feed. No key, no auth, Arabic queries with
 *      traffic estimates. This is the zero-friction Egyptian demand signal.
 *   2. The official Trends Research API (v1beta), which adds getRisingQueries /
 *      getRisingTopics with geo=EG and a `youtube` property filter. Access is
 *      gated; the collector uses it only when GOOGLE_TRENDS_API_KEY is present.
 *
 * Note: pytrends was archived in April 2025. Do not build on it.
 */

import { getText, getJson, xmlItems, xmlTag, xmlTagAll, parseApproxNumber } from '../lib/http.js';

const RSS = (geo) => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
const API = 'https://trends.googleapis.com/v1beta';

/** Trending Now for a country. Ranked by feed order; traffic is Google's own estimate. */
export async function trendingNow({ geo = 'EG' } = {}) {
  const xml = await getText(RSS(geo));
  const items = xmlItems(xml, 'item');

  return items.map((frag, i) => {
    const title = xmlTag(frag, 'title');
    const traffic = xmlTag(frag, 'ht:approx_traffic');
    const newsTitles = xmlTagAll(frag, 'ht:news_item_title');
    const newsUrls = xmlTagAll(frag, 'ht:news_item_url');
    const newsSources = xmlTagAll(frag, 'ht:news_item_source');

    return {
      key: `gtrend:${String(title).toLowerCase()}`,
      label: title,
      rank: i + 1,
      views: parseApproxNumber(traffic), // reuse the views slot so momentum math applies
      posts: null,
      approxTraffic: traffic,
      pubDate: xmlTag(frag, 'pubDate'),
      image: xmlTag(frag, 'ht:picture'),
      // Why is this trending? The attached news items usually answer it outright,
      // which is what turns a rising query into a content idea.
      why: newsTitles.slice(0, 3).map((t, n) => ({
        title: t,
        url: newsUrls[n] || null,
        source: newsSources[n] || null,
      })),
      isRTL: /[؀-ۿ]/.test(String(title)),
      source: 'google-trends',
      commercialSafe: true,
    };
  });
}

/**
 * Rising queries from the official API for a set of seed terms — your compounds,
 * competitor project names, "شقق التجمع", and so on. Optional; needs a key.
 */
export async function risingQueries({ apiKey, terms, geo = 'EG', property = '' }) {
  if (!apiKey || !terms?.length) return [];
  const out = [];
  for (const term of terms) {
    const url =
      `${API}/getRisingQueries?key=${encodeURIComponent(apiKey)}` +
      `&terms=${encodeURIComponent(term)}` +
      `&restrictions.geo=${encodeURIComponent(geo)}` +
      (property ? `&restrictions.property=${encodeURIComponent(property)}` : '');
    try {
      const body = await getJson(url);
      const rows = body.risingQueries || body.queries || [];
      rows.forEach((r, i) => {
        out.push({
          key: `grise:${term}:${String(r.query || r.term).toLowerCase()}`,
          label: r.query || r.term,
          seed: term,
          rank: i + 1,
          views: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
          posts: null,
          source: 'google-trends-api',
          commercialSafe: true,
        });
      });
    } catch (err) {
      out.push({ key: `grise:${term}:error`, label: term, error: err.message, source: 'google-trends-api' });
    }
  }
  return out.filter((r) => !r.error);
}
