# spcx-sentiment-cron

Daily SPCX sentiment → Notion (X / Bluesky / YouTube).

- Prod: https://spcx-sentiment-cron.vercel.app
- Cron `0 21 * * *` UTC → `/api/cron/daily` + `Authorization: Bearer $CRON_SECRET`
- `DRY_RUN=1` skips paid/network writes; `DRY_RUN=0` runs live
- Live path: lib/*.js (X API, Bluesky AppView, YouTube Data API, xAI labels, Notion upsert)

Do not call live cron casually — costs xAI + API quota.
