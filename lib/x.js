import { CONFIG, requireEnv } from "./config.js";

const SPAM =
  /giveaway|airdrop|promo code|discount|referral|sign up|join my|free \$|dm me|whatsapp|telegram|follow (me|us) for|link in bio|use code|subscribe|newsletter|% off|binance/i;
const REL = /spacex|spcx|space x/i;

function norm(t) {
  return String(t)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .slice(0, 70);
}

function isVerified(user) {
  if (!user) return false;
  if (user.verified === true) return true;
  const vt = user.verified_type;
  return vt === "blue" || vt === "business" || vt === "government";
}

/** Fetch ~1000 verified posts via X API v2 recent search. */
export async function fetchXPosts() {
  if (process.env.SKIP_X === "1" || process.env.X_ENABLED !== "1") {
    throw new Error("X disabled (hard guard)");
  }
  const token = requireEnv("X_BEARER_TOKEN");
  const target = CONFIG.targetPosts;
  const maxPer = CONFIG.maxPerAccount;
  const query = '(SpaceX OR SPCX OR "Space X") -is:retweet';
  const selected = [];
  const seen = new Set();
  const counts = new Map();
  let next = undefined;
  let pages = 0;
  const maxPages = 25;

  while (selected.length < target && pages < maxPages) {
    pages += 1;
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", query);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("tweet.fields", "created_at,author_id,lang");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "username,verified,verified_type");
    if (next) url.searchParams.set("next_token", next);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      if (pages === 1) throw new Error(`x_http_${res.status}`);
      break;
    }
    const body = await res.json();
    const users = new Map((body.includes?.users ?? []).map((u) => [u.id, u]));
    for (const tw of body.data ?? []) {
      const user = users.get(tw.author_id);
      if (!isVerified(user)) continue;
      const text = tw.text ?? "";
      if (text.startsWith("RT @")) continue;
      if (!REL.test(text) || SPAM.test(text)) continue;
      const key = norm(text);
      if (key.length < 15 || seen.has(key)) continue;
      const handle = user?.username ?? tw.author_id;
      const n = counts.get(handle) ?? 0;
      if (n >= maxPer) continue;
      seen.add(key);
      counts.set(handle, n + 1);
      selected.push({ text, userId: handle, verified: true });
      if (selected.length >= target) break;
    }
    next = body.meta?.next_token;
    if (!next || !(body.data?.length)) break;
  }
  return selected.slice(0, target);
}
