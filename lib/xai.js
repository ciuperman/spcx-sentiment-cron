import { CONFIG, requireEnv } from "./config.js";
import { parseLabelList } from "./sentiment.js";

const XAI_URL = "https://api.x.ai/v1/chat/completions";

/** At most this many xAI requests in flight at once, across all sources. */
const MAX_CONCURRENT = 4;
const REQUEST_TIMEOUT_MS = 60_000;

let active = 0;
const waiting = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

function sanitize(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\\/g, "/")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestOnce(key, body, deadline) {
  const remaining = deadline ? deadline - Date.now() : REQUEST_TIMEOUT_MS;
  if (remaining < 3_000) throw new Error("deadline_exceeded");
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
    body,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    const e = new Error(`xai_http_${res.status}:${err.slice(0, 160)}`);
    e.retryable = res.status === 429 || res.status >= 500;
    throw e;
  }
  return res.json();
}

export async function labelBatch(texts, ticker, usage, deadline) {
  const key = requireEnv("XAI_API_KEY");
  const listing = texts.map((t, i) => `${i + 1}. ${sanitize(t)}`).join("\n");
  const system =
    'Clasifici postări/comentarii despre o acțiune. Răspunde doar cu JSON {"labels":["bullish"|"neutral"|"bearish"]}. labels are aceeași lungime ca lista. Nu da sfaturi de tranzacționare.';
  const body = JSON.stringify({
    model: CONFIG.xaiModel(),
    temperature: 0,
    max_tokens: 1600,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Ticker: ${ticker}\n${listing}` },
    ],
  });

  await acquire();
  let json;
  try {
    try {
      json = await requestOnce(key, body, deadline);
    } catch (e) {
      // One retry for rate limits, server errors and request timeouts.
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      if (!(timedOut || (e && e.retryable))) throw e;
      await sleep(1_500 + Math.random() * 1_000);
      json = await requestOnce(key, body, deadline);
    }
  } finally {
    release();
  }

  usage.input += json.usage?.prompt_tokens ?? 0;
  usage.output += json.usage?.completion_tokens ?? 0;
  const raw = json.choices?.[0]?.message?.content ?? "";
  return parseLabelList(raw, texts.length) ?? texts.map(() => null);
}

/**
 * Labels every text in batches of CONFIG.batchSize, a few batches at a time.
 * Order of the returned labels matches the order of `texts`.
 * Throws if any batch fails (so a partial, biased result is never written).
 */
export async function labelAll(texts, ticker, deadline) {
  const usage = { input: 0, output: 0 };
  const batch = CONFIG.batchSize;
  const slices = [];
  for (let i = 0; i < texts.length; i += batch) slices.push(texts.slice(i, i + batch));

  const results = new Array(slices.length);
  let failure = null;
  let next = 0;

  // A few workers pull batches in order; after the first failure nobody starts a new one.
  const worker = async () => {
    while (!failure) {
      const idx = next++;
      if (idx >= slices.length) return;
      try {
        results[idx] = await labelBatch(slices[idx], ticker, usage, deadline);
      } catch (e) {
        failure ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, slices.length) }, worker));
  if (failure) throw failure;

  const out = [];
  for (let idx = 0; idx < slices.length; idx++) {
    for (let j = 0; j < slices[idx].length; j++) out.push(results[idx][j] ?? "neutral");
  }
  return { labels: out, usage };
}

export function estimateUsd(usage) {
  return (usage.input / 1_000_000) * 2 + (usage.output / 1_000_000) * 6;
}
