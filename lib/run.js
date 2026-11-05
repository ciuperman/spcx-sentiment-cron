import { CONFIG } from "./config.js";
import { labelAll, estimateUsd } from "./xai.js";
import { upsertDaily, existsRow } from "./notion.js";
import { labelFor, meanFromLabels, mixFromLabels } from "./sentiment.js";
import { fetchXPosts } from "./x.js";
import { fetchBlueskyPosts } from "./bluesky.js";
import { fetchYoutubeComments } from "./youtube.js";
import { fetchSpcxDaily } from "./yahoo.js";

/** Whole run must finish before Vercel kills the function (maxDuration 300 s). */
const BUDGET_MS = 270_000;

const errMsg = (e) => (e instanceof Error ? e.message : "unknown");

async function scoreTexts(texts, source, date, usageTotal, deadline) {
  if (!texts.length) return { status: "empty", posts: 0 };
  const { labels, usage } = await labelAll(texts, CONFIG.ticker(), deadline);
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

/** True when Notion already has today's row, so fetching and labelling again would be wasted. */
async function alreadyWritten(source, date) {
  try {
    return await existsRow(source, date);
  } catch {
    return false; // if the check fails, run normally; upsertDaily checks again before writing
  }
}

async function runYahoo() {
  try {
    const bar = await fetchSpcxDaily(CONFIG.ticker());
    return bar ? `close=${bar.close}@${bar.date} h=${bar.high} l=${bar.low} v=${bar.volume}` : "fail";
  } catch (e) {
    return `error:${errMsg(e)}`;
  }
}

async function runX(date, usage, deadline) {
  if (process.env.SKIP_X === "1") return { status: "skipped:SKIP_X" };
  try {
    if (await alreadyWritten("X", date)) return { status: "skipped:exists" };
    const posts = await fetchXPosts();
    return await scoreTexts(
      posts.map((p) => p.text),
      "X",
      date,
      usage,
      deadline,
    );
  } catch (e) {
    return { status: `error:${errMsg(e)}` };
  }
}

async function runBluesky(date, usage, deadline) {
  try {
    if (await alreadyWritten("Bluesky", date)) return { status: "skipped:exists" };
    const bsky = await fetchBlueskyPosts();
    const scored = await scoreTexts(
      bsky.posts.map((p) => p.text),
      "Bluesky",
      date,
      usage,
      deadline,
    );
    return { ...scored, hit403: bsky.hit403, raw: bsky.raw };
  } catch (e) {
    return { status: `error:${errMsg(e)}` };
  }
}

async function runYoutube(date, usage, deadline) {
  try {
    if (await alreadyWritten("YouTube", date)) return { status: "skipped:exists" };
    const yt = await fetchYoutubeComments();
    if (!yt.comments.length) {
      return { status: "empty", videos: yt.videos, channels: yt.channels };
    }
    const { labels, usage: u } = await labelAll(
      yt.comments.map((c) => c.text),
      CONFIG.ticker(),
      deadline,
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
    return {
      status,
      posts: yt.comments.length,
      videos: yt.videos,
      channels: yt.channels,
      score: mix.score,
      label: labelFor(mix.score, CONFIG.threshold),
    };
  } catch (e) {
    return { status: `error:${errMsg(e)}` };
  }
}

/**
 * Live daily pipeline. The four sources run in parallel; each one records its own
 * error in the results instead of failing the others. Sources already written
 * for `date` are skipped, so a re-run costs almost nothing.
 */
export async function runLive(date) {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const usage = { input: 0, output: 0 };

  const [yahoo, X, Bluesky, YouTube] = await Promise.all([
    runYahoo(),
    runX(date, usage, deadline),
    runBluesky(date, usage, deadline),
    runYoutube(date, usage, deadline),
  ]);

  return {
    ok: true,
    date,
    results: { yahoo, X, Bluesky, YouTube },
    xaiUsdEstimate: Math.round(estimateUsd(usage) * 1000) / 1000,
    usage,
    elapsedMs: Date.now() - started,
    note: "Notion sink; canvas/Page not updated",
  };
}
