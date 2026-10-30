// Reads ../index.json and emits dashboard/data.json: the flattened, chart-ready
// view of the market that the dashboard renders. Run from the repo root:
//   node dashboard/prep.mjs
//
// Output is 2-space-indented JSON, except the plugins array: one compact object
// per line, so the file stays diffable per plugin without paying for indentation
// on 4557 entries.
import { readFile, writeFile, stat } from "node:fs/promises";
import { WEIGHTS, FRESHNESS_TIERS, decompose } from "../score-model.mjs";

const INDEX = new URL("../index.json", import.meta.url);
const OUT = new URL("./data.json", import.meta.url);
const DESC_MAX = 120;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v) => (typeof v === "string" ? v : "");
const round1 = (v) => Math.round(v * 10) / 10;
const median = (sorted) => {
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const byCountDesc = (a, b) => b.count - a.count || a.id.localeCompare(b.id);

const raw = await readFile(INDEX, "utf8");
const indexBytes = (await stat(INDEX)).size;
const index = JSON.parse(raw);
const P = index.plugins;
const catMeta = index.metadata?.categories || {};
const labelMeta = index.metadata?.labels || {};

const plugins = [];
const catAgg = new Map();
const labelAgg = new Map();
const corpus = {
  npm: 0, git: 0, withStars: 0, withDownloads: 0,
  medianAge: 0, maxAge: 0, maxScore: 0, maxStars: 0, maxDownloads: 0, sumScore: 0,
};
const ages = [];
let decomposeMismatch = 0;
let maxDelta = 0;
let maxRelative = 0;

for (const p of P) {
  const sk = p.metadata?.sortKeys || {};
  const src = p.versions?.[0]?.source || {};

  const stars = num(sk.stars);
  const downloads = num(sk.downloads);
  const age = typeof sk.age === "number" && Number.isFinite(sk.age) ? sk.age : 999;
  const score = num(sk.score);

  // index.json stores a rounded integer age, so re-deriving the score from it
  // cannot be exact: momentum is stars/age and the fractional part is gone.
  const contrib = decompose({ stars, downloads, age });
  const delta = Math.abs(contrib.total - score);
  if (delta > 2) decomposeMismatch++;
  if (delta > maxDelta) {
    maxDelta = delta;
    maxRelative = delta / Math.max(score, 1);
  }

  const cat = str(p.metadata?.category) || "tools";
  const labels = Array.isArray(p.metadata?.labels) ? p.metadata.labels.map(str) : [];
  const source = src.type === "git" ? "git" : "npm";
  const desc = (str(p.description?.zh) || str(p.description?.en)).trim().replace(/\s+/g, " ").slice(0, DESC_MAX);

  const row = {
    name: str(p.name),
    cat,
    author: str(p.author),
    score,
    stars,
    downloads,
    age,
    labels,
    source,
  };
  // npm entries link through homepage; only git entries need the repo URL
  if (source === "git") row.repo = str(p.repository?.url);
  row.homepage = str(p.homepage);
  row.desc = desc;
  row.contrib = {
    stars: round1(contrib.stars),
    downloads: round1(contrib.downloads),
    freshness: round1(contrib.freshness),
    momentum: round1(contrib.momentum),
  };
  plugins.push(row);

  ages.push(age);
  corpus[source]++;
  if (stars > 0) corpus.withStars++;
  if (downloads > 0) corpus.withDownloads++;
  if (age > corpus.maxAge) corpus.maxAge = age;
  if (score > corpus.maxScore) corpus.maxScore = score;
  if (stars > corpus.maxStars) corpus.maxStars = stars;
  if (downloads > corpus.maxDownloads) corpus.maxDownloads = downloads;
  corpus.sumScore += score;

  let c = catAgg.get(cat);
  if (!c) catAgg.set(cat, (c = { count: 0, scores: [], stars: [] }));
  c.count++;
  c.scores.push(score);
  c.stars.push(stars);

  for (const l of labels) labelAgg.set(l, (labelAgg.get(l) || 0) + 1);
}

ages.sort((a, b) => a - b);
corpus.medianAge = Math.round(median(ages));

plugins.sort((a, b) => b.score - a.score);

// the taxonomy from index.json, plus any category a plugin actually carries
const categories = [];
for (const id of new Set([...Object.keys(catMeta), ...catAgg.keys()])) {
  const agg = catAgg.get(id);
  const title = catMeta[id]?.title || {};
  categories.push({
    id,
    en: str(title.en) || id,
    zh: str(title.zh) || str(title.en) || id,
    count: agg ? agg.count : 0,
    medianScore: agg ? Math.round(median([...agg.scores].sort((a, b) => a - b))) : 0,
    medianStars: agg ? Math.round(median([...agg.stars].sort((a, b) => a - b))) : 0,
  });
}
categories.sort(byCountDesc);

const labels = [];
for (const id of new Set([...Object.keys(labelMeta), ...labelAgg.keys()])) {
  const title = labelMeta[id]?.title || {};
  labels.push({
    id,
    en: str(title.en) || id,
    zh: str(title.zh) || str(title.en) || id,
    count: labelAgg.get(id) || 0,
  });
}
labels.sort(byCountDesc);

const head = {
  generatedAt: Date.now(),
  source: {
    title: { en: str(index.title?.en), zh: str(index.title?.zh) },
    description: { en: str(index.description?.en), zh: str(index.description?.zh) },
    count: P.length,
    indexBytes,
    format: 1,
  },
  model: { weights: WEIGHTS, freshnessTiers: FRESHNESS_TIERS },
  corpus,
  categories,
  labels,
};
const tail = {
  check: { decomposeMismatch, maxDelta, maxRelative: Number(maxRelative.toFixed(6)) },
};

const text = [
  "{",
  JSON.stringify(head, null, 2).slice(2, -2) + ",",
  '  "plugins": [',
  plugins.map((p) => "    " + JSON.stringify(p)).join(",\n"),
  "  ],",
  JSON.stringify(tail, null, 2).slice(2, -2),
  "}",
  "",
].join("\n");
await writeFile(OUT, text);

const bytes = Buffer.byteLength(text);
console.log(`data.json: ${(bytes / 1048576).toFixed(2)} MB (${bytes} bytes), ${plugins.length} plugins, ${categories.length} categories, ${labels.length} labels`);
console.log(`corpus: ${JSON.stringify(corpus)}`);
console.log(`check: ${JSON.stringify(tail.check)}`);
