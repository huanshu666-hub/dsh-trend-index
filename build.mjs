// DSH GitHub Trending Index — builds a format-1 plugin market index from the
// community catalog (awesome-dsh-plugin.com), adding trending sort keys the
// official index does not carry (it ships sortKeys: {} and labels: {}).
//
// Data: catalog plugins.json  ->  stars, downloads, added, capabilities, install
// Git sources: format 1 needs a pinned 40-hex commit; we read it from the
//              public commits.atom feed, which consumes NO GitHub API quota.
import { writeFile, readFile } from "node:fs/promises";

const CATALOG = "https://awesome-dsh-plugin.com/plugins.json";
const UA = "dsh-trend-index/1.0";
const OUT = new URL(process.env.OUT_DIR ? `../${process.env.OUT_DIR}/index.json` : "./index.json", import.meta.url);

const now = Math.floor(Date.now() / 1000);
const dayOf = (iso) => (Date.now() - Date.parse(iso)) / 86400e3;

async function get(url, asJson = false, timeout = 20000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return asJson ? res.json() : res.text();
}

// ---- 1. load catalog (cached on disk so rebuilds are offline-fast) ----
let catalog;
try {
  catalog = JSON.parse(await readFile(new URL("./catalog.json", import.meta.url), "utf8"));
  console.log(`catalog: cached ${catalog.plugins.length} entries (updated ${catalog.updated})`);
} catch {
  catalog = await get(CATALOG, true);
  await writeFile(new URL("./catalog.json", import.meta.url), JSON.stringify(catalog));
  console.log(`catalog: fetched ${catalog.plugins.length} entries (updated ${catalog.updated})`);
}
const P = catalog.plugins;

// ---- 2. score: pure popularity is useless (archify has 89k stars for other
//      projects); what makes a DSH plugin "trending" is momentum + freshness.
// format 1 wants { <id>: { title: { en, zh } } }; the catalog carries the bare
// localized text ({ <id>: { en, zh } }), so wrap it rather than shipping a
// document the host's own parser rejects.
const CATEGORIES = Object.fromEntries(
  Object.entries(catalog.categories || {}).map(([id, text]) => [id, { title: text }]),
);
function scoreOf(p) {
  const stars = p.stars ?? 0;
  const dl = p.downloads ?? 0;
  const age = p.added ? Math.max(dayOf(p.added), 1) : 365;
  const freshness = age <= 7 ? 3 : age <= 30 ? 2 : age <= 90 ? 1 : 0;
  // downloads are per ~30d window: a strong signal of actual installs
  return Math.round(stars * 0.6 + dl * 0.15 + freshness * 60 + Math.min(stars / age, 400) * 2);
}
for (const p of P) p._score = scoreOf(p);

// ---- 3. pick the entries worth pinning shas for: everything npm-installable
//      is free, git entries cost one atom fetch each.
const npmReady = P.filter((p) => p.npm && p.version);
const gitCandidates = P.filter((p) => !p.npm || !p.version).sort((a, b) => b._score - a._score);

// git source: owner/repo plus an optional #subdirectory path
function splitRepo(p) {
  const url = p.url || "";
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url);
  if (!m) return null;
  const namePart = String(p.name || "");
  const hash = namePart.indexOf("#");
  const path = hash >= 0 ? namePart.slice(hash + 1).replace(/^\/+|\/+$/g, "") : "";
  return { owner: m[1], repo: m[2].replace(/\.git$/, ""), path };
}

// A full sweep costs ~8 minutes of atom fetches, so the resolved shas are
// committed to disk: a rebuild re-pins only what is missing or stale. A commit
// sha is immutable, so a cached one never needs re-checking — only the HEAD
// that a new push moves.
const SHA_FILE = new URL("./shas.json", import.meta.url);
const SHA = new Map();
try {
  for (const [repo, entry] of Object.entries(JSON.parse(await readFile(SHA_FILE, "utf8")))) {
    if (Date.now() - entry.at < 86400000) SHA.set(repo, entry.sha);
  }
} catch { /* first run, or an unreadable cache: pin everything */ }
async function resolveSha(repoFullName) {
  if (SHA.has(repoFullName)) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const atom = await get(`https://github.com/${repoFullName}/commits.atom`, false, 15000);
      const m = /Grit::Commit\/([0-9a-f]{40})/.exec(atom);
      if (m) { SHA.set(repoFullName, m[1]); return; }
      return; // 200 without a commit (empty repo): do not retry
    } catch {
      // 429/5xx/timeout: back off and retry, the atom feed is quota-free but throttled
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1) + Math.random() * 400));
    }
  }
}
async function pool(items, concurrency, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { await fn(items[idx], idx); } catch { /* per-item failure must not kill the run */ }
    }
  }));
}

