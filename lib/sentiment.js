export function labelFor(score, threshold = 0.15) {
  if (score >= threshold) return "bullish";
  if (score <= -threshold) return "bearish";
  return "neutral";
}

export function clampScore(score) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(-1, Math.min(1, score));
}

const LINK = /https?:\/\/|www\.|\b[\w-]+\.(com|net|org|ro|io|info|ly)\b|\bt\.co\b|\bbit\.ly\b/i;
const SPAM_YT = /whatsapp|telegram|contact me/i;

export function keepComment(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return Boolean(t) && !LINK.test(t) && t.split(/\s+/).filter(Boolean).length >= 3 && !SPAM_YT.test(t);
}

export function commentWeight(likes, views) {
  return (1 + Math.max(0, likes)) * Math.log10(10 + Math.max(0, views));
}

export function mixFromLabels(rows) {
  if (!rows.length) return { score: 0, bullishPct: 0, neutralPct: 100, bearishPct: 0 };
  const value = { bullish: 1, neutral: 0, bearish: -1 };
  let weight = 0;
  let weighted = 0;
  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  for (const row of rows) {
    const w = commentWeight(row.likes, row.views);
    weight += w;
    weighted += w * value[row.label];
    counts[row.label] += 1;
  }
  const total = rows.length;
  const bullishPct = Math.round((counts.bullish / total) * 100);
  const bearishPct = Math.round((counts.bearish / total) * 100);
  const neutralPct = Math.max(0, 100 - bullishPct - bearishPct);
  return { score: clampScore(weight ? weighted / weight : 0), bullishPct, neutralPct, bearishPct };
}

export function meanFromLabels(labels) {
  if (!labels.length) return { score: 0, bullishPct: 0, neutralPct: 100, bearishPct: 0 };
  const value = { bullish: 1, neutral: 0, bearish: -1 };
  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  let sum = 0;
  for (const label of labels) {
    counts[label] += 1;
    sum += value[label];
  }
  const n = labels.length;
  const bullishPct = Math.round((counts.bullish / n) * 100);
  const bearishPct = Math.round((counts.bearish / n) * 100);
  return {
    score: clampScore(sum / n),
    bullishPct,
    bearishPct,
    neutralPct: Math.max(0, 100 - bullishPct - bearishPct),
  };
}

export function parseLabelList(raw, count) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let body;
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.labels)) return null;
  return Array.from({ length: count }, (_, i) => {
    const label = body.labels[i];
    return label === "bullish" || label === "neutral" || label === "bearish" ? label : null;
  });
}
