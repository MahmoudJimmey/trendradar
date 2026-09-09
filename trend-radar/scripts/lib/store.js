/**
 * Snapshot store.
 *
 * Every collection run writes two things:
 *   data/snapshots/<YYYY-MM-DD>.json   the raw payload for that day, never rewritten
 *   data/history.json                  a compact per-item rank series used for momentum
 *
 * The snapshot files are the audit trail. history.json is the working set the
 * momentum engine reads, trimmed to a rolling window so the repo stays small.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const HISTORY_WINDOW_DAYS = 45;

export function paths(root = process.cwd()) {
  const dataDir = path.join(root, 'data');
  return {
    dataDir,
    snapshotsDir: path.join(dataDir, 'snapshots'),
    latest: path.join(dataDir, 'latest.json'),
    history: path.join(dataDir, 'history.json'),
    manualLog: path.join(dataDir, 'manual-log.json'),
    // Rolling n-gram counts, used to tell a spiking phrase from a busy one.
    corpus: path.join(dataDir, 'corpus.json'),
    seeds: path.join(dataDir, 'seeds.json'),
  };
}

export function today() {
  // Africa/Cairo, so a run at 07:00 local files under the local date.
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * Merge today's rows into the rolling history.
 * `sections` is { sounds: [...], hashtags: [...], ... } of enriched-or-raw rows.
 */
export function mergeHistory(history, sections, date) {
  const next = { ...history };
  for (const [section, rows] of Object.entries(sections)) {
    if (!Array.isArray(rows)) continue;
    next[section] = next[section] || {};
    for (const row of rows) {
      if (!row?.key) continue;
      const series = (next[section][row.key] || []).filter((p) => p.date !== date);
      series.push({
        date,
        rank: row.rank ?? null,
        views: row.views ?? null,
        posts: row.posts ?? null,
      });
      series.sort((a, b) => (a.date < b.date ? -1 : 1));
      next[section][row.key] = trim(series, date);
      // Keep the human-readable label alongside the series so dropouts can be named.
      next[section][row.key].label = row.label;
    }
  }
  return next;
}

function trim(series, date) {
  const cutoff = new Date(new Date(date) - HISTORY_WINDOW_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const kept = series.filter((p) => p.date >= cutoff);
  // Preserve the array-with-label shape.
  return kept;
}

/** Section of history in the flat { key: series } shape the momentum engine wants. */
export function sectionHistory(history, section) {
  const src = history?.[section] || {};
  const out = {};
  for (const [key, series] of Object.entries(src)) {
    if (!Array.isArray(series)) continue;
    const arr = series.slice();
    arr.label = series.label;
    out[key] = arr;
  }
  return out;
}

/** How many distinct days of history exist — drives the "needs N more days" notice. */
export async function snapshotDates(snapshotsDir) {
  try {
    const files = await readdir(snapshotsDir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace('.json', ''))
      .sort();
  } catch {
    return [];
  }
}
