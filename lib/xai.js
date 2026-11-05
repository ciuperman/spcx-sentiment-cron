import { CONFIG, requireEnv } from "./config.js";
import { parseLabelList } from "./sentiment.js";

const XAI_URL = "https://api.x.ai/v1/chat/completions";

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

export async function labelBatch(texts, ticker, usage) {
  const key = requireEnv("XAI_API_KEY");
  const listing = texts.map((t, i) => `${i + 1}. ${sanitize(t)}`).join("\n");
  const system =
    'Clasifici postări/comentarii despre o acțiune. Răspunde doar cu JSON {"labels":["bullish"|"neutral"|"bearish"]}. labels are aceeași lungime ca lista. Nu da sfaturi de tranzacționare.';
  const res = await fetch(XAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: CONFIG.xaiModel(),
      temperature: 0,
      max_tokens: 1600,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Ticker: ${ticker}\n${listing}` },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`xai_http_${res.status}:${err.slice(0, 160)}`);
  }
  const body = await res.json();
  usage.input += body.usage?.prompt_tokens ?? 0;
  usage.output += body.usage?.completion_tokens ?? 0;
  const raw = body.choices?.[0]?.message?.content ?? "";
  return parseLabelList(raw, texts.length) ?? texts.map(() => null);
}

export async function labelAll(texts, ticker) {
  const usage = { input: 0, output: 0 };
  const out = [];
  const batch = CONFIG.batchSize;
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    const labels = await labelBatch(slice, ticker, usage);
    for (let j = 0; j < slice.length; j++) out.push(labels[j] ?? "neutral");
  }
  return { labels: out, usage };
}

export function estimateUsd(usage) {
  return (usage.input / 1_000_000) * 2 + (usage.output / 1_000_000) * 6;
}
