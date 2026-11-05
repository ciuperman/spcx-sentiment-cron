/**
 * Vercel Cron → /api/cron/daily
 * Auth: Authorization Bearer CRON_SECRET
 * DRY_RUN=1 → 200 JSON, no external paid/quota calls
 */
export const config = { maxDuration: 60 };

function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function authorized(req: Request): boolean {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function bucharestHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
}

function bucharestDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }
  if (!authorized(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const date = bucharestDateKey();
  const hour = bucharestHour();
  const dry = env("DRY_RUN") === "1";
  const force = env("CRON_FORCE") === "1";

  if (!force && hour !== 23 && !dry) {
    return Response.json({ ok: true, skipped: "not_23_bucharest", date, hour });
  }

  if (dry) {
    return Response.json({
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

  // Live path not enabled until Adrian OK's paid calls — refuse rather than burn quota
  return Response.json(
    {
      ok: false,
      date,
      error: "live_path_disabled",
      hint: "Set DRY_RUN=1 for smoke test, or wait for Builder to enable live fetches after OK",
    },
    { status: 503 },
  );
}
