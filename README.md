# Turnout Dispatch Board

This project is a Next.js dashboard that polls FirstDue from the server, stores durable recent dispatch history in Postgres when configured, and pushes live updates to screens through server-sent events.

## How it works

- The browser loads `/api/dispatches` once and then subscribes to `/api/dispatch-stream`.
- The server poller calls your FirstDue endpoint with credentials stored in environment variables.
- When `DATABASE_URL` is configured, snapshots, incidents, and incident-change events are written to Postgres.
- When `REDIS_URL` is configured, multiple app instances share the latest snapshot and fan out updates consistently.
- The response is normalized into a common dispatch shape so the UI can render even if the upstream field names vary.
- Each display signs into a specific unit so the idle screen can show that unit's information when there is no active dispatch.

## Getting Started

1. Copy `.env.example` to `.env.local`.
2. Fill in your FirstDue endpoint and auth header values.
3. Run the development server:

```bash
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment variables

- `FIRSTDUE_API_URL`: Full URL for the FirstDue dispatch endpoint you want to poll.
- `FIRSTDUE_API_METHOD`: Request method. Defaults to `GET`.
- `FIRSTDUE_API_HEADER_NAME`: Header name for auth. Defaults to `Authorization`.
- `FIRSTDUE_API_HEADER_VALUE`: Full header value, for example `Bearer abc123`.
- `FIRSTDUE_TIMEOUT_MS`: Upstream request timeout in milliseconds.
- `FIRSTDUE_POLL_INTERVAL_MS`: Server poll interval in milliseconds. This is the normal steady-state cadence for live dispatch pickup.
- `FIRSTDUE_MAX_BACKOFF_POLL_INTERVAL_MS`: Maximum temporary backoff interval after repeated upstream failures. Defaults to `60000`.
- `FIRSTDUE_POLL_LOCK_TTL_MS`: Redis lease time for the active poller instance.
- `DATABASE_URL`: Postgres connection string for durable snapshots, incidents, and event history. In hosted setups this can be the pooled connection.
- `POSTGRES_URL_NON_POOLING`: Optional direct Postgres connection string used for schema bootstrap and DDL. On Supabase this should be the direct database host, not `*.pooler.supabase.com`.
- `DISPATCH_RETENTION_DAYS`: Number of days to keep persisted dispatch data. Defaults to `30`.
- `REDIS_URL`: Redis connection string for cross-instance snapshot sharing and pub/sub.
- `REDIS_KEY_PREFIX`: Optional Redis key prefix. Defaults to `turnout`.
- `NEXT_PUBLIC_POLL_INTERVAL_MS`: Browser polling interval. Use `5000` to `10000` for a 5 to 10 second cadence.
- `NEXT_PUBLIC_WEATHER_POLL_INTERVAL_MS`: Weather refresh interval in milliseconds. Defaults to `300000` (5 minutes).
- `TURNOUT_SESSION_SECRET`: Secret used to sign the unit session cookie.
- `TURNOUT_WEATHER_TIMEOUT_MS`: NOAA weather request timeout in milliseconds.
- `TURNOUT_WEATHER_USER_AGENT`: User-Agent sent to the National Weather Service API. Include contact info if possible.
- `UNIT_ACCOUNTS_JSON`: JSON array of unit login credentials and idle-screen profile data.
  - Optional `coverageUnitId`: lets one logged-in unit temporarily follow another unit's apparatus record for dispatch matching and work orders while remaining its own screen identity.

## Notes

- Do not call FirstDue directly from the browser unless you are certain their API supports CORS and you are comfortable exposing client credentials. This app keeps the upstream call on the server.
- If your FirstDue payload uses different field names, update the key lists in [`src/lib/dispatches.ts`](/Users/michael_zucker/Sites/Turnout/src/lib/dispatches.ts).
- Postgres is optional but recommended for production. Without `DATABASE_URL`, the app still works, but incident history is limited to the live in-memory/Redis snapshot path.
- Persisted dispatch data is retained for 30 days by default. Yearly statistics continue to come directly from FirstDue so retention does not skew totals.
- Live weather uses the official National Weather Service API and NWS radar assets. For accurate weather, set exact `weatherLatitude` and `weatherLongitude` values per unit in `UNIT_ACCOUNTS_JSON`. `weatherStationId` is optional and lets you pin the observation station.
- If you want unit-specific idle content, edit the unit entries in [`UNIT_ACCOUNTS_JSON`](#environment-variables) or replace that env-driven config with your own data source.
- If FirstDue offers webhooks for your account, that is usually a better production design than tight polling.

## Scripts

- `npm run dev`: Start the local development server.
- `npm run build`: Build the app for production.
- `npm run start`: Run the production build.
- `npm run lint`: Run ESLint.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
