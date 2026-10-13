# Testwise — Project Plan

Status: M0–M6 built · Last updated 2026-10-11

## 1. Decisions locked

| Topic | Decision |
|---|---|
| Student app | React Native + Expo (TypeScript), Expo Router; Expo web later for the responsive web app |
| Backend | Node.js · NestJS modular monolith · PostgreSQL (Prisma) · Redis · Socket.IO |
| Admin panel | React + Vite + TypeScript, built in parallel with the student app — full control centre incl. content upload |
| Hosting | Railway (api, worker, postgres, redis; staging + production environments) |
| Audience | Both school students (Class 6–12) and competitive-exam aspirants |
| Visual direction | Hybrid: light amber theme for learning/store, dark navy **Arena mode** for tournaments, duels, results |
| Money model | Fully configurable per tournament (free/paid entry; cash / non-cash / sponsor-funded rewards). Final model decided after legal review |
| Phase 1 scope | Mobile UI, backend and admin panel built in parallel |
| Name | **Testwise** (working name) |
| Login | Firebase Auth: Google sign-in + email/password live; phone OTP built but **disabled** until a provider is chosen; each method toggled from admin |
| Payments | `PaymentProvider` interface with **Razorpay** and **Paytm** adapters; active gateway chosen in admin; mock provider until legal sign-off |
| Content upload | Bulk CSV/Excel import using a downloadable template, plus manual question entry in admin |
| Control principle | Admin panel controls everything: the app reads its config from the server, nothing business-related is hard-coded |
| Languages | English + Hindi for both app UI and question content |
| 1v1 fallback | Bot opponent when no human is found; bot difficulty and accuracy controlled from admin (see §6) |

### Legal flag (blocking for real money)
India's Promotion and Regulation of Online Gaming Act, 2025 prohibits "online money games" (fee paid in expectation of monetary/other winnings), regardless of skill. Paid-entry tournaments with entry-funded prizes, and paid duels, likely fall in scope; minors add further restrictions. **No real payments go live before written legal advice.** Until then the payment provider is a mock that behaves like a real gateway (orders, signed webhooks, refunds), so the ledger and flows are real.

## 2. Repository layout

```
testwise/
  apps/
    mobile/      Expo app (iOS, Android, web)
    api/         NestJS API + Socket.IO gateway
    worker/      BullMQ jobs (scoring, results, notifications) — can start inside api
    admin/       React admin control centre
  packages/
    shared/      zod schemas, enums, DTO types shared by all apps
    config/      eslint, tsconfig, prettier presets
  docs/
  reference/     the UXPilot HTML + image references
```

Tooling: pnpm workspaces + Turborepo, GitHub Actions CI (typecheck, lint, test), Docker Compose for local Postgres/Redis.

## 3. Mobile app architecture

- **Styling:** React Native StyleSheet on design tokens (`src/theme/tokens.ts`) with two themes, `light` and `arena`. (NativeWind was dropped: its setup is fragile on SDK 57 and plain styles keep native and web identical.)
- **Animation:** Reanimated + Skia to be added in M6 for duel effects (matchmaking orbit, rank shuffle).
- **Data:** TanStack Query for server state; React context for the session; local exam/duel state and socket.io-client arrive in M3/M6.
- **Offline/resilience:** exam answers queued locally (MMKV) and flushed with idempotency keys; server is the source of truth for time and score.
- **Navigation (bottom tabs):** Home · Arena · My Tests · Store · Profile. Exam player and duel are full-screen stacks outside the tabs.

### Design tokens (from reference)
- Light: primary amber `#F59E0B`, success `#10B981`, info `#3B82F6`, violet `#8B5CF6`, ink `#1F2937`, radii 16/24/32, weight 700–800 headings.
- Arena: navy gradient `#0B1530 → #050A1A`, glow rings per rank tier, rating chip in amber, white question card on dark (as in battle reference).

