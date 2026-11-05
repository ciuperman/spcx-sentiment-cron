import { CONFIG, requireEnv } from "./config.js";

const NOTION_VERSION = "2022-06-28";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export function sentimentProperties(row) {
  const ticker = row.ticker ?? CONFIG.ticker();
  const themes = (row.themes || []).join("; ");
  return {
    Name: {
      title: [{ type: "text", text: { content: `${ticker} ${row.source} ${row.date}`.slice(0, 2000) } }],
    },
    Date: { date: { start: row.date } },
    Ticker: { select: { name: ticker } },
    Source: { select: { name: row.source } },
    Label: { select: { name: row.label } },
    Score: { number: row.score },
    "Bullish %": { number: row.bullishPct },
    "Neutral %": { number: row.neutralPct },
    "Bearish %": { number: row.bearishPct },
    Posts: { number: row.posts },
    Delta: { number: row.delta },
    Themes: {
      rich_text: themes ? [{ type: "text", text: { content: themes.slice(0, 2000) } }] : [],
    },
  };
}

export async function existsRow(source, date, ticker = CONFIG.ticker()) {
  const token = requireEnv("NOTION_TOKEN");
  const db = CONFIG.notionDbId();
  const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      filter: {
        and: [
          { property: "Ticker", select: { equals: ticker } },
          { property: "Source", select: { equals: source } },
          { property: "Date", date: { equals: date } },
        ],
      },
      page_size: 1,
    }),
  });
  if (!res.ok) throw new Error(`notion_query_${res.status}`);
  const body = await res.json();
  return (body.results?.length ?? 0) > 0;
}

export async function latestScore(source, ticker = CONFIG.ticker()) {
  const token = requireEnv("NOTION_TOKEN");
  const db = CONFIG.notionDbId();
  const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      filter: {
        and: [
          { property: "Ticker", select: { equals: ticker } },
          { property: "Source", select: { equals: source } },
        ],
      },
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: 1,
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const n = body.results?.[0]?.properties?.Score?.number;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export async function createRow(row) {
  const token = requireEnv("NOTION_TOKEN");
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      parent: { database_id: CONFIG.notionDbId() },
      properties: sentimentProperties(row),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, reason: `http_${res.status}:${t.slice(0, 160)}` };
  }
  const body = await res.json();
  if (!body.id) return { ok: false, reason: "no_id" };
  return { ok: true, pageId: body.id };
}

export async function upsertDaily(row) {
  if (await existsRow(row.source, row.date, row.ticker)) return "skipped";
  const prev = await latestScore(row.source, row.ticker);
  const withDelta = {
    ...row,
    delta: prev == null ? 0 : Math.round((row.score - prev) * 100) / 100,
  };
  const result = await createRow(withDelta);
  return result.ok ? "created" : `error:${result.reason}`;
}
