import { CONFIG } from "./config.js";
import { labelAll, estimateUsd } from "./xai.js";
import { upsertDaily } from "./notion.js";
import { labelFor, meanFromLabels, mixFromLabels } from "./sentiment.js";
import { fetchXPosts } from "./x.js";
import { fetchBlueskyPosts } from "./bluesky.js";
import { fetchYoutubeComments } from "./youtube.js";
import { fetchSpcxDaily } from "./yahoo.js";

async function scoreTexts(texts, source, date, usageTotal) {
  if (!texts.length) return { status: "empty", posts: 0 };
  const { labels, usage } = await labelAll(texts, CONFIG.ticker());
  usageTotal.input += usage.input;
  usageTotal.output += usage.output;
  const mix = meanFromLabels(labels);
  const status = await upsertDaily({
    date,
    source,
    score: mix.score,
    label: labelFor(mix.score, CONFIG.threshold),
    bullishPct: mix.bullishPct,
    neutralPct: mix.neutralPct,
    bearishPct: mix.bearishPct,
    posts: texts.length,
    themes: [],
    delta: null,
  });
  return { status, posts: texts.length, score: mix.score, label: labelFor(mix.score, CONFIG.threshold) };
}

/** Live daily pipeline. Throws on hard failures; per-source errors recorded in results. */
export async function runLive(date) {
  const usage = { input: 0, output: 0 };
  const results = {};

  try {
    const bar = await fetchSpcxDaily(CONFIG.ticker());
    results.yahoo = bar
      ? `close=${bar.close}@${bar.date} h=${bar.high} l=${bar.low} v=${bar.volume}`
      : "fail";
  } catch (e) {
    results.yahoo = `error:${e instanceof Error ? e.message : "unknown"}`;
  }

  if (process.env.SKIP_X === "1") {
    results.X = { status: "skipped:SKIP_X" };
  } else {
    try {
      const posts = await fetchXPosts();
      results.X = await scoreTexts(
        posts.map((p) => p.text),
        "X",
        date,
        usage,
      );
    } catch (e) {
      results.X = { status: `error:${e instanceof Error ? e.message : "unknown"}` };
    }
  }

  try {
    const bsky = await fetchBlueskyPosts();
    const scored = await scoreTexts(
      bsky.posts.map((p) => p.text),
      "Bluesky",
      date,
      usage,
    );
    results.Bluesky = { ...scored, hit403: bsky.hit403, raw: bsky.raw };
  } catch (e) {
    results.Bluesky = { status: `error:${e instanceof Error ? e.message : "unknown"}` };
  }

  try {
    const yt = await fetchYoutubeComments();
    if (!yt.comments.length) {
      results.YouTube = { status: "empty", videos: yt.videos, channels: yt.channels };
    } else {
      const { labels, usage: u } = await labelAll(
        yt.comments.map((c) => c.text),
        CONFIG.ticker(),
      );
      usage.input += u.input;
      usage.output += u.output;
      const rows = yt.comments.map((c, i) => ({
        label: labels[i] ?? "neutral",
        likes: c.likes,
        views: c.views,
      }));
      const mix = mixFromLabels(rows);
      const status = await upsertDaily({
        date,
        source: "YouTube",
        score: mix.score,
        label: labelFor(mix.score, CONFIG.threshold),
        bullishPct: mix.bullishPct,
        neutralPct: mix.neutralPct,
        bearishPct: mix.bearishPct,
        posts: yt.comments.length,
        themes: [`videos=${yt.videos}`, `channels=${yt.channels}`],
        delta: null,
      });
      results.YouTube = {
        status,
        posts: yt.comments.length,
        videos: yt.videos,
        channels: yt.channels,
        score: mix.score,
        label: labelFor(mix.score, CONFIG.threshold),
      };
    }
  } catch (e) {
    results.YouTube = { status: `error:${e instanceof Error ? e.message : "unknown"}` };
  }

  return {
    ok: true,
    date,
    results,
    xaiUsdEstimate: Math.round(estimateUsd(usage) * 1000) / 1000,
    usage,
    note: "Notion sink; canvas/Page not updated",
  };
}
