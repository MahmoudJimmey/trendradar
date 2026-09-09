/**
 * Minimal HTTP helpers. No dependencies — Node 20+ native fetch only.
 */

const UA = 'trend-radar/1.0 (+https://github.com)';

/** Sleep for ms. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with timeout and retry on transient failures (429 / 5xx / network).
 * Returns the Response. Throws on final failure.
 */
export async function request(url, opts = {}) {
  const { retries = 2, timeoutMs = 20000, headers = {}, ...rest } = opts;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, ...headers },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${hostOf(url)}`);
        if (attempt < retries) {
          await sleep(1200 * (attempt + 1));
          continue;
        }
        return res;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** GET and parse JSON. Throws with a readable message on non-2xx or bad JSON. */
export async function getJson(url, opts = {}) {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${hostOf(url)}: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${hostOf(url)}: ${text.slice(0, 240)}`);
  }
}

/** GET and return raw text (for RSS/HTML sources). */
export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${hostOf(url)}`);
  return text;
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Extract repeated tag contents from a simple XML/RSS document.
 * RSS from Google Trends is regular enough that a parser dependency is not worth it.
 */
export function xmlItems(xml, itemTag = 'item') {
  const out = [];
  const re = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)</${itemTag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Read the first occurrence of <tag>…</tag> from an XML fragment, CDATA-aware. */
export function xmlTag(fragment, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(fragment);
  if (!m) return null;
  return decodeEntities(
    m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim()
  );
}

/** Read all occurrences of <tag>…</tag>. */
export function xmlTagAll(fragment, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(fragment)) !== null) {
    out.push(
      decodeEntities(m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim())
    );
  }
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** "100+" / "10,000+" / "1.2K" -> integer. Returns null when unparseable. */
export function parseApproxNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[+,\s]/g, '');
  const m = /^([\d.]+)([KMB])?$/i.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(n * mult);
}
