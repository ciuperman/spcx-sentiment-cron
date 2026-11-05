export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      service: "spcx-sentiment-cron",
      note: "Live path enabled when DRY_RUN≠1; Notion sink; cron /api/cron/daily",
    }),
  );
}
