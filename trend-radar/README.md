# Trend Radar — Egypt

Daily trending **sounds**, **hashtags**, **search keywords** and **formats** for TikTok
and Instagram in the Egyptian market, with day-over-day momentum so you can tell a
trend that is still climbing from one you have already missed.

No server. GitHub Actions collects once a day and commits a dated JSON snapshot;
GitHub Pages serves a static dashboard that reads it. Because every snapshot is a
commit, the day-over-day comparison you asked for comes free — and the whole history
is auditable in `git log`.

---

## What it tracks

| Tab | Source | What you get |
|---|---|---|
| **Formats** | derived from every other feed | Emerging **challenges and formats** — the 80s challenge, before/after, room tours — detected as phrases spiking across feeds, not as single hashtags. See below |
| **Sounds** | TikTok Discovery API — Commercial Music Library | Top 100 **pre-cleared** tracks per country, rank + 30-day history, `ARABIC_POP` genre, publishable clip ID |
| **Hashtags** | TikTok Discovery API | Top 200 hashtags, rank change, views, posts, 30-day history, swept across 6 industry categories |
| **TikTok search** | TikTok Discovery API | 20 trending search keywords (order only — no volume, no geo) |
| **Google Egypt** | Google Trends RSS `geo=EG` | Live Arabic queries with traffic estimates **and why they are trending** |
| **Apple Music EG** | Apple RSS Marketing Tools | Daily Egyptian most-played — the cross-check on TikTok sound hype |
| **Instagram audio** | Meta `/ig_audio` | Trending sound names. Meta publishes no metrics and no country filter — the tab says so |
| **YouTube EG** | YouTube Data API v3 | Most popular in Egypt, with probable-Shorts flagged |
| **Fell off** | derived | What was charting and is now gone — the window shut |

---

## Finding formats and challenges

A sound is a thing. A **format** is an idea — "the 80s challenge", "before and after",
"POV: you just got the keys" — and it shows up as a hashtag *and* a sound *and* a
caption pattern *and* a search query, all at once. By the time `#80schallenge` is in a
top-200 hashtag list you are late, so the Formats tab does not wait for that.

Three mechanisms, all in `scripts/lib/formats.js`:

**1. Archetype classification.** Every hashtag, keyword and query is matched against a
taxonomy of ~19 repeatable format shapes — challenge, era/decade, transition,
before/after, POV, GRWM, tour, ranking, versus, expectation-vs-reality, day-in-the-life,
how-to, duet bait, storytime, reveal, rate-mine, aesthetic/-core, ASMR — in **Arabic and
English**. Each archetype carries a one-line playbook for real estate and for automotive,
because knowing `#80s` is spiking is trivia until you know what to shoot on Sunday.

