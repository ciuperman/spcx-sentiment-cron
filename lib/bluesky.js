import { CONFIG } from "./config.js";

const SPAM =
  /giveaway|airdrop|promo code|discount|referral|sign up|join my|free \$|dm me|whatsapp|telegram|follow (me|us) for|link in bio|use code/i;
const REL = /spacex|spcx|starlink|space x/i;
const QUERIES = [
  "SPCX",
  "SpaceX stock",
  "SpaceX IPO",
  "SpaceX shares",
  "SpaceX valuation",
  "SpaceX",
  "Starlink stock",
  "SpaceX Tesla merger",
  "SpaceX Musk",
  "Starlink",
  "SpaceX price",
  "SpaceX investors",
];

function tier(author) {
  const v = (author.verification || {}).verifiedStatus;
  if (v === "valid") return "badge";
  if (author.handle && !author.handle.endsWith(".bsky.social")) return "domain";
  return null;
}

function norm(t) {
  return String(t)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .slice(0, 80);
}

/** Up to 1000 verified (badge+domain); accept partial on 403. */
export async function fetchBlueskyPosts() {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const byUri = new Map();
  let hit403 = false;

  for (const q of QUERIES) {
    const url = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "100");
    url.searchParams.set("sort", "latest");
    url.searchParams.set("since", since);
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "spcx-sentiment-cron/0.1" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      continue;
    }
    if (res.status === 403) {
      hit403 = true;
      continue;
    }
    if (!res.ok) continue;
    const body = await res.json();
    for (const post of body.posts ?? []) byUri.set(post.uri, post);
    await new Promise((r) => setTimeout(r, 400));
  }

  const posts = [...byUri.values()];
  const badge = posts.filter((p) => tier(p.author) === "badge");
  const domain = posts.filter((p) => tier(p.author) === "domain");
  const ordered = [...badge, ...domain];
  const selected = [];
  const seen = new Set();
  const counts = new Map();
  const maxPer = CONFIG.maxPerAccount;

  for (const x of ordered) {
    const text = x.record?.text ?? "";
    const key = norm(text);
    const handle = x.author?.handle ?? "?";
    if (!REL.test(text) || SPAM.test(text) || key.length < 15 || seen.has(key)) continue;
    const n = counts.get(handle) ?? 0;
    if (n >= maxPer) continue;
    seen.add(key);
    counts.set(handle, n + 1);
    selected.push({ text, handle, tier: tier(x.author) });
    if (selected.length >= CONFIG.targetPosts) break;
  }

  return { posts: selected, hit403, raw: posts.length };
}
