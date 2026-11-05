import { CONFIG, requireEnv } from "./config.js";
import { keepComment } from "./sentiment.js";

const BASE = "https://www.googleapis.com/youtube/v3/";
const QUERIES = ["SpaceX stock", "SPCX", "SpaceX IPO", "SPCX stock", "SpaceX shares"];

async function yt(path, params) {
  const key = requireEnv("YOUTUBE_API_KEY");
  const url = new URL(BASE + path);
  url.searchParams.set("key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`yt_${path}_${res.status}`);
  return res.json();
}

/** Ciuperman: 14d, top 25 by views, channels ≥50k, filtered comments. */
export async function fetchYoutubeComments() {
  const since = new Date(Date.now() - CONFIG.youtubeWindowDays * 86400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const videos = new Map();

  for (const q of QUERIES) {
    const data = await yt("search", {
      q,
      part: "snippet",
      type: "video",
      order: "viewCount",
      publishedAfter: since,
      maxResults: 50,
    });
    for (const it of data.items ?? []) {
      const title = it.snippet?.title ?? "";
      if (!/spacex|spcx|space x/i.test(title)) continue;
      const id = it.id?.videoId;
      if (!id) continue;
      videos.set(id, { title, channelId: it.snippet.channelId, views: 0 });
    }
  }

  const ids = [...videos.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await yt("videos", { id: chunk.join(","), part: "statistics" });
    for (const it of data.items ?? []) {
      const row = videos.get(it.id);
      if (row) row.views = Number(it.statistics?.viewCount ?? 0);
    }
  }

  const channelIds = [...new Set([...videos.values()].map((v) => v.channelId))];
  const channels = new Map();
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const data = await yt("channels", { id: chunk.join(","), part: "statistics,snippet" });
    for (const it of data.items ?? []) {
      const s = it.statistics ?? {};
      if (s.hiddenSubscriberCount) continue;
      const txt = `${it.snippet?.title ?? ""} ${it.snippet?.description ?? ""}`.toLowerCase();
      channels.set(it.id, {
        subs: Number(s.subscriberCount ?? 0),
        name: it.snippet?.title ?? "",
        fin: /stock|invest|finance|market|trading|money|news/.test(txt),
      });
    }
  }

  const ok = [...videos.entries()].filter(
    ([, d]) => channels.has(d.channelId) && channels.get(d.channelId).subs >= CONFIG.youtubeMinSubs,
  );
  ok.sort((a, b) => {
    const fa = channels.get(a[1].channelId).fin ? 0 : 1;
    const fb = channels.get(b[1].channelId).fin ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (b[1].views ?? 0) - (a[1].views ?? 0);
  });
  const sel = ok.slice(0, CONFIG.youtubeTopVideos).map(([id]) => id);

  const comments = [];
  const seen = new Set();
  for (const vid of sel) {
    const data = await yt("commentThreads", {
      videoId: vid,
      part: "snippet,replies",
      order: "relevance",
      maxResults: 100,
      textFormat: "plainText",
    }).catch(() => ({ items: [] }));
    const views = videos.get(vid)?.views ?? 0;
    const add = (snip) => {
      const text = (snip.textDisplay ?? snip.textOriginal ?? "").replace(/\s+/g, " ").trim();
      if (!keepComment(text)) return;
      const key = text.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(key)) return;
      seen.add(key);
      comments.push({
        text,
        likes: Number(snip.likeCount ?? 0),
        views,
        videoId: vid,
      });
    };
    for (const it of data.items ?? []) {
      add(it.snippet.topLevelComment.snippet);
      for (const rp of it.replies?.comments ?? []) add(rp.snippet);
    }
  }

  return {
    comments: comments.slice(0, CONFIG.targetPosts),
    videos: sel.length,
    channels: new Set(sel.map((id) => videos.get(id).channelId)).size,
  };
}
