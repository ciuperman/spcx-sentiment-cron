export function env(key) {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/** Prefer full env; if short/missing, join NAME_0..NAME_n (9-char chunks). */
export function secret(name) {
  const direct = env(name);
  if (direct && direct.length >= 20) return direct;
  const parts = [];
  for (let i = 0; ; i++) {
    const p = process.env[`${name}_${i}`];
    if (p == null || String(p).length === 0) break;
    parts.push(String(p));
  }
  if (parts.length) return parts.join("");
  return direct;
}

export function requireEnv(key) {
  const v = secret(key) ?? env(key);
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

export const CONFIG = {
  ticker: () => env("TICKER") ?? "SPCX",
  notionDbId: () => env("NOTION_SENTIMENT_DB_ID") ?? "0d4ebca70d294e36b3c966dc7421be85",
  xaiModel: () => env("XAI_MODEL") ?? "grok-4.5",
  threshold: 0.15,
  youtubeWindowDays: 14,
  youtubeTopVideos: 25,
  youtubeMinSubs: 50_000,
  batchSize: 100,
  targetPosts: 1000,
  maxPerAccount: 3,
};

export function isBucharestHour23(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  return hour === 23;
}

export function bucharestDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function bucharestHour(now = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
}
