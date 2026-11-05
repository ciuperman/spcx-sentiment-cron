import { env, bucharestDateKey, bucharestHour } from "../../lib/config.js";
import { runLive } from "../../lib/run.js";

export const config = { maxDuration: 300 };

function authorized(req) {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const header = req.headers.authorization || req.headers.Authorization || "";
  return header === `Bearer ${secret}`;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return send(res, 405, { error: "method_not_allowed" });
  }
  if (!authorized(req)) {
    return send(res, 401, { error: "unauthorized" });
  }

  const date = bucharestDateKey();
  const hour = bucharestHour();
  const dry = env("DRY_RUN") === "1";
  const force = env("CRON_FORCE") === "1";

  if (!force && hour !== 23 && !dry) {
    return send(res, 200, { ok: true, skipped: "not_23_bucharest", date, hour });
  }

  if (dry) {
    return send(res, 200, {
      ok: true,
      dryRun: true,
      date,
      hour,
      wouldWrite: ["X", "Bluesky", "YouTube"],
      notionDb: env("NOTION_SENTIMENT_DB_ID") ?? "0d4ebca70d294e36b3c966dc7421be85",
      envPresent: {
        XAI_API_KEY: Boolean(env("XAI_API_KEY")),
        NOTION_TOKEN: Boolean(env("NOTION_TOKEN")),
        YOUTUBE_API_KEY: Boolean(env("YOUTUBE_API_KEY")),
        X_BEARER_TOKEN: Boolean(env("X_BEARER_TOKEN")),
        CRON_SECRET: Boolean(env("CRON_SECRET")),
      },
      note: "No xAI/YouTube/X/Notion calls in DRY_RUN",
    });
  }

  try {
    const out = await runLive(date);
    return send(res, 200, out);
  } catch (e) {
    return send(res, 500, {
      ok: false,
      date,
      error: e instanceof Error ? e.message : "unknown",
    });
  }
}
