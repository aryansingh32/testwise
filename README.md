# Testwise

Competitive testing platform for Indian students: Test War tournaments, 1v1 duels, test series, transparent results.

| App | Path | Stack |
|---|---|---|
| Student app | `apps/mobile` | Expo SDK 57 (React Native), Expo Router, TypeScript |
| Admin control centre | `apps/admin` | React 19, Vite, Tailwind 4, TanStack Query |
| API | `apps/api` | NestJS 11, Prisma 6, PostgreSQL |
| Shared | `packages/shared` | zod schemas, enums, permissions, config registry, DTO types |

See [docs/PLAN.md](docs/PLAN.md) for the product plan, decisions and milestones.
See [docs/SCALING-AND-EXAM-INTEGRITY.md](docs/SCALING-AND-EXAM-INTEGRITY.md) for the horizontal-scaling target, 1,000-session acceptance gates, duel/bot improvements, and privacy-bounded proctoring architecture.

## Prerequisites

- Node 20.12+ and pnpm
- Docker (for local PostgreSQL)

## First run

```bash
pnpm install
pnpm db:up                      # PostgreSQL on localhost:5433
cp apps/api/.env.example apps/api/.env   # then set real JWT secrets (32+ chars)
pnpm build:shared
pnpm db:migrate                 # applies migrations
pnpm db:seed                    # exams, subjects, sample questions, banners, tournaments, admin user
```