**2. Spike detection across feeds.** Everything the collector already gathered — hashtag
names, TikTok search keywords, Google Egypt queries, YouTube titles and tags, sound
titles — is tokenised into 1- and 2-grams, weighted by prominence (a #3 hashtag counts
more than a #180 one), and scored against its own trailing 10-day baseline. What surfaces
is **lift**, not volume. Crucially it also scores **breadth**: how many independent feeds
carry the phrase today. A phrase in the hashtag chart *and* Egyptian search *and* a sound
title is a real format; one that only exists in a single feed is that feed's noise.

Concatenated hashtags are split where the seam is guessable (`80schallenge` →
`80s` + `challenge`), and Arabic is normalised — letter forms folded (أإآ→ا, ى→ي, ة→ه),
diacritics stripped, underscores treated as spaces — so `#العاصمة_الادارية` and
`العاصمة الإدارية` are the same phrase. Without that, roughly half the Egyptian hashtags
score zero.

**3. Merging and clustering.** One breaking trend otherwise produces nine rows — `80s`,
`80s challenge`, `challenge`, `تحدي`, `تحدي الثمانينات`, `الثمانينات`, `retro`,
`80s retro`, `nights 80s` — and buries everything else. Phrases are merged when their
alias sets overlap, when one contains the other, or when they point at the same hashtag
or sound. **Known cross-script pairs are merged too** (`80s`/`الثمانينات`,
`challenge`/`تحدي`, `قبل وبعد`/`before after`), which matters because otherwise every
Egyptian format splits in half. Merging also *improves* the signal: breadth becomes the
union across variants, so the trend gets credited with all four feeds instead of being
split between them.

Each surviving row then gets its cluster attached: the charting hashtags, the sounds
(with a flag if one is **Commercial-Music-Library cleared**, i.e. legally usable by a
brand account), the Egyptian search queries, TikTok's own related-hashtag suggestions,
and the creators already running it.

### Watch terms

Detection only sees what the feeds carry. When you spot something before it charts, add
it to **`data/seeds.json`** — each term is probed through TikTok's related-hashtag
recommender on every run and stays visible on the Formats tab even on a quiet day, so a
term you are watching never silently vanishes. Keep the list short and delete anything
that has been `fading` for two weeks.

### What the Formats columns mean

| Column | Meaning |
|---|---|
| **Spike** | Today's weighted mentions over the phrase's own trailing baseline. `×24` means 24 times its normal level. |
| **Feeds** | How many of the five feeds carry it today. **3+ is the strongest quality signal on the page.** |
| **Seen in** | Which feeds specifically. |
| **Attached to** | The concrete hashtags, sounds and queries it clusters with. "Nothing charting yet" means it is a lead, not a confirmed trend. |
| **Sound** | Whether a cleared CML sound is already attached, so you could post today without a licensing problem. |
| **Status** | `brand new` → `spiking` → `spreading` → `building` → `steady` → `fading`, plus `watching` for seed terms with no spike. |

### Honest limits

- **Effects and filters are invisible here.** A lot of challenges are built on a specific
  effect, and no official API we can access exposes effect data — TikTok's Research API
  does, and we are ineligible. Effects have to be spotted by hand.
- **It detects language, not video structure.** If a format spreads without a
  distinctive phrase attached, this will not see it. That is what the daily manual scan
  and the Watchlist are for.
- **Two days of history minimum.** On day one everything looks new, because it is. Lift
  becomes meaningful from about day four.

## The metrics, and why each one is there

Rank alone is close to useless: by the time something is #1 you are late. These are
the derived columns, all computed in `scripts/lib/momentum.js`.

| Metric | What it answers |
|---|---|
| **vs yesterday / vs 7d** | Direction and size of the move. Positive means it climbed. |
| **Velocity** | Places gained per day over the last three days. The headline number. |
| **Acceleration** | Is the climb speeding up or flattening? Reported `null` until ~6 days of history — better than a figure that just restates velocity. |
| **Age** | Days on the chart. A 2-day-old #14 is a very different bet from a 12-day-old #14. |
| **Runway (est.)** | Rough days left, from a ~16-day cycle budget minus days already spent, cut for saturation and decline. A heuristic, labelled as one. |
| **Crowding** | Are creators piling in faster than viewers are showing up? High crowding means you would be the thousandth post, not the tenth. |
| **Stage** | `emerging → rising → peaking → flat → fading → gone`. |
| **Call** | `act now`, `ride fast`, `monitor`, `too late`, `blocked`, `skip`. Deliberately blunt. |
| **Licence** | Is the sound in TikTok's Commercial Music Library? For a brand account this is the difference between usable and unusable, whatever the numbers say. |
| **Confirmed** | Charting on TikTok **and** Apple Music Egypt. Independent demand usually means a longer runway than a TikTok-only spike. |
| **Fit** | Matched against real-estate and automotive term lists — with Arabic normalisation, so `#العاصمة_الادارية` and `العاصمة الإدارية` match each other. |
| **Who used it** | Creator handles, parsed out of the share URLs TikTok returns. |
| **Best ever / days since peak** | Whether today's rank is the top of the arc or the far side of it. |
| **Fell off** | Dropping off the chart is a signal in its own right. |

### Things worth knowing before you trust a number

- **Store the sound ID when you post.** Neither TikTok's Display API nor Instagram's
  media object carries an audio field, so nothing will tell you later which sound a
  post used. The sound drawer surfaces `songClipId` for exactly this reason.
- **Instagram audio has no metrics and no country filter.** Meta ships the endpoint but
  publishes no counts, rank, velocity or geography, and the catalogue is
  licensing-filtered so it differs from what Egyptian users actually hear. That tab is
  a shortlist, not a ranking — use the Watchlist for Instagram.

### If the Instagram audio tab is empty

It is empty more often than any other source. In rough order of likelihood:

1. **Instagram Login instead of Facebook Login.** `/ig_audio` is *not supported* on the
   Instagram API with Instagram Login — full stop. The token must come from **Facebook
   Login for Business**, on a Business/Creator account with a connected Facebook Page.
2. **Account type.** Business accounts are cut off from most of Meta's licensed music
   library, so `audio_type=music` returns an empty array while `original_sound` still
   works. The collector requests both types independently for exactly this reason, and a
   Creator account keeps broader access.
3. **Wrong `IG_USER_ID`.** It must be the Instagram *professional account* ID reached
   through the connected Page — not the @handle, not the Facebook user ID.
4. **No Advanced Access.** Without App Review you can only read your own test account.
5. **Graph version.** The Audio API needs v22.0+. Set `GRAPH_VERSION` if your app is
   pinned to something older; a version mismatch surfaces as a "nonexisting field" error
   that reads like missing data.

The dashboard now tells you which of these it hit: Meta's error code and message are
parsed and shown, with the specific fix, both in the empty tab and in Source health. A
200 response carrying an empty array is reported as `skipped` with the account-type
explanation rather than as a failure, because the call did succeed.

**Set expectations before you spend a day on it:** even fully working, this returns
*names only*. It cannot be turned into an Egypt-specific ranking, because Meta does not
publish one. Instagram is the tab you work by hand — the in-app **Edits** feed is the
only Meta surface that shows trending Reels with real view, like and share counts.
- **Creator examples may come from another market.** TikTok restricts hashtag video
  lookups to that hashtag's own top-five countries. Each example records `countryUsed`.
- **Link the profile, not the post.** Creator handles link to profiles, which survive;
  the separate `post ↗` link can legitimately show *"video isn't available"* when the
  creator deleted it, went private, or the post is region-locked. That is TikTok, not a
  bug — open the profile instead. Sample-data creators are obvious placeholders
  (`@example-creator-a`) with no links at all, so nothing fake is ever clickable.
- **Crowding and runway are heuristics**, not platform metrics. They are there to tell
  you where to look, not to be quoted in a deck.

---

## Setup

### 1. Push it

```bash
git init && git add . && git commit -m "trend radar"
git branch -M main
git remote add origin git@github.com:<you>/trend-radar.git
git push -u origin main
```

### 2. Turn on Pages

**Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`.**
The dashboard is at `https://<you>.github.io/trend-radar/`.

### 3. Add secrets

**Settings → Secrets and variables → Actions → Secrets.** All optional; each missing
one just skips its source and says so in the dashboard's Source health panel.

| Secret | Unlocks |
|---|---|
| `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID` | Hashtags, hashtag videos, creator handles |
| `TIKTOK_ACCOUNT_TOKEN` + `TIKTOK_BUSINESS_ID` | Commercial Music Library sounds, search keywords |
| `YOUTUBE_API_KEY` | YouTube Egypt |
| `IG_ACCESS_TOKEN` + `IG_USER_ID` | Instagram audio + competitor panel |
| `GOOGLE_TRENDS_API_KEY` | Rising queries on your own seed terms |

And under **Variables** (not secrets — these are not sensitive):

| Variable | Example |
|---|---|
| `COUNTRY_CODE` | `EG` |
| `DATE_RANGE` | `7DAY` |
| `IG_COMPETITORS` | `@nawy.eg,@talaatmoustafagroup,@sodic.eg` |
| `TREND_SEED_TERMS` | `شقق التجمع,كمبوند العاصمة الادارية,الساحل الشمالي` |
| `CREATOR_LOOKUP_LIMIT` | `20` |

Google Trends Egypt and Apple Music Egypt need **no credentials at all** — they run on
the first push, so the dashboard has real Egyptian data before any token exists.

### 4. Local runs

```bash
node scripts/seed-sample.js   # writes clearly-labelled sample data
node scripts/collect.js       # real run; reads env vars
python3 -m http.server 8080   # then open http://localhost:8080
```

---

## The refresh button

Two buttons, because a static site cannot collect anything by itself.

- **Refresh** re-reads `data/latest.json`, cache-busted. Use it after a collection run.
- **Collect now** asks GitHub to run the workflow immediately via `workflow_dispatch`.
  It prompts once for `owner/repo` and a **fine-grained personal access token with
  `Actions: write` on this repository only**, then keeps both in your browser's
  localStorage. The token goes nowhere but `api.github.com`.

A collection takes about a minute; hit **Refresh** after. If you would rather not put
a token in a browser at all, run the workflow from the **Actions** tab instead — the
button is a convenience, not a dependency.

---

## How the data is stored

```
data/
├── latest.json              what the dashboard reads
├── history.json             rolling 45-day per-item rank series
├── manual-log.json          your committed decisions
└── snapshots/
    ├── 2026-09-09.json      never rewritten — the audit trail
    └── 2026-09-10.json
```

`latest.json` is a full snapshot including `summary`, `health`, every section, and
`dropouts`. `history.json` keeps only `{date, rank, views, posts}` per item so the repo
stays small — a year of daily collection is well under 100 MB, which is why this needs
no database.

TikTok returns up to 30 days of its own daily ranking in `trending_history`. The
collector folds that into `history.json` on the first run, so momentum works on day one
instead of after a fortnight of waiting. Your own snapshots always win on conflict.

---

## Watchlist

The feeds say what is trending. The Watchlist records **what you decided** — using /
shortlist / skip / too late, with a note and the rank at the time. That is the only
column that makes a review three months from now worth reading, and no API produces it.

Entries live in your browser. **Copy JSON** puts them on your clipboard; paste into
`data/manual-log.json`, commit, and they show up for everyone with a `repo` tag.

---

## Before you trust it: five things to verify

These could not be settled from documentation alone, and the first one is load-bearing.

1. **Does `country_code=EG` return data from Discovery?** Creative Center exposes Egypt
   in a 26-country list; the Marketing API location codes list is wider. Call
   `/discovery/trending_list/?country_code=EG&date_range=7DAY` and confirm it is
   non-empty before building process around this.
2. **Same for `/discovery/cml/trending_list/`** with `country_code=EG` and
   `genre=ARABIC_POP`. If Egyptian CML depth is thin, the sounds tab needs a paid
   substitute.
3. **Does a zero-spend advertiser ID work for Discovery?** No document says spend is
   required; none says it is not.
4. **How long does the Accounts API application form take?** Mandatory since 20 March
   2026, and it gates the sounds and keywords endpoints. Submit it first, build the
   hashtag half while it is pending.
5. **Is `/ig_audio`'s trending list geo-personalised?** There is no parameter and no
   statement either way. Test from an Egyptian Business account.

---

## Layout

```
index.html                  dashboard shell
assets/styles.css           tokens; light, dark and system themes
assets/app.js               rendering, filtering, sparklines, drawer, refresh
scripts/collect.js          orchestrator — one run, one snapshot
scripts/seed-sample.js      sample data generator
scripts/lib/momentum.js     velocity, stage, saturation, runway, crossover, relevance
scripts/lib/store.js        snapshot + rolling history
scripts/lib/http.js         fetch with retry, RSS parsing, number parsing
scripts/sources/*.js        one file per platform
.github/workflows/collect.yml
```

Zero dependencies. Node 20+ native `fetch` only, so `npm install` is not needed and
Actions has nothing to cache.
