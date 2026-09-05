<div align="center">

# dorm.place

**Run your property. Automate your rent.**

ระบบจัดการหอพักและอพาร์ทเมนท์แบบไทย ๆ สำหรับเจ้าของหอ SME

`v1.0.0-beta.1` · Cloudflare Workers · D1 · Hono · TypeScript

</div>

---

> [!WARNING]
> **Beta.** Feature-complete for the owner console and the meter walk, but not
> yet run against a real building with real tenants. Do not put production
> tenant data in it before reading [Known limits](#known-limits).

---

## What it is

A rental-property operating system for Thai small landlords — dorms, apartments,
rental rooms. It covers the month: record who lives where, walk the building
reading meters, generate every invoice in one action, take payment by PromptPay
QR, and see what is still owed.

Built server-rendered and edge-deployed, because the people using it are on
mid-range Android phones over mobile data, and the caretaker entering readings is
standing in a stairwell.

## Features

| Area | What works |
|---|---|
| **อาคาร / ห้องพัก** | Multiple buildings, bulk room creation (`101–110, 201–210 …`), per-floor visual grid with occupancy, rent and outstanding balance per tile |
| **ผู้เช่า** | Contacts, national ID, emergency contact, full contract and invoice history |
| **สัญญาเช่า** | Move-in / move-out, deposit tracking, opening meter readings, printable Thai lease (สัญญาเช่าห้องพัก, 8 clauses) |
| **เดินจดมิเตอร์** | Dedicated mobile field mode — one room per screen, auto-advance, offline-tolerant, skip-with-reason, meter photos |
| **จัดการมิเตอร์** | Desktop grid for review, correction and audit of every reading |
| **ออกบิล** | One action bills a whole building; pro-rata rent for mid-month move-in/out; safe to re-run |
| **ใบแจ้งหนี้** | A4 print, PromptPay QR carrying the exact amount, Thai baht text (บาทถ้วน) |
| **รับชำระ** | Partial and full payment, slip upload to R2, receipt (ใบเสร็จรับเงิน) |
| **แจ้งซ่อม** | Tickets with photo, priority and status |
| **ประกาศ** | Announcements to every tenant of a building — draft, publish, pin, expiry date, opened-by count |
| **รายงาน** | 12-month revenue, collection rate, receivables by age, CSV export (UTF-8 BOM — Thai opens correctly in Excel) |
| **ค้นหา** | One box over rooms, tenants, invoices and tickets |

**Thai-first throughout.** Buddhist Era dates (`1 ก.ย. 2569`), Thai baht text on
receipts, natural Thai terminology (`ครั้งก่อน` / `ครั้งนี้` / `ใช้ไป`).
English available via the topbar toggle.

**Money is integer satang.** Never a float, so billing cannot drift.

## Quick start

```bash
npm install
npm run db:init      # apply migrations to the local D1
npm run db:seed      # optional: 2 buildings, 56 rooms, 40 tenants, contracts
npm run dev          # http://localhost:8787 (reads wrangler.dev.jsonc)
```

First visit lands on `/setup` to create the owner account, then `/buildings/new`.
`npm run db:reset` wipes the local database and re-seeds.

> The seed data is synthetic — invented Thai names and randomly generated ID
> numbers. None of it refers to a real person.

## Deploy

Production is **Cloudflare Pages** — `dormplace.pages.dev`.

R2 must be enabled on the account before the first deploy. Without it the
upload and the Worker compile both succeed and publishing fails on
`R2 bucket 'dorm-files' not found`.

```bash
npx wrangler d1 create dorm-db --location apac   # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create dorm-files
npm run db:init:remote
npm run deploy:pages
```

Always reach the remote database through `migrations apply`, which is what
`db:init:remote` runs. Applying a migration with `d1 execute --file` writes no
row to `d1_migrations`, and the next `migrations apply` then replays from 0001
and fails on `table users already exists`.

`--location apac` matters: D1 has a single primary region, and this app makes
several queries per page. A database in North America adds a Pacific round-trip
to every one of them for Thai users.

### Two Wrangler configs, and why

| File | Used by | Shape |
| --- | --- | --- |
| `wrangler.jsonc` | `wrangler pages deploy`, Pages builds | Pages: `pages_build_output_dir`, bindings |
| `wrangler.dev.jsonc` | `npm run dev`, `wrangler types` | Worker: `main`, static assets, same bindings |

Pages commands reject `-c` — *"Pages does not support custom paths for the
Wrangler configuration file"* — so the Pages configuration has to be the root
file. Local development keeps the Worker shape because it serves `src/`
directly with hot reload, where the Pages build serves a bundle.

**The bindings appear in both files. Change one, change the other.**

`npm run build:pages` bundles `src/index.tsx` into `dist/_worker.js` with
esbuild and copies `public/` beside it — Pages advanced mode: static files win,
everything else reaches the Worker, exactly as the assets binding behaves
locally.

## The two meter modes

Not one responsive page — two different jobs.

| | Route | For |
|---|---|---|
| **เดินจดมิเตอร์** | `/walk` | One phone, one hand, walking the building |
| **จัดการมิเตอร์** | `/meters` | Desk review, correction, audit, bulk edit |

Field mode is its own full-screen shell — no sidebar, no topbar. One room per
screen: tenant strip, two oversized numeric cards, one sticky action in the
thumb zone. Rooms are ordered floor-then-number and saving advances to the next
room still needing a reading, wrapping to catch stragglers, so the walker never
goes back to a list.

```
/walk                              start: building, period, progress
/walk/:building/:period/room/:id   the room screen
/walk/:building/:period/skip/:id   skip, with a required reason
/walk/:building/:period/rooms      jump list (sequential stays the default)
/walk/:building/:period/done       completion + items to review
```

**Usage is computed, never typed.** The previous reading resolves to the last
recorded period, falling back to the contract's opening reading, so a tenant's
first bill charges only what they actually used.

**Validation warns, never blocks.** A reading below the previous one, or usage
above 1.5× that room's historical mean, raises an inline warning the walker can
confirm and move past. The completion screen re-lists everything flagged.

**Losing a reading is the one unacceptable failure**, so there are two layers:
every keystroke drafts to `localStorage` and restores on reload; submits go into
a local queue that replays on reconnect. Saving never waits on the network — the
walker advances immediately while a pill reports
`บันทึกในเครื่องแล้ว` → `ซิงค์แล้ว`.

## Billing rules

- **Rent** is charged whole for a full month. For a mid-month move-in or move-out
  it is `rent × chargedDays / daysInMonth`, and the invoice line shows the range.
- **Water and electricity** are metered (`(current − previous) × rate`) or a flat
  monthly charge, set per building. A room with no reading is billed rent only,
  and the billing preview flags it.
- **Deposit** appears once, on the invoice covering the move-in month, tracked by
  `contracts.deposit_invoiced` so a re-run never bills it twice.
- **A skipped room** stores the previous value as the current one, so usage is
  zero: rent is billed without inventing consumption.
- **Re-running a period is safe.** Invoices are unique per `(contract, period)`
  and already-billed rooms are skipped.

## Design system

Every colour, radius, shadow and duration is a CSS custom property at the top of
`public/app.css`. Nothing below that block hard-codes a colour, so retheming
means editing one block.

- **Honey amber accent** on warm neutrals. Buttons put dark ink on amber, not
  white: white-on-amber measures **2.13:1** and fails WCAG AA; ink-on-amber
  measures **8.44:1**.
- **Light and dark are separate palettes**, not one inverted. Dark brightens the
  accent so it holds on a dark ground.
- **Every text pair is verified** — body, secondary, buttons and all four
  semantic tags clear 4.5:1 in both themes.
- **Status is never colour alone.** Room tiles carry a stripe *and* a text tag;
  the current nav item gets weight, a bar and `aria-current="page"`.
- **Theme** has three states (`system` default, light, dark), persisted, applied
  before first paint so there is no flash. Switching does a circular reveal from
  the toggle via the View Transitions API; browsers without it swap instantly,
  and `prefers-reduced-motion` always swaps instantly.

## Where this sits

This is the backoffice, and it **owns the database schema**. It is one of three
services over a single Cloudflare D1 database, `dorm-db`:

| Repo | Role |
| --- | --- |
| playxdev/dormplace | This app — owners and staff |
| [playxdev/dormapi](https://github.com/playxdev/dormapi) | Tenant API, Go, serving the MINI App |
| [playxdev/dormmini](https://github.com/playxdev/dormmini) | LINE MINI App, the tenant's client |

**Every schema change is a migration in this repository.** The other two
services read the same database and define no tables of their own. A second
database is not possible: a contract activated here has to be visible to the
MINI App immediately, and D1 cannot query across databases.

The tenant-facing design is specified in
[`dormmini/docs/DESIGN-LINE-MINI.md`](https://github.com/playxdev/dormmini/blob/main/docs/DESIGN-LINE-MINI.md).

### Identity and onboarding (migration 0003)

`users` holds one row per person — owners, staff and tenants alike — because
what someone may do is a relationship, not an attribute of them. An owner may
rent a room elsewhere; a tenant may buy a building later.

```
identities     (provider, subject) -> user_id     line | google | facebook | email
memberships    user_id + building_id + role       administers; seat billing counts these
tenants.user_id                                   links the record you type to their account
invites        opaque single-use code per contract
contracts      confirmed_by_user_id, agreed_rent, agreed_deposit, agreed_start_date
```

`users.email` and `users.password_hash` are nullable: a tenant signing in with
LINE has neither.

A tenant record exists **before** that person has an account. You fill in the
contract at signing; the tenant attaches their LINE identity afterwards by
scanning the invite QR, which is why their review screen has real terms on it.

The `agreed_*` columns are a snapshot taken when the tenant confirmed, not a
reference. Amending a contract later must not move the record of what they
agreed to.

### Announcements (migration 0005)

An announcement belongs to a **building**, never to a room or a person: this is
the notice board by the lift, not a letter. Everyone holding an active contract
in that building sees the same text.

```
announcements       building_id, title, body, pinned, published_at, expires_at
announcement_reads  (announcement_id, user_id) — one row when a tenant opens it
```

`published_at NULL` is a draft, and nothing outside this app may read one — the
owner can write across several sittings and publish once, rather than a
half-written notice appearing in every tenant's app. Publishing only ever moves
a draft forward: re-publishing an existing notice would move its date and push
it back to the top of every tenant's list, so `/announcements/:id/publish` is
`WHERE published_at IS NULL`.

`expires_at` retires a notice about last week's water outage without anyone
remembering to delete it. NULL stands until removed.

Read state is the **absence** of a row. Announcing to a building of 100 rooms
costs zero writes; one write lands per tenant who actually opens it. That shape
is what keeps this inside D1's 100 k writes/day. Unpublishing keeps the read
rows — if the notice goes out again, who has already seen it is still true.

## Architecture

```
src/
  index.tsx          Hono app: locale + session middleware, route mounting
  app.ts             request context, flash messages
  types.ts           row types
  lib/
    billing.ts       draft builder: pro-rata rent, meter charges, deposit, due dates
    promptpay.ts     EMVCo / Thai QR payload + CRC-16/CCITT
    qr.ts            payload → inline SVG
    db.ts            typed D1 queries
    auth.ts          PBKDF2-SHA256 passwords, session cookies
    i18n.ts          Thai strings, English fallback
    util.ts          satang money, Thai baht text, BE dates
  routes/            one file per screen group, incl. walk.tsx (field mode)
  ui/
    layout.tsx       desktop shell, nav, KPI/Tag/Empty primitives
    field.tsx        full-screen mobile shell — shares nothing with layout.tsx
    icons.tsx        inline stroke icons (no icon font, no dependency)
    theme.ts         no-FOUC bootstrap + theme/drawer/table runtime
    walk-js.ts       live usage, drafts, offline queue
migrations/          D1 schema (0001 core, 0002 meter walk, 0003 identity + invites,
                     0004 tenant payment notices, 0005 announcements)
seeds/demo.sql       synthetic demo data
public/app.css       the entire design system, including print styles
docs/                product research and UX specs
```

**Four dependencies, two at runtime:** `hono` (routing + server-rendered JSX) and
`@paulmillr/qr` (QR encoding, zero deps); `typescript` and `wrangler` for dev.
No React, no Tailwind, no ORM, no icon font. The browser receives roughly 16
lines of JavaScript on a normal page — everything else is server-rendered HTML.

## Known limits

Honest list of what is **not** built, so nothing looks finished that isn't.

- **Announcements do not reach a tenant yet.** They are written and published
  here and served by `dormapi`, but the MINI App has no screen for them.
- **Not deployed yet.** The Pages project exists and the build pipeline works;
  publishing waits on R2 being enabled for the account.
- **Payment slips are not auto-verified.** The QR is real and scannable; a human
  still confirms the transfer arrived. Bank reconciliation (SCB/KBank) is unbuilt,
  and will likely need a static-IP proxy, since Workers has no fixed egress IP.
- **No VAT, withholding tax or e-Tax invoice.** Invoices are plain
  ใบแจ้งหนี้ / ใบเสร็จรับเงิน — what a non-VAT-registered landlord needs.
- **No ThaID verification, tenant document vault, or account flags.**
- **The meter walk is offline-*tolerant*, not an offline app.** It survives losing
  signal mid-walk, but does not pre-download the room list and has no service
  worker, so a cold start with no connection will not open.
- **A meter photo bypasses the offline queue** — a `File` cannot be queued as form
  text, so a photo save with no signal fails rather than queues.
- **No OCR** on meter photos.
- **The lease template is generic.** Have a lawyer review the wording before
  adopting it as your standard form.
- **PDPA:** personal data is kept only for the tenancy, and the notice appears on
  the tenant form and in clause 8 of the lease. Retention and erasure workflows
  are not automated.
- **Not yet verified in a real browser.** Every page is checked by markup
  assertion, contrast is computed numerically, and client scripts are
  syntax-checked — but the UI has not been visually reviewed on a device.

## Roadmap

1. Announcements in the MINI App
2. Deploy to production (needs R2 enabled on the account)
3. Visual QA pass on real phones
4. LINE OA notifications: invoice issued, payment due, receipt
5. Bank slip auto-verification
6. Meter photo OCR with owner confirmation
7. VAT / e-Tax invoice for registered landlords

## Licence

UNLICENSED — private project. All rights reserved.