### Languages (English + Hindi)
- **App UI:** i18next + expo-localization; all strings in `locales/en.json` and `locales/hi.json`; language picked at onboarding and switchable in Settings. Fonts: Plus Jakarta Sans / Inter for Latin + Noto Sans Devanagari for Hindi.
- **Content:** every question, option, solution, tournament title/rules and banner stores both `en` and `hi` (Hindi optional per item, with a fallback to English and a "Hindi not available" marker).
- **Exam player:** a language toggle mid-test (same question, other language) — common in SSC/Bank exams.
- **Admin:** content editor shows EN/HI side by side; missing-translation report.

## 4. Screen inventory (Phase 1)

1. **Shell & onboarding** — splash, intro slides, login (Continue with Google, email/password with sign-up/forgot password; mobile OTP shown only when enabled in admin), branch: *School (class, board, DOB, guardian consent)* vs *Exam aspirant (target exams)*, language preference.
2. **Home** — greeting, live/upcoming Test War carousel with countdowns, Continue Learning, daily missions + streak, Popular exams, Recommended packs, leaderboard teaser.
3. **Arena tab** — tabs: Tournaments · 1v1 Duels · Leagues; filters (exam/class/subject/format/fee).
4. **Tournament detail (transparency page)** — rules, eligibility, scoring + tie-breaks, entry fee breakdown, prize table, min-participant rule, schedule, refund/cancellation terms, rule-change history, live participant count.
5. **Registration** — eligibility check → payment (mock gateway) → receipt with transaction ID → check-in reminder.
6. **Exam player** — instructions + device pre-check, section tabs, server-synced timer, question strip + full palette sheet with legend, mark for review, report question, calculator, connection/autosave indicator, submit summary, completion receipt.
7. **1v1 Duel** — lobby → finding a match → live duel (split header, per-question timer, opponent progress) → win/lose/draw → rank recalculation animation → rematch.
8. **Results** — provisional vs official leaderboard, my score breakdown, percentile, rank movement, result state badge (Provisional / Under review / Final / Reward approved / Paid), appeal entry, scorecard download, verification link.
9. **Store** — marketplace, series detail (reference "Test Details"), cart/checkout, orders.
10. **My Tests & Analysis** — purchased series, attempts, analytics, incorrect-answer notebook, saved questions.
11. **Profile** — achievements, rating/league, payment history, rewards & payout status, notifications, settings, privacy (export/delete), help/support tickets.

## 5. Backend modules (NestJS)

| Module | Phase 1 responsibility |
|---|---|
| `identity` | Verifies Firebase ID tokens (firebase-admin), maps Firebase UID → internal user, profiles, audience type, guardian-consent flag, age policy, enabled-login-methods policy |
| `catalog` | Exam/class/subject/topic taxonomy |
| `questions` | Questions with versions, options, answers (never sent to client before submit) |
| `tests` | Test + section definitions, variants/randomisation seed |
| `tournaments` | Tournament config + lifecycle state machine, registration, caps/waitlist, check-in |
| `attempts` | Server-timed attempts, autosave (idempotent), submit, scoring |
| `results` | Provisional → under review → final; versioned result publication; Redis leaderboards |
| `duels` | Matchmaking queue (Redis, by exam + rating band), Socket.IO rooms, server-paced questions, Glicko-2/Elo rating, bot fallback |
| `bots` | Bot personas (name, avatar, rating), difficulty profiles, answer engine; config owned by admin |
| `cms` | Banners/carousel, home sections, announcements, FAQs, static pages (all bilingual) |
| `admin` | Admin auth (MFA), RBAC roles/permissions, approval requests (dual approval) |
| `payments` | `PaymentProvider` interface with `RazorpayProvider`, `PaytmProvider`, `MockProvider`; orders, signed-webhook verification, idempotency, refunds; active provider from admin config |
| `ledger` | Append-only double-entry ledger; prize liability accounts separate from revenue |
| `rewards` | Prize rules, eligibility, approval states, payout status (mock) |
| `audit` | Append-only audit events for every admin/financial/result change |
| `notifications` | Push (Expo push), in-app inbox |
| `policy` | Feature flags + versioned config (money model, age rules) |