const MAX_GIT = Number(process.env.MAX_GIT || 600);
const MIN_GIT_STARS = Number(process.env.MIN_GIT_STARS || 5);
const pin = gitCandidates.slice(0, MAX_GIT).map((p) => splitRepo(p)).filter(Boolean);
const unique = [...new Map(pin.map((r) => [r.owner + "/" + r.repo, r])).values()];
const t0 = Date.now();
await pool(unique, 8, (r) => resolveSha(r.owner + "/" + r.repo));
await writeFile(SHA_FILE, JSON.stringify(Object.fromEntries([...SHA].map(([repo, sha]) => [repo, { sha, at: Date.now() }]))));
console.log(`git shas: ${SHA.size}/${unique.length} pinned in ${Date.now() - t0}ms`);

// ---- 4. assemble format-1 entries ----
const SLUG = (s) => String(s)
  .toLowerCase()
  .replace(/[^a-z0-9._~-]+/g, "-")
  .replace(/^[-._]+|[-._]+$/g, "");

const LABELS = {
  new: { title: { en: "New (7 days)", zh: "新上架（7 天内）" } },
  fresh: { title: { en: "Recent (30 days)", zh: "近期上架（30 天内）" } },
  hot: { title: { en: "Hot (500+ stars)", zh: "热门（500+ star）" } },
  rising: { title: { en: "Rising", zh: "上升中" } },
  popular: { title: { en: "Popular downloads", zh: "下载量高" } },
  npm: { title: { en: "npm (one-click)", zh: "npm 一键安装" } },
  gitonly: { title: { en: "GitHub only", zh: "仅 GitHub" } },
  risky: { title: { en: "Broad capabilities", zh: "能力较广" } },
};
const SORTKEYS = {
  score: { title: { en: "Trending score", zh: "热度分" }, order: "desc" },
  stars: { title: { en: "Stars", zh: "Star 数" }, order: "desc" },
  downloads: { title: { en: "Downloads (30d)", zh: "下载量（30 天）" }, order: "desc" },
  age: { title: { en: "Age (days)", zh: "上架天数" }, order: "asc" },
};

// 30-day median download, so "popular" means something
const dls = P.map((p) => p.downloads).filter((n) => typeof n === "number" && n > 0).sort((a, b) => a - b);
const dlMed = dls.length ? dls[Math.floor(dls.length * 0.9)] : 0;

const used = new Set();
const plugins = [];
const stats = { npm: 0, git: 0, skipped: 0, labelCounts: {} };

