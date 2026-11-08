# Project architecture

```mermaid
flowchart LR
  K[Kiosk page /kiosk] --> SRV
  C[Customer phone /queue/session/…] --> SRV
  ST[Staff] --> SRV
  KD[Kitchen display] --> SRV
  AD[Admin + analytics] --> SRV
  subgraph SRV[Local DineFlow server – Node, no dependencies]
    API[/api/act, login, events (SSE)/] --> ACT[actions.js + engines.js]
    ACT --> DB[(data/demo-db.json)]
  end
  SRV -.optional.-> PA[Power Automate webhook]
```

One server holds **one state**; every screen on every device is a live view of it (Server-Sent Events push each change; the browser reconnects by itself). The same action code (`src/lib/actions.js`) runs on the server (authoritative) and, when no server is present (`npm run dev`), in the browser (local mode).

## Layout (deliberately flat)
| Path | Role |
|---|---|
| `server/server.mjs` | HTTP server: static files, `/api/*`, SSE, roles, per-role redaction, payments check, webhooks, JSON-file persistence |
| `src/lib/engines.js` | Pure functions: wait prediction, fair seating, kitchen lanes, estimates, pre-order scheduler |
| `src/lib/actions.js` | Every state change with validation; `housekeeping()` each 5 s (no-shows, cleaning, start scheduled dishes) |
| `src/lib/seed.js` | Menues + synthetic history |
| `src/lib/store.jsx` | Client store: server mode (SSE + `/api/act`) or local mode (localStorage) |
| `src/pages/Kiosk.jsx`, `kiosk.html` | Entrance kiosk page |
| `src/pages/*`, `src/components/*` | Customer, staff, kitchen, admin screens |
| `scripts/launch|stop|reset.mjs`, `*.bat|.sh|.command` | One-click launchers |
| `scripts/test-*.mjs`, `scripts/e2e.cjs` | Unit, server/security and multi-device browser tests |

## Key design decisions
- **Personal queue link:** `newSessionToken()` = 24 random bytes (192 bits, base64url). URL `/queue/session/<token>` never contains the phone number. It proves ownership for customer actions (join/cancel/order/pay); it expires; staff can reissue; a duplicate phone number is refused rather than returning the old link.
- **Redaction:** staff get everything except the kiosk PIN; kitchen and public never receive phone numbers, names of customers, session secrets, payments.
- **Table linkage:** `seatEntry` extends the session and links orders to the table; the same personal link then drives table ordering.
- **Payments:** a simulated Pay button calls the `payOrder` action with an idempotency key (a double tap cannot pay twice); the server forces mode `demo`. The order, payment record and kitchen tasks are written to the database and pushed to all screens. No provider, no card data.
- **Estimates are rules, not machine learning**, and labelled as estimates with a confidence level.
- **Production path:** `DATABASE_SCHEMA.sql` is the relational design (session tokens stored hashed, RLS, unique active entry per customer); replace the JSON file with Postgres behind the same action layer.

## Security notes and limits
HttpOnly cookies, login throttling, request-size limits, path-traversal guard, no secrets in browser code. This is a LAN demo server: it serves plain http, has no per-user accounts and no audit log.
