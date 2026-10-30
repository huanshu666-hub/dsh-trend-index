// Single source of truth for the trending score.
// Pure: no I/O, no dates — callers turn a publish date into `age` days first.

export const WEIGHTS = { stars: 0.6, downloads: 0.15, freshnessWeight: 60, momentumWeight: 2, momentumCap: 400 };

export const FRESHNESS_TIERS = [
  { maxAge: 7, value: 3 },
  { maxAge: 30, value: 2 },
  { maxAge: 90, value: 1 },
  { maxAge: Infinity, value: 0 },
];

export function freshnessOf(age) {
  for (const tier of FRESHNESS_TIERS) {
    if (age <= tier.maxAge) return tier.value;
  }
  return 0;
}

export function decompose({ stars = 0, downloads = 0, age = 365 } = {}) {
  const starsPart = stars * WEIGHTS.stars;
  const downloadsPart = downloads * WEIGHTS.downloads;
  const freshnessPart = freshnessOf(age) * WEIGHTS.freshnessWeight;
  const momentumPart = Math.min(stars / Math.max(age, 1), WEIGHTS.momentumCap) * WEIGHTS.momentumWeight;
  return {
    stars: starsPart,
    downloads: downloadsPart,
    freshness: freshnessPart,
    momentum: momentumPart,
    total: Math.round(starsPart + downloadsPart + freshnessPart + momentumPart),
  };
}

export function scoreOf({ stars, downloads, age } = {}) {
  return decompose({ stars, downloads, age }).total;
}