Ledger, audit events and result versioning exist from day one even with mock money — retrofitting them later is the expensive path.

### Key state machines
- Tournament: `DRAFT → SCHEDULED → REG_OPEN → REG_CLOSED → LIVE → IN_REVIEW → FINAL → REWARDS_APPROVED → CLOSED` (+ `CANCELLED` from any pre-final state, triggering refunds).
- Result: `PROVISIONAL → UNDER_REVIEW → FINAL` (reopen only via audited correction creating a new version).
- Payment: `CREATED → PENDING → SUCCEEDED | FAILED → (REFUND_PENDING → REFUNDED)`.
- Reward: `ELIGIBLE → APPROVED → PAYOUT_PENDING → PAID | FAILED | UNCLAIMED`.

### Age / audience policy (configurable)
- Under-18 accounts: paid entry disabled by default, guardian consent required for any purchase, no public real name on leaderboards.

## 6. 1v1 bot opponents

**Behaviour:** if no human match is found within N seconds (admin-set, e.g. 8–15 s), the server pairs the player with a bot. The bot appears in the duel UI like any other opponent (persona name, avatar, rating close to the player's).

**Admin controls (per exam / globally, versioned):**
- Enable/disable bots; wait time before a bot is used
- Difficulty profiles: target accuracy %, per-difficulty accuracy curve, answer-time range (min/max, with human-like jitter), occasional skips
- "Knows answers" mode: *on* = bot uses the stored answer key filtered through its accuracy setting; *off* = bot answers by weighted guessing only
- Adaptive mode: pick a bot profile from the player's rating so matches stay close
- Persona pool: names, avatars, rating ranges, city
- Reports: bot match count, human win-rate vs bots, bot usage by hour (to see when real-player liquidity is low)

**Hard rules enforced on the server (not admin-toggleable):**
- Bots are matched only in **free, no-reward** duels. Any duel with a paid entry, cash/voucher prize or reward eligibility never gets a bot — it waits for a human or refunds/cancels. If players pay or win prizes, a house-controlled opponent that admin can tune to know answers would be a rigged contest (consumer-protection and fraud exposure, and it breaks the Transparency pillar).
- Bot results never feed tournament leaderboards, prize eligibility or the public winners' wall. They can affect a separate practice duel rating.
- Terms of service disclose that practice duels may use computer-controlled opponents.
- Every bot match is flagged internally (`isBot`) and visible to admins/analytics, never exposed in the client payload.

## 7. Admin control centre (Phase 1 scope)

React + Vite + TypeScript, TanStack Query/Table, shadcn/ui, React Hook Form + zod (shared schemas). Desktop-first, responsive.

| Area | Phase 1 capabilities |
|---|---|
| Dashboard | Users, active/upcoming tournaments, registrations, attempts, revenue (mock), duel & bot stats |
| Content — questions | Create/edit with rich text, LaTeX/math, images; EN/HI side by side; taxonomy tags (exam/class/subject/topic/difficulty); review → approve workflow; versioning; duplicate detection |
| Content — bulk upload | CSV/Excel template import with row-level validation preview; image zip upload; import history and rollback of an import batch |
| Tests & series | Assemble tests from pools (manual or rule-based), sections, marking/negative marking, timers, randomisation; test-series packs with price and validity |
| Tournaments | Create/duplicate/template, schedule, caps/waitlist, entry mode & fee, prize table, eligibility, scoring/tie-break rules, publish/pause/cancel, live monitor |
| Results | Provisional/final views, freeze/finalise, audited score corrections, republish versions |
| Duels & bots | Matchmaking settings, bot profiles and personas, wait times, reports (§6) |
| CMS | Home carousel/banners, home section order, announcements, push campaigns, FAQs, legal pages (bilingual) |
| Users | Search, profile, history, payments, warn/suspend/reinstate, support tickets |
| Finance (mock) | Orders, transactions, ledger view, refunds with approval, reward/payout queue |
| Config | Feature flags, money-model policy, age policy, versioned with change history |
| Access | Roles (super-admin, ops, content, finance, fraud, support), permissions, MFA, audit-log viewer |

Every admin write goes through the `audit` module; finance, result corrections and policy changes require a second approver.

### Authentication (Firebase)
- **Student app:** `@react-native-firebase/auth` + Google Sign-In. Methods: Google, email/password (with email verification + password reset), phone OTP (code complete, hidden behind the `auth.phoneOtp.enabled` flag). Firebase's own phone auth is one OTP option; an Indian SMS provider (e.g. MSG91) can be plugged in instead later.
- **Backend:** never trusts the client: every request carries a Firebase ID token, verified server-side; roles, bans and profile live in our Postgres.
- **Admin panel:** Firebase email/password with mandatory TOTP MFA; admin roles/permissions in our DB; admins disabled in Firebase and our DB at once.
- **Admin controls:** enable/disable each login method, force logout a user, disable an account, view linked sign-in methods.

### Payments (Razorpay / Paytm)
- Both adapters implement the same interface (`createOrder`, `verifyWebhook`, `fetchPayment`, `refund`, `settlementReport`), so switching is a config change in admin, not a code change.
- Default recommendation: **Razorpay** — better developer docs, webhooks and React Native SDK, and 0% platform fee for new merchants' first 90 days; UPI MDR is zero but both charge a ~2% platform fee on standard plans, so the real decision is the negotiated UPI rate each offers you. Ask both for a custom quote at your expected volume.
- Payment success is decided only by verified webhook + server-side fetch, never by the app.
- Stays on `MockProvider` until legal sign-off on the money model.

### Question bulk upload
- Admin → Questions → Import → **Download template** (`.xlsx` with dropdown validation and an instructions sheet, or `.csv`).
- Template columns:

| Column | Notes |
|---|---|
| `ref_id` | Your own ID; re-uploading the same ID updates instead of duplicating |
| `exam`, `class`, `subject`, `topic` | Must match taxonomy (dropdowns in the xlsx) |
| `difficulty` | easy / medium / hard |
| `type` | `MCQ_SINGLE`, `MCQ_MULTI`, `NUMERIC` |
| `question_en`, `question_hi` | Math via LaTeX `$...$`; Hindi optional |
| `option_a_en` … `option_f_en`, `option_a_hi` … `option_f_hi` | 2–6 options; blank for NUMERIC |
| `correct` | `B` / `A,C` / numeric value |
| `numeric_tolerance` | For NUMERIC only |
| `marks`, `negative_marks` | Defaults from test if blank |
| `solution_en`, `solution_hi` | Optional |
| `question_image`, `solution_image` | File names inside an accompanying images `.zip` |
| `tags`, `source`, `licence` | Optional metadata |

- Flow: upload → server validates every row → preview with errors per row (fix and re-upload, or import only valid rows) → questions land in **Draft** → reviewer approves → available for tests.
- Each import is a batch with history; a whole batch can be rolled back.
- Manual entry uses the same fields in a form editor with live preview (EN/HI side by side, LaTeX rendering, image upload).

### Admin controls everything
Everything the app shows or enforces comes from server config managed in admin, versioned and audited:
- Login methods, payment gateway, money-model and age policies
- Home layout: carousel banners, section order, featured tournaments/series
- Tournaments, tests, series, prices, coupons
- Duel matchmaking and bot settings
- Notifications and announcements
- App texts that may change (FAQs, legal pages, onboarding copy) in EN/HI
- Feature flags for every module (turn a feature off without an app update)
- Maintenance mode and minimum app version (force update)

## 8. Milestones

| # | Milestone | Mobile | Backend |
|---|---|---|---|
| # | Milestone | Mobile | Admin | Backend |
|---|---|---|---|---|
| M0 | Foundation | Expo app, tokens, both themes, i18n (en/hi), core UI kit | Vite app, layout, admin login, RBAC shell | Monorepo, NestJS skeleton, Prisma schema v1, audit module, Docker Compose, Railway staging, CI |
| M1 | Auth & content | Splash, Google + email/password login (OTP hidden), school/exam branching, language & preferences | Admin login + MFA, taxonomy, question editor (EN/HI), template download + bulk import, review workflow | Firebase token verification, `identity`, `admin`, `catalog`, `questions` |
| M2 | Home & discovery | Home, Arena tab, tournament list/detail | CMS banners/sections, tournament builder | `cms`, `tournaments` |
| M3 | Test engine | Exam player end-to-end (with language toggle) | Test assembly, test series | `tests`, `attempts`, scoring |
| M4 | Registration & money | Register, pay (Razorpay/Paytm checkout, mock mode), receipt, payment history | Gateway selection, orders, ledger, refunds | `payments` (Razorpay + Paytm + mock adapters), `ledger` |
| M5 | Results | Leaderboards, result states, scorecard | Result review, finalise, corrections | `results`, Redis leaderboards, worker |
| M6 | 1v1 Arena | Lobby, matchmaking, duel, rank update, rematch | Duel & bot settings, persona pool, reports | `duels`, `bots`, sockets, ratings |
| M7 | Store & profile | Store, My Tests, Analysis, Profile, notifications | Users, support, dashboard, config/flags | Orders, analytics, push |
| — | Next phases | Real gateway (post legal), fraud engine, load testing, web polish | Fraud ops centre, BI | |

## 9. Progress

### Done (M0–M2)
- Monorepo, shared package, temporary auth, onboarding with age/guardian policy, admin RBAC, taxonomy, questions with versioning/review, bulk import (xlsx/csv + images, rollback), tournaments with lifecycle and money-policy gate, CMS, versioned settings, append-only audit log.

### Done (M3–M5)
- **Tests (M3):** admin test builder (sections, per-question marks overrides, auto-assemble from approved pool, shuffle questions/options, answer-key policy, attempt limits, publish requires approved questions, frozen once attempted). Server-frozen papers per attempt (answer key never sent), server-timed attempts with grace period, autosave + offline queue, app-switch logging with optional auto-submit, server scoring (single, multi with all-or-nothing/partial, numeric with tolerance), sweeper auto-submits expired attempts. Student exam player (instructions, sections, palette, mark for review, EN/HI switch, numeric input, submit summary), results with section breakdown and solutions, analysis and mistakes notebook.
- **Store:** test series (price, MRP, validity, highlights, free previews, featured), coupons, free unlocks, admin access grants.
- **Payments & ledger (M4):** idempotent orders, MOCK gateway with signed webhooks, Razorpay Payment Links adapter, webhook replay protection and signature checks, amount verification, late-payment auto-refund, double-entry ledger (prize liability separate from revenue, gateway fees), refunds with dual approval above a configurable threshold, automatic refunds on tournament cancellation, checkout expiry, reconciliation view, receipts.
- **Registrations:** eligibility (audience, class, age, minors and paid entry, guardian consent), seat locking, waitlist with auto-promotion (free), paid registration via checkout, cancellation with refund.
- **Lifecycle:** auto open/close registration, auto go-live (or auto-cancel below minimum participants), auto close window → submit open attempts → review → provisional results.
- **Results (M5):** live leaderboard, versioned provisional results, disqualify/reinstate/adjust with reasons (new version each time, re-ranked), finalise, controlled reopen, published tie-break order, percentiles, rewards (approve → paid with payout reference, withhold) with ledger postings, public verification page, minor-name privacy, answer-key release rules.
- **Engagement & support:** XP (tests, correct answers, joining, top-10, daily login), configurable daily missions, Home leaderboard, notifications inbox (system events + admin announcements), FAQs, support tickets (appeals, payments, deletion requests), data export, account deletion (anonymise; financial and result records retained).
- **Verified:** 67-check API end-to-end script, 19 unit tests, migration applies to a fresh database with no drift, all apps typecheck, full student flow driven in the web build, admin pages rendered.

### Done (M6 + notifications)
- **1v1 duels:** Socket.IO matchmaking by exam and widening rating window, server-paced questions with speed bonus, Elo ratings and leagues (tiers in Settings), XP, friend challenges by code (unrated), rematches, forfeits, reconnect/resume, history and leaderboard. Bots (admin-managed personas, accuracy/speed/knows-answers/adaptive settings) only in free ranked duels; disclosed in FAQ. Admin stats (bot share, human win rate vs bots) and duel list.
- **Notifications:** catalog of 40 events across 8 categories with admin-editable EN/HI templates, push/inbox switches and kill switch; push via Firebase Admin (Android) and APNs HTTP/2 (iOS) with a queued worker, retries, invalid-token cleanup, per-student category mutes, quiet hours and daily promo caps for promotions; automatic reminders (start, window closing, last call, seats filling fast, new tournaments for followed exams, streaks, access expiring); admin campaigns (single, bulk list/CSV, tournament, exam, segment, everyone; scheduled) with open tracking; delivery log; push status and test push. App: permission pre-prompt, Android channels per category, tap-to-open deep links, notification settings, inbox filters, local "5 minutes left" reminder during tests.

### Not yet done
- Railway deployment (needs your go-ahead).
- Firebase auth, admin MFA, password reset (waiting for Firebase project).
- Paytm adapter; native Razorpay SDK (hosted checkout works without it).
- Push notifications (in-app inbox only), image storage on a bucket, PDF scorecards (verification page instead).
- Firebase project / APNs key (needed for push to actually reach phones), Firebase auth.
- Wallet with withdrawals (not built — see open questions).

## 10. Open questions (not blocking)
1. Question content source — in-house team, licensed, or partner institutes? (affects bulk-import format)
2. Final gateway choice after Razorpay and Paytm quote their UPI rates; SMS OTP provider.
3. Logo/brand assets for "Testwise".
4. Firebase project + Google Cloud OAuth client — you'll need to create these (I'll give exact steps at M1).

