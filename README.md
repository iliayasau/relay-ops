# Relay Ops

A service reliability workspace for coordinating incident response. React, TypeScript, Express and SQLite power six fictional services, a durable incident log, response updates, and a read-only status page.

![Relay Ops workspace](docs/screenshots/workspace-1440.png)

## Quick start

Requires **Node.js 24+** and npm. No account, API key, external database or paid service is required.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The demo status page is at **/status**. SQLite is created and seeded on first startup at `data/relay.sqlite`; restarting preserves changes. Fonts are bundled locally.

```sh
npm run build
npm start
```

`PORT` changes the port. `DATABASE_PATH` selects another SQLite file in local mode. To start a fresh local demo, stop the server and choose a new database path. Back up with SQLite backup tools; do not copy only the main database while WAL writes are active. The default host is `127.0.0.1`; external binding is refused unless `DEMO_MODE=public` is enabled.

## Hosted demo on Render Free

The repository includes `render.yaml` for one **free Node web service**, with no database service or paid disk. It serves the actual React bundle and Express/SQLite backend. Import the repository as a Render Blueprint, or use these settings for a Web Service:

| Setting        | Value                                   |
| -------------- | --------------------------------------- |
| Runtime / plan | Node / Free                             |
| Branch         | `main`                                  |
| Build          | `npm ci --include=dev && npm run build` |
| Start          | `npm start`                             |
| Health check   | `/healthz`                              |
| `NODE_VERSION` | `24.19.0`                               |
| `NODE_ENV`     | `production`                            |
| `HOST`         | `0.0.0.0`                               |
| `DEMO_MODE`    | `public`                                |

Render provides `PORT` and `RENDER_EXTERNAL_URL`. The latter is the exact allowed browser origin for writes. For another host or a custom domain, set `PUBLIC_ORIGIN` to the exact HTTPS origin, without a trailing slash. Requests from an alternate hostname cannot write unless it is the configured origin. No credential or application secret is required. Auto-deploys are configured to wait for passing checks; actual service creation is separate from this repository configuration.

**Hosted data is temporary.** Every visitor receives an independent SQLite sandbox through an opaque, host-only HttpOnly cookie (Secure on HTTPS, SameSite=Lax). It lasts at most one hour, preserving changes across page refreshes in that browser. Restart, redeploy or free-instance sleep resets all sandboxes. The status page shows the current browser's sandbox, not a global feed. There is no account or sign-in, and these anonymous sandboxes must not contain real personal or operational information.

