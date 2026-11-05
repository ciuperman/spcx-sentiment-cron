export default function handler(_req: Request): Response {
  return Response.json({
    ok: true,
    service: "spcx-sentiment-cron",
    note: "Cron at /api/cron/daily — Notion sink; DRY_RUN skips paid fetches",
  });
}