for (const p of P) {
  const cat = CATEGORIES[p.category] ? p.category : "tools";
  const stars = p.stars ?? 0;
  const dl = p.downloads ?? 0;
  const age = p.added ? Math.round(dayOf(p.added)) : 999;
  const ts = p.added ? Math.floor(Date.parse(p.added) / 1000) : now;

  let name, version, source;

  if (p.npm && p.version) {
    name = String(p.npm).toLowerCase();
    version = String(p.version);
    source = { type: "npm" };
    stats.npm++;
  } else {
    const r = splitRepo(p);
    // The list's own complaint about every existing catalog is filler, and the
    // GitHub-only half is where it concentrates: 86% of those repos carry fewer
    // than five stars. Below this floor a git entry is not a plugin anyone can
    // judge, so it costs bytes and a slot without earning either.
    if (stars < MIN_GIT_STARS) { stats.skipped++; continue; }
    const sha = r ? SHA.get(r.owner + "/" + r.repo) : null;
    if (!r || !sha) { stats.skipped++; continue; }
    const base = SLUG(p.name.split("#")[0]) || SLUG(r.repo) || "dsh-plugin";
    name = /^[a-z0-9]/.test(base) ? base : "x" + base;
    // npm "version" must be SemVer: derive a deterministic one from the date
    const d = new Date(ts * 1000);
    version = `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
    source = { type: "git", url: `https://github.com/${r.owner}/${r.repo}`, commit: sha };
    if (r.path) source.path = r.path;
    stats.git++;
  }

  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) { stats.skipped++; continue; }
  let final = name;
  let n = 1;
  while (used.has(final)) { final = `${name}-${n++}`; if (final.length > 214) { final = null; break; } }
  if (!final) { stats.skipped++; continue; }
  used.add(final);

  const labels = [];
  if (age <= 7) labels.push("new");
  else if (age <= 30) labels.push("fresh");
  if (stars >= 500) labels.push("hot");
  if (p._score >= 1200 && age <= 60) labels.push("rising");
  if (dlMed && dl >= dlMed) labels.push("popular");
  labels.push(p.npm && p.version ? "npm" : "gitonly");
  if ((p.capabilities || []).length >= 5) labels.push("risky");
  for (const l of labels) stats.labelCounts[l] = (stats.labelCounts[l] || 0) + 1;

  const en = (p.description?.en || "").trim().slice(0, 900) || String(p.name);
  const zh = (p.description?.zh || p.description?.en || "").trim().slice(0, 900) || String(p.name);

  plugins.push({
    name: final,
    title: { en: String(p.name).slice(0, 200), zh: String(p.name).slice(0, 200) },
    description: { en, zh },
    author: String(p.owner || "").slice(0, 200) || "community",
    homepage: p.page || p.url,
    repository: { url: String(p.url).replace(/#.*$/, "") },
    metadata: {
      category: cat,
      keywords: (p.capabilities || []).slice(0, 8),
      labels,
      sortKeys: { score: p._score, stars, downloads: dl, age },
    },
    versions: [{ version, publishTimestamp: ts, source, engines: {} }],
  });
}

// sort by trending score so the market opens on what is actually hot
plugins.sort((a, b) => b.metadata.sortKeys.score - a.metadata.sortKeys.score);

const index = {
  format: 1,
  title: { en: "DSH GitHub Trending", zh: "DSH GitHub 趋势榜" },
  description: {
    en: `${plugins.length} community DeepSeek Harness plugins and skills, ranked by live GitHub momentum: stars, recent downloads and how recently they appeared. Built from the awesome-dsh-plugin catalog.`,
    zh: `${plugins.length} 个社区 DeepSeek Harness 插件与技能，按 GitHub 实时热度排序：Star 数、近 30 天下载量、上架新近度。数据来自 awesome-dsh-plugin 社区目录。`,
  },
  metadata: { categories: CATEGORIES, labels: LABELS, sortKeys: SORTKEYS },
  plugins,
};

// ---- 5. self-check against the format-1 rules ----
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?$/;
const errs = [];
for (const [i, p] of plugins.entries()) {
  if (!NAME_RE.test(p.name)) errs.push(`[${i}].name ${p.name}`);
  if (!p.title?.en || !p.description?.en) errs.push(`[${i}] title/description.en`);
  if (!CATEGORIES[p.metadata.category]) errs.push(`[${i}].category ${p.metadata.category}`);
  for (const l of p.metadata.labels) if (!LABELS[l]) errs.push(`[${i}].label ${l}`);
  for (const k of Object.keys(p.metadata.sortKeys)) if (!SORTKEYS[k]) errs.push(`[${i}].sortKey ${k}`);
  const v = p.versions[0];
  if (!SEMVER.test(v.version)) errs.push(`[${i}].version ${v.version}`);
  if (!Number.isInteger(v.publishTimestamp)) errs.push(`[${i}].publishTimestamp`);
  if (v.source.type === "git" && !/^[0-9a-f]{40}$/.test(v.source.commit)) errs.push(`[${i}].commit`);
}
if (errs.length) { console.log("SELF-CHECK FAILED:", errs.slice(0, 8)); process.exit(1); }

const text = JSON.stringify(index, null, 0);
await writeFile(OUT, text);
console.log(`\nSELF-CHECK OK  plugins=${plugins.length}  categories=${Object.keys(CATEGORIES).length}  ${(text.length / 1048576).toFixed(2)} MB`);
console.log(`npm=${stats.npm} git=${stats.git} skipped-no-sha=${stats.skipped}`);
console.log("labels:", Object.entries(stats.labelCounts).map(([k, v]) => `${k}:${v}`).join(" "));
console.log("\nTOP 12 by trending score:");
for (const p of plugins.slice(0, 12)) {
  const s = p.metadata.sortKeys;
  console.log(`  ${String(s.score).padStart(6)} ${String(s.stars).padStart(6)}★ ${String(s.downloads).padStart(5)}dl ${String(s.age).padStart(3)}d [${p.metadata.category}] ${p.name.slice(0, 30).padEnd(31)} ${p.description.zh.slice(0, 34)}`);
}