The seed prints the admin login (default `admin@testwise.local` / `ChangeMe!2026`, override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Change it before any shared deployment.

## Run

```bash
pnpm dev:api      # http://localhost:4000  (health: /health)
pnpm dev:admin    # http://localhost:5173
pnpm dev:mobile   # Expo dev server: press w for web, or scan with a development build / Expo Go
```

The mobile app reads the API URL from `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`. On a physical phone use your computer's LAN IP (e.g. `http://192.168.1.20:4000`) and add it to `CORS_ORIGINS` only if testing the web build.

For a multi-replica production API, set `DUELS_ENGINE_ENABLED=false` on every HTTP API replica and `true` on exactly one dedicated duel service. Route `/duels` Socket.IO traffic to that service. Duel game state is still held in memory, so the duel service must remain a single replica until durable duel ownership/state is implemented. This role split prevents HTTP scaling from accidentally creating multiple independent duel engines; it is not a 1,000-user capacity guarantee. Also set `ANSWER_ANALYSIS_ENABLED=false` on HTTP replicas and run it on one worker. Measured results and sizing guidance are in [docs/SCALING-AND-EXAM-INTEGRITY.md](docs/SCALING-AND-EXAM-INTEGRITY.md#measured-capacity-local-run-2026-10-12).

## Checks

```bash
pnpm typecheck
pnpm test                       # API unit tests
cd apps/mobile && npx expo-doctor
```

## Temporary authentication

Until the Firebase project exists, students sign in with email + password issued by the API (bcrypt, short-lived JWT + rotating refresh tokens). Google and mobile OTP buttons are built and controlled from **Admin → Settings → Login methods**; they stay off until Firebase / an SMS provider is connected. Admins use email + password; two-factor login arrives with Firebase.

## Payments

Payments run through a gateway adapter chosen in **Admin → Settings → Payment gateway**:

- **MOCK** (default): behaves like a real gateway (orders, HMAC-signed webhooks, refunds, ledger entries) but moves no money. The app shows a clearly labelled *test mode* checkout.
- **RAZORPAY**: hosted checkout via Payment Links. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and point the Razorpay webhook to `{PUBLIC_BASE_URL}/v1/payments/webhooks/razorpay` (events `payment_link.paid`, `payment.failed`, `refund.processed`). Admin refuses to select it until the keys are present.
- **PAYTM**: adapter not implemented yet; admin refuses to select it.

Paid entry, cash prizes and entry-funded prize pools are also gated by **Settings → Money model** (all off by default). Keep them off until you have legal sign-off.

## Push notifications

Every notification goes through one pipeline: an in-app inbox row plus a push job. Admins edit the text (English and Hindi), push/inbox switches and on/off state of all ~40 automatic events in **Admin → Notifications → Templates**, send custom notifications (one student, a pasted/CSV list, a tournament, an exam, a segment or everyone; now or scheduled), and see every delivery in **Deliveries**. Reminder timings live in **Settings → Notification timing**.

Push needs a native build of the app (development build or store build). It does not work in Expo Go or on the web; those still get the in-app inbox.

**Android (Firebase Cloud Messaging)**
1. Create a Firebase project and add an Android app with package `app.testwise.student`.
2. Download `google-services.json` into `apps/mobile/` (git-ignored; for EAS builds set the `GOOGLE_SERVICES_JSON` file env var instead).
3. In Firebase → Project settings → Service accounts, generate a private key and set `FIREBASE_SERVICE_ACCOUNT` on the API.

**iOS (Apple Push Notification service)**
1. In the Apple developer portal create an APNs key (.p8).
2. Set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (contents of the .p8), `APNS_BUNDLE_ID`, and `APNS_PRODUCTION=true` for TestFlight/App Store builds.

Then build: `cd apps/mobile && npx eas-cli@latest build --profile development` (or `npx expo run:android`). Use **Admin → Notifications → Push setup → Send a test push** to check a phone.

## 1v1 duels

Real-time over Socket.IO (`/duels` namespace on the API). Matchmaking, question pacing, answer timing and scoring all run on the server. If no human is found within the configured wait, a bot persona joins — only in free, no-reward duels, never in tournaments; this is disclosed in the FAQ. Rules, rating, XP and leagues are in **Settings → Duel rules**; bot behaviour in **Settings → Duel bots**; personas and live stats in **Admin → Duels & bots**. The duel engine keeps live matches in memory, so run a single API instance (or add a Redis adapter before scaling out).

## Errors and resilience

Every error response has one shape, and the same id is in the `x-request-id` header and the server log line:

```json
{ "statusCode": 404, "error": "Not Found", "message": "Order not found", "requestId": "…" }
```

Validation failures add `issues: [{ path, message }]`. Status codes you can rely on: `400` bad input, `401` not signed in, `403` not allowed, `404` not found (including database "record not found"), `409` conflict/duplicate, `413` body too large, `429` rate limited or account locked, `503` + `Retry-After` when the database is saturated or unreachable (clients retry; it is not a bug). Unexpected errors are `500` with a generic message; details go to the log only, tagged with the request id.

Degraded dependencies:
- **Redis down**: the API keeps serving. Rate limits fall back to per-process counters, caches fall back to the database, background jobs pause, `/health` reports `degraded`.
- **Postgres down**: database-backed routes fail fast with `503 + Retry-After`; `/health` returns `503`. Cached public config keeps working. It recovers on its own.
- **Deploys**: on `SIGTERM` the instance reports `503 draining` on `/health`, waits `SHUTDOWN_DELAY_MS` (set ~5000 behind a load balancer so it deregisters first), stops accepting connections, lets in-flight requests finish (up to `SHUTDOWN_TIMEOUT_MS`, default 25000), then exits.

Client rules (mobile and admin): requests time out, safe requests retry with backoff on `429/502/503/504`/network errors, and a student is signed out **only** when the server definitively rejects the refresh token, never because of a transient failure. Both apps show a recoverable error screen instead of a blank/crashed one if a screen throws.

## Admin-controlled behaviour

Every business setting the app reads lives in `packages/shared/src/config.ts` (`CONFIG_REGISTRY`) and is edited in **Admin → Settings**: login methods, payment gateway and payment rules, money model, age policy, exam integrity (grace period, autosave, app-switch handling), results & leaderboards, XP and daily missions, support contact, maintenance mode and minimum app version, feature flags and duel bots. Content (questions, tests, test series, coupons, tournaments, banners, Home sections, FAQs, announcements) is managed in its own admin pages. Changes are versioned and written to the append-only audit log.