## Coin duels, coin economy and audience (added)

- **Coin duels** (`DuelOffer` → `DuelRoom`): an admin creates a batch, e.g. 20 rooms, entry 50, prize 75 or 100 (prize ≤ both entries; the DB enforces it). A student joins an offer; the server picks a room, takes the entry into escrow in the same transaction that claims the seat, starts the duel when both players are connected and pays from the server's own score. Draw, no-show, cancelled room, abandoned duel or a lone player who waits too long refund the entry. Bots never play coin duels and there is no free rematch.
- **Ledger**: every coin movement is an append-only `WalletTxn` with an idempotency key (`duel:entry|refund|prize:{room}:{cycle}`) plus balanced double-entry lines in the money ledger (`DUEL_ESCROW` account; the unpaid part of a pool is `PLATFORM_REVENUE`). The app sends only an offer/room id; amounts, eligibility, limits and results are read on the server.
- **Safety defaults**: off by default. Entry can be paid from *earned coins only* (default) so no real money flows into prizes; under-18 accounts are always earned-only and need guardian consent. Per-day entry and stake limits apply. Admin: Settings → Paid coin duels. Legal: see the Online Gaming Act flag above; switching `entrySource` to `ANY` (bought coins can stake) turns this into a money game in substance, so get advice first.
- **Coin gamification** (`gamification.coins`): daily 7-day check-in, streak milestones, level-ups and mission coins, each granted once through the ledger and bounded by a per-day cap. Funded from the promo budget.
- **Audience**: tournaments and coin duels use one explicit "Who can join" control (Everyone / School students + classes / Exam aspirants + chosen exams, plus age limits), enforced on the server from the student's profile.