[Render Free services sleep after idle time and lose local files on restart, redeploy or spin-down](https://render.com/docs/free). Cold starts can take about a minute. Use the Free plan only; this configuration does not attach paid storage or create a paid database. Render usage limits and billing settings remain provider-controlled: review the account's spending settings before deployment, and do not assume unlimited traffic or uptime.

The demo enforces 50 simultaneous sandboxes, 30 new sandboxes per minute and 300 API requests per minute across the process. Each sandbox permits 120 reads and 20 writes per minute, 20 total incidents (including fixtures) and 25 timeline events per incident. Limit responses use HTTP 429/503 with retry guidance, or 409 for record caps. Expired-cookie writes return 409 and require refreshing into a fresh sandbox. Idle expiry removes the SQLite files. These are bounded, single-process demo controls, not a distributed abuse-prevention system; heavy traffic can temporarily exhaust demo capacity.

Mutation requests require the exact configured Origin, JSON content type and a valid session cookie. Cross-site Fetch Metadata is rejected, request bodies are capped at 16 KiB, and production pages include a restrictive content security policy. No proxy IP or forwarded Host header is trusted for session identity or Origin checks. A cookie is a temporary sandbox capability, not a verified user identity.

Local public-mode rehearsal (PowerShell):

```powershell
$env:DEMO_MODE='public'
$env:PUBLIC_ORIGIN='http://127.0.0.1:3000'
npm run build
npm start
```

To return to durable local mode, clear `DEMO_MODE` and `PUBLIC_ORIGIN` before restarting. `/healthz` does not create a session and remains available when demo capacity is full. It reports process readiness, not external monitoring or an uptime guarantee.

## Explore

- **Overview:** derived service health, response counts, incident filters and search.
- **Incidents:** declare an incident, select severity and service, assign a lead, change status and append a required response note. Resolved incidents can be reopened.
- **Services:** related service records with teams and regions. Signal bars are illustrative, not measured telemetry.
- **Status page:** read-only health and fixed public incident summaries for the current workspace. Internal titles, descriptions, notes and operator identities are never returned by its API.
- **Preview state:** loading, empty and error presentations without changing stored data.

Try declaring a SEV1 incident for Object storage, assigning Theo Martin, and resolving it with a recovery note. Reload and check the timeline and status page.

## Architecture

```text
React workspace / status view
          │ same-origin JSON
Express API + Zod validation
          │ transaction + version check
SQLite (services → incidents → events)
```

`src/domain.ts` shares schemas, types and the health rule. `server/store.ts` owns persistence; SQL uses bound parameters and foreign keys. Mutations and timeline events commit atomically. Each update supplies the observed version: a stale writer gets HTTP 409. Refresh and reopen the incident before retrying a conflict.

`server/app.ts` maps validation and domain failures to JSON. The Node server runs Vite middleware in development and serves the production bundle after building. The client-rendered application needs no separate API process or CORS configuration.

`server/demo.ts` selects a per-visitor store in hosted mode, with random capability cookies, request budgets, expiry and cleanup. Local mode retains one durable database and must remain loopback-only. Public mode never opens that local database.

| Endpoint                   | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `GET /api/snapshot`        | Services, incidents and history                                |
| `POST /api/incidents`      | Validated incident creation                                    |
| `GET /api/public/status`   | Allowlisted public service health and fixed incident summaries |
| `PATCH /api/incidents/:id` | Versioned status/lead update and required note                 |

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests use isolated SQLite databases and cover persistence after reopening, atomic timelines, invalid payloads/references, malformed JSON, missing records and competing writers. Hosted-mode contracts additionally cover visitor separation, exact public fields, secure cookie attributes, expiry, CSRF checks, rate limits and storage caps. Browser tests run against production builds in both local and hosted-demo modes, exercise creation through resolution and reload, preserve drafts after delayed responses, cover empty/error/loading states, scan accessibility with axe, and inspect desktop, tablet and mobile layouts. Local E2E uses a fresh `data/e2e-<process-id>.sqlite`; hosted E2E uses temporary visitor databases. Screenshots are saved to `docs/screenshots`.

GitHub Actions runs the same checks. Automated accessibility checks complement manual keyboard and screen-reader review.

## Demo boundaries

All services, people and incidents are fictional. Metrics count those records; no real customers, measured uptime or production reliability are claimed. Seed timestamps are relative to first database creation.

There is no personal authentication, verified audit identity, monitoring ingestion or alert delivery. Local mode is a single workspace bound to loopback; hosted mode isolates temporary visitor workspaces as described above. The status page requests only `/api/public/status`: an explicit allowlist of service ID/name/health and incident ID/service ID/status/update time plus fixed, server-composed titles and summaries. Operator-authored titles, descriptions and notes, assignments, versions, team and region details are excluded. Within their own sandbox, visitors can use all operator APIs. Do not enter confidential information. Creation has no replay key, so retrying after a lost response may create a duplicate. Refresh retrieves current data; there is no automatic polling. SQLite synchronous access suits this small dataset, not high-volume telemetry.

Before using this for real operational work, add authenticated operators, role-based permissions, publication controls, backups, migrations, observability and durable hosting-appropriate storage. The hosted sandbox is a portfolio demo, not an incident-management service for real teams.

## References

- [React effects](https://react.dev/reference/react/useEffect)
- [Vite guide](https://vite.dev/guide/)
- [Express API](https://expressjs.com/en/5x/api/)
- [Node SQLite](https://nodejs.org/api/sqlite.html)
- [Playwright web servers](https://playwright.dev/docs/test-webserver)

Portfolio context: [Ilia Yasau](https://github.com/iliayasau).
