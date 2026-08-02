# Dashboard Feuerwehrhaus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, token-authenticated, kiosk-style TV dashboard (`/dashboard/[token]`) for the
Feuerwehrhaus showing upcoming events, borrowed vehicles, the WASTL fire-status map, a Facebook feed, and
a QR code to the app — plus a Verwaltung section for managing dashboard tokens and Facebook credentials.

**Architecture:** A new public route outside the `(app)` group, gated by a per-organization
`DashboardToken` (not session auth). All data is read-only server fetches, parallelized in the page.
External integrations (WASTL image, Facebook posts/images) are proxied/cached server-side into Postgres
so the kiosk never depends on live third-party availability. The layout is pure fluid CSS (`clamp()` +
CSS grid), no fixed pixel sizing, with a client-side `ResizeObserver` component controlling how many list
items fit at the current viewport size.

**Tech Stack:** Next.js App Router (Server Components + Route Handlers), Prisma/PostgreSQL, Tailwind,
`qrcode` (new dependency), native `fetch` for the Facebook Graph API and the WASTL page (matching this
codebase's existing "no SDK, raw fetch" convention for Mailjet).

## Global Constraints

- No test framework exists in this repo. Every verification step uses `npx tsc --noEmit -p tsconfig.json`,
  `npm run build`, and targeted browser/script checks — the same substitute used throughout this project.
- No hover/focus/click states anywhere on `/dashboard/[token]` — nothing on the page is interactive
  (spec §4, "Nichtverhandelbar für die Wandtafel").
- No text below 14px anywhere on the dashboard page, at any viewport size (spec §4, binding lower clamp
  bounds).
- No `transform: scale()` on the page's root container, and no fixed pixel width/height on the root — the
  layout must genuinely reflow via `clamp()`/grid at every tested resolution: 1366×768, 1920×1080,
  2560×1440, 3840×2160, and portrait.
- Invalid/expired/revoked token → `notFound()` (real 404, no hint the route exists) — this is a
  deliberate deviation from `drohnen-schnell`'s "always 200" pattern; the design spec calls this out
  explicitly.
- `export const dynamic = 'force-dynamic'` and `export const revalidate = 0` on the dashboard page —
  nothing may be cached at the page level.
- Prisma migration timestamps in this repo use a hand-incremented fake-date scheme, currently ending at
  `20260813090000`. A freshly-generated migration must be renamed to sort after that (next slot:
  `20260814090000`), with matching `_prisma_migrations` bookkeeping corrected — see Task 1, Step 5 for the
  exact procedure (this has bitten this exact project many times already).
- `qrcode` and any other new runtime dependency go into `dependencies` in `package.json`, never
  `devDependencies` — this project's established convention (see `prisma`/`tsx`, both runtime deps despite
  looking like dev tooling).

---

### Task 1: Schema — `DashboardToken`, Facebook fields, image caches

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration folder under `prisma/migrations/`

**Interfaces:**
- Produces: `DashboardToken` model (`id, token, organizationId, createdById, createdAt, expiresAt,
  lastUsedAt, revokedAt`), `Organization.facebookPageId: string | null`,
  `Organization.facebookPageAccessToken: string | null`, `FacebookPostCache` model
  (`id, organizationId, posts: Json, fetchedAt`), `FacebookPostImage` model
  (`id, postId, data: Bytes, mimeType, createdAt`), `WastlImageCache` model
  (`id, data: Bytes, mimeType, fetchedAt`) — all consumed directly via Prisma Client by every later task.

- [ ] **Step 1: Add the new fields and models**

In `prisma/schema.prisma`, find the `model Organization {` block and add two new fields right after the
existing `atemschutzSachbearbeiterEmail` field, plus two new relation fields in its relation list:

```prisma
model Organization {
  id        String           @id @default(cuid())
  name      String           @unique
  shortName String?
  nummer    String           @unique
  type      OrganizationType
  icsToken  String           @unique @default(cuid())
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  // Kontaktadresse für die tägliche Atemschutz-Fristen-Warnung (nur FEUERWEHR-Orgs relevant) -
  // bewusst ein eigenes Feld hier statt eines globalen AppSettings-Eintrags, da jede Heimatfeuerwehr
  // ihre eigene Kontaktperson hinterlegen können soll (siehe lib/heimatfeuerwehr/notify-atemschutz-warnung.ts).
  atemschutzSachbearbeiterEmail String?

  // Facebook-Seite für den Feed-Block auf dem Dashboard Feuerwehrhaus (Issue #8) - pro Feuerwehr statt
  // global, aus demselben Grund wie atemschutzSachbearbeiterEmail: jede Heimatfeuerwehr kann ihre eigene
  // Seite hinterlegen. Leer = "Facebook nicht verbunden" auf dem Dashboard.
  facebookPageId          String?
  facebookPageAccessToken String?

  members      User[]        @relation("HomeOrganization")
  memberships  Membership[]
  events       Event[]
  newsMessages NewsMessage[]
  vehicles     Vehicle[]

  dashboardTokens   DashboardToken[]
  facebookPostCache FacebookPostCache?

  @@index([type])
}
```

Find the `model User {` block and add one new relation field right after the existing
`vehicleBookings VehicleBooking[]` line (before the closing `@@index`):

```prisma
  homeOrganization       Organization             @relation("HomeOrganization", fields: [homeOrganizationId], references: [id])
  memberships            Membership[]
  droneMembership        DrohnengruppeMembership?
  createdEvents          Event[]                  @relation("EventCreatedBy")
  registeredFlights      DroneFlight[]            @relation("FlightRegisteredBy")
  pilotedFlights         DroneFlight[]            @relation("FlightPilot")
  passwordTokens         PasswordToken[]
  pushSubscriptions      PushSubscription[]
  newsMessagesCreated    NewsMessage[]            @relation("NewsCreatedBy")
  terminZusagen          TerminZusage[]
  droneDocumentsUploaded DroneDocument[]          @relation("DroneDocumentUploadedBy")
  vehicleBookings        VehicleBooking[]
  dashboardTokensCreated DashboardToken[]

  @@index([homeOrganizationId])
```

Add four new models anywhere in the file (convention in this schema is to group new models near related
ones — add these right after the `VehicleBooking` model):

```prisma
// Token für den öffentlichen, session-losen Kiosk-Dashboard-Screen im Feuerwehrhaus (Issue #8) - analog
// zum QR-Code-Schnellerfassungs-Token der Drohnengruppe (AppSettings.droneQuickRegisterToken), aber als
// eigene Tabelle statt eines Singleton-Felds, da mehrere Tokens pro Feuerwehr mit individuellem
// Ablauf/Widerruf möglich sein müssen.
model DashboardToken {
  id             String    @id @default(cuid())
  token          String    @unique
  organizationId String
  createdById    String
  createdAt      DateTime  @default(now())
  expiresAt      DateTime?
  lastUsedAt     DateTime?
  revokedAt      DateTime?

  organization Organization @relation(fields: [organizationId], references: [id])
  createdBy    User         @relation(fields: [createdById], references: [id])

  @@index([organizationId])
}

// Stündlich vom Cron-Job (api/cron/facebook-fetch) befüllter Cache der letzten Facebook-Beiträge einer
// Feuerwehr-Seite - ein Eintrag pro Organisation, damit ein Neustart oder ein Graph-API-Ausfall den
// Dashboard-Feed nicht leert (siehe Design-Spec §6).
model FacebookPostCache {
  id             String   @id @default(cuid())
  organizationId String   @unique
  posts          Json
  fetchedAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
}

// Heruntergeladene Beitragsbilder, Bytes in Postgres statt Dateisystem - analog zu DroneDocument (PDFs):
// kein zusätzliches Docker-Volume, läuft automatisch im bestehenden pg_dump-Backup mit. Eigene Tabelle
// statt eines Felds auf FacebookPostCache, damit beim stündlichen Refresh nur tatsächlich neue Bilder
// geschrieben werden (Abgleich über postId), nicht das gesamte Cache-JSON samt alter Bilder neu.
model FacebookPostImage {
  id        String   @id @default(cuid())
  postId    String   @unique
  data      Bytes
  mimeType  String
  createdAt DateTime @default(now())
}

// Letztes erfolgreich abgerufenes WASTL-Übersichtsbild, gleiches Bytes-in-Postgres-Muster wie
// FacebookPostImage - ein einzelner Datensatz reicht, da die Karte nicht org-spezifisch ist (ganz NÖ).
model WastlImageCache {
  id        String   @id @default("singleton")
  data      Bytes
  mimeType  String
  fetchedAt DateTime @default(now())
}
```

- [ ] **Step 2: Generate the migration**

This environment cannot run `prisma migrate dev` interactively (confirmed in an earlier round of this
project) — generate the SQL via a shadow-DB diff instead:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/dashboard-migration.sql
```

If that produces an empty diff (because the datasource already matches — it won't, since you haven't
applied anything yet), instead diff against the currently-deployed migrations directory:

```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/dashboard-migration.sql
cat /tmp/dashboard-migration.sql
```

Confirm the generated SQL only contains: `ALTER TABLE "Organization" ADD COLUMN "facebookPageId" ...`,
`ALTER TABLE "Organization" ADD COLUMN "facebookPageAccessToken" ...`, `CREATE TABLE "DashboardToken"
(...)`, `CREATE TABLE "FacebookPostCache" (...)`, `CREATE TABLE "FacebookPostImage" (...)`, `CREATE TABLE
"WastlImageCache" (...)`, plus their unique indexes/foreign keys — no `DROP` statements, purely additive.

- [ ] **Step 3: Create the migration folder at the correct sequence position**

```bash
mkdir -p prisma/migrations/20260814090000_dashboard_feuerwehrhaus
cp /tmp/dashboard-migration.sql prisma/migrations/20260814090000_dashboard_feuerwehrhaus/migration.sql
```

- [ ] **Step 4: Apply it and baseline if needed**

```bash
npx prisma migrate deploy
```

If this fails because `_prisma_migrations` doesn't recognize earlier migrations as applied (a known
pre-existing condition of the shared dev Postgres container in this project — check with
`docker exec app-177-postgres-1 psql -U ffapp -d ffapp -c "SELECT migration_name FROM \"_prisma_migrations\" ORDER BY migration_name;"`
first), baseline every migration folder that sorts before this new one via
`npx prisma migrate resolve --applied <migration_name>` for each, then re-run `migrate deploy`.

- [ ] **Step 5: Verify**

```bash
docker exec app-177-postgres-1 psql -U ffapp -d ffapp -c "SELECT migration_name FROM \"_prisma_migrations\" ORDER BY migration_name;" -c "\d \"DashboardToken\"" -c "\d \"FacebookPostCache\"" -c "\d \"FacebookPostImage\"" -c "\d \"WastlImageCache\"" -c "\d \"Organization\""
```

Expected: `20260814090000_dashboard_feuerwehrhaus` is the last row; the four new tables exist with the
exact columns above; `Organization` has the two new nullable text columns.

- [ ] **Step 6: Regenerate Prisma Client and type-check**

```bash
npx prisma generate
npx tsc --noEmit -p tsconfig.json
```

Expected: clean (no output). Regenerating the client is required — the rest of this plan's tasks import
`prisma.dashboardToken`, `prisma.facebookPostCache`, etc., which don't exist in the client until this runs.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260814090000_dashboard_feuerwehrhaus/
git commit -m "Add DashboardToken, Facebook fields, WASTL/Facebook image caches"
```

---

### Task 2: `src/lib/dashboard/token.ts` — token CRUD helpers

**Files:**
- Create: `src/lib/dashboard/token.ts`

**Interfaces:**
- Consumes: `prisma.dashboardToken` (Prisma Client, Task 1).
- Produces: `generateDashboardToken(organizationId: string, createdById: string): Promise<{ id: string; token: string }>`,
  `getValidDashboardToken(token: string): Promise<{ id: string; organizationId: string } | null>`,
  `touchDashboardTokenUsage(tokenId: string): Promise<void>`,
  `setDashboardTokenExpiry(tokenId: string, expiresAt: Date | null): Promise<void>`,
  `revokeDashboardToken(tokenId: string): Promise<void>`,
  `listDashboardTokens(organizationId: string): Promise<DashboardTokenRow[]>` (with exported
  `DashboardTokenRow` type) — all consumed by Task 4 (public page) and Task 12/13 (admin actions/UI).

- [ ] **Step 1: Write the file**

```ts
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

export interface DashboardTokenRow {
  id: string;
  token: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Erzeugt einen neuen Kiosk-Dashboard-Token für eine Feuerwehr - randomBytes(24).toString('hex'),
 * exakt wie generateDroneQuickRegisterToken() in lib/settings.ts. Anders als dort gibt es hier
 * mehrere Tokens pro Organisation (jeder mit eigenem Ablauf/Widerruf), daher eine eigene Zeile statt
 * eines Singleton-Felds. */
export async function generateDashboardToken(
  organizationId: string,
  createdById: string,
): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString('hex');
  const created = await prisma.dashboardToken.create({
    data: { token, organizationId, createdById },
    select: { id: true, token: true },
  });
  return created;
}

/** Prüft einen Token gegen die Datenbank - ungültig, widerrufen oder abgelaufen liefern alle null
 * zurück (die aufrufende Seite unterscheidet nicht zwischen den drei Fällen, siehe Design-Spec §1:
 * "kein Hinweis auf die Existenz der Seite"). Aktualisiert lastUsedAt NICHT selbst - siehe
 * touchDashboardTokenUsage, getrennt, damit ein reiner Lesevorgang (z. B. aus der Verwaltung) den
 * "zuletzt verwendet"-Zeitstempel nicht verfälscht. */
export async function getValidDashboardToken(
  token: string,
): Promise<{ id: string; organizationId: string } | null> {
  const row = await prisma.dashboardToken.findUnique({
    where: { token },
    select: { id: true, organizationId: true, expiresAt: true, revokedAt: true },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.id, organizationId: row.organizationId };
}

export async function touchDashboardTokenUsage(tokenId: string): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } });
}

export async function setDashboardTokenExpiry(tokenId: string, expiresAt: Date | null): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { expiresAt } });
}

export async function revokeDashboardToken(tokenId: string): Promise<void> {
  await prisma.dashboardToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
}

/** Alle Tokens einer Organisation, neueste zuerst - inklusive bereits widerrufener (die Verwaltungsseite
 * zeigt den Status als Badge, analog zum Kommend/Vergangen-Muster der Fahrzeug-Buchungen-Tabelle auf
 * derselben Seite), damit ein Admin nachvollziehen kann, was schon einmal ausgegeben wurde. */
export async function listDashboardTokens(organizationId: string): Promise<DashboardTokenRow[]> {
  return prisma.dashboardToken.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, token: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/token.ts
git commit -m "Add DashboardToken CRUD helpers"
```

---

### Task 3: `src/lib/dashboard/data.ts` — events and vehicle-booking queries

**Files:**
- Create: `src/lib/dashboard/data.ts`

**Interfaces:**
- Consumes: `prisma.event`, `prisma.vehicleBooking` (Prisma Client).
- Produces: `DashboardEvent` type, `getDashboardEvents(organizationId: string): Promise<DashboardEvent[]>`;
  `DashboardVehicleBooking` type, `getDashboardVehicleBookings(organizationId: string): Promise<DashboardVehicleBooking[]>`,
  `getUpcomingVehicleBookingsCount(organizationId: string): Promise<number>` — all consumed by Task 4
  (public page).

- [ ] **Step 1: Write the file**

```ts
import { prisma } from '@/lib/db/prisma';

// Obere clamp-Grenze aus Design-Spec §4 ("Termine 4-10") - der Server liefert das Maximum, die
// HeightFittedList-Komponente (Task 5) blendet je nach gemessener Höhe den Überhang clientseitig aus.
const MAX_EVENTS = 10;
const MAX_VEHICLE_BOOKINGS = 8;
const VEHICLE_BOOKING_WINDOW_DAYS = 30;

export interface DashboardEvent {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  category: 'ALLGEMEIN' | 'DROHNENGRUPPE';
  isSectionWide: boolean;
}

/** Kommende Termine der eigenen Heimatfeuerwehr + Abschnitt-weite + Drohnengruppe, OHNE RSVP-Felder
 * (Design-Spec §3: "Ohne RSVP-Felder"). Anders als die normale Kalenderansicht wird die
 * Drohnengruppe-Kategorie hier NICHT nach canViewDroneModule gefiltert - der Dashboard-Screen hat
 * keinen Viewer mit eigenen Rechten, er zeigt alle Kategorien der eigenen Org/des Abschnitts. */
export async function getDashboardEvents(organizationId: string): Promise<DashboardEvent[]> {
  const now = new Date();
  return prisma.event.findMany({
    where: {
      startsAt: { gte: now },
      OR: [{ organizationId }, { isSectionWide: true }],
    },
    orderBy: { startsAt: 'asc' },
    take: MAX_EVENTS,
    select: {
      id: true,
      title: true,
      location: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      category: true,
      isSectionWide: true,
    },
  });
}

export interface DashboardVehicleBooking {
  id: string;
  startsAt: Date;
  endsAt: Date;
  vehicleTaktischeBezeichnung: string;
  borrowerName: string;
}

/** Ausgeborgte Fahrzeuge der nächsten 30 Tage (Design-Spec §3), Limit 8 für die Tabelle - die
 * Gesamtzahl (ohne Limit) liefert getUpcomingVehicleBookingsCount() separat für die Fußzeile. */
export async function getDashboardVehicleBookings(organizationId: string): Promise<DashboardVehicleBooking[]> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + VEHICLE_BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const bookings = await prisma.vehicleBooking.findMany({
    where: {
      vehicle: { organizationId },
      startsAt: { gte: now, lte: windowEnd },
    },
    orderBy: { startsAt: 'asc' },
    take: MAX_VEHICLE_BOOKINGS,
    include: {
      vehicle: { select: { taktischeBezeichnung: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  return bookings.map((booking) => ({
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    vehicleTaktischeBezeichnung: booking.vehicle.taktischeBezeichnung,
    borrowerName: `${booking.user.firstName} ${booking.user.lastName}`,
  }));
}

export async function getUpcomingVehicleBookingsCount(organizationId: string): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + VEHICLE_BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return prisma.vehicleBooking.count({
    where: {
      vehicle: { organizationId },
      startsAt: { gte: now, lte: windowEnd },
    },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/data.ts
git commit -m "Add dashboard events and vehicle-booking queries"
```

---

### Task 4: Public dashboard page — token auth, fluid layout, real data (Termine/Fahrzeuge), placeholders for WASTL/Facebook/QR

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/app/globals.css`
- Modify: `tailwind.config.ts`
- Create: `src/app/dashboard/[token]/page.tsx`
- Create: `src/app/dashboard/[token]/clock-display.tsx`

**Interfaces:**
- Consumes: `getValidDashboardToken`, `touchDashboardTokenUsage` (Task 2); `getDashboardEvents`,
  `getDashboardVehicleBookings`, `getUpcomingVehicleBookingsCount` (Task 3).
- Produces: the page shell and grid structure that Task 5 (HeightFittedList), Task 6 (QR), Task 8 (WASTL),
  and Task 11 (Facebook) each replace one placeholder card in — every later task's "Files: Modify" for
  this page assumes this exact structure exists.

- [ ] **Step 1: Add `/dashboard` to the public path prefixes**

In `src/middleware.ts`, add one line to the `PUBLIC_PATH_PREFIXES` array:

```ts
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/kalender/ics',
  '/aktivieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
  '/drohnen-schnell',
  '/api/cron',
  '/dashboard',
];
```

(Only the new `'/dashboard',` line is added — everything else in the file is unchanged. This also
implicitly covers `/api/wastl` and `/api/facebook/image/[postId]` — no, those need their own entries,
added in Tasks 7 and 10 respectively, since `/api/...` routes aren't under `/dashboard`.)

- [ ] **Step 2: Add custom breakpoints and clamp-based typography utility classes**

In `tailwind.config.ts`, find `theme: { extend: { ...` and add a `screens` key inside `extend` (do not
replace the default screens, `extend` merges with Tailwind's defaults):

```ts
    extend: {
      screens: {
        'dash-sm': '1200px',
        'dash-md': '1600px',
        'dash-lg': '2400px',
      },
      // ... rest of existing extend content (colors, fontFamily, etc.) stays exactly as-is
    },
```

In `src/app/globals.css`, add these new utility classes at the end of the file (after all existing
content) — one class per typography role from Design-Spec §4's table, so the six clamp() values are
defined once instead of repeated inline at every call site:

```css
/* Dashboard Feuerwehrhaus (Issue #8) - Typografie-Rollen aus dem Design-Brief §4, gegen 1920px
   berechnet. Untergrenzen sind bindend (kein Fließtext unter 14px auf keiner Auflösung). */
.dash-clock {
  font-size: clamp(38px, 2.9vw, 76px);
}
.dash-weekday {
  font-size: clamp(20px, 1.4vw, 34px);
}
.dash-event-title {
  font-size: clamp(20px, 1.35vw, 34px);
}
.dash-table-cell {
  font-size: clamp(16px, 1.05vw, 26px);
}
.dash-secondary {
  font-size: clamp(14px, 0.95vw, 23px);
}
.dash-section-label {
  font-size: clamp(12px, 0.8vw, 19px);
}
```

- [ ] **Step 3: Create the clock/date client island**

```tsx
'use client';

import { useEffect, useState } from 'react';

const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
  'November', 'Dezember',
];

/** Client-Insel (nicht die ganze Seite), aktualisiert sich alle 15s selbst - Design-Spec §4/§8. Der
 * Server rendert beim initialen Laden bereits einen Zeitstempel (siehe page.tsx), diese Komponente
 * übernimmt danach die Aktualisierung ohne dass ein Reload der ganzen Seite nötig wäre. */
export function ClockDisplay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    <div className="flex items-center gap-6">
      <div className="text-right">
        <div className="dash-weekday font-bold leading-none text-[#1c1c1e]">{DAYS[now.getDay()]}</div>
        <div className="dash-secondary mt-2 leading-none text-[#6c6c70]">
          {now.getDate()}. {MONTHS[now.getMonth()]} {now.getFullYear()}
        </div>
      </div>
      <div className="h-[52px] w-px bg-[#e0e0e4]" />
      <div className="dash-clock font-semibold leading-none tracking-[0.01em] text-[#1c1c1e]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
        {pad(now.getHours())}:{pad(now.getMinutes())}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the page**

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { getValidDashboardToken, touchDashboardTokenUsage } from '@/lib/dashboard/token';
import { getDashboardEvents, getDashboardVehicleBookings, getUpcomingVehicleBookingsCount } from '@/lib/dashboard/data';
import { ClockDisplay } from './clock-display';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const CATEGORY_COLOR: Record<string, string> = {
  ALLGEMEIN: '#e4322b',
  DROHNENGRUPPE: '#22a06b',
};
const SECTION_WIDE_COLOR = '#f0a92c';

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatEventTime(startsAt: Date, endsAt: Date, allDay: boolean): { top: string; bottom: string } {
  if (allDay) {
    return { top: startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }), bottom: 'ganztags' };
  }
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return { top: start, bottom: `bis ${end}` };
}

function formatBookingDate(startsAt: Date): string {
  const now = new Date();
  const isToday = startsAt.toDateString() === now.toDateString();
  return isToday ? 'Heute' : startsAt.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
}

function formatBookingTimeRange(startsAt: Date, endsAt: Date): string {
  const start = startsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  const end = endsAt.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end}`;
}

export default async function DashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await getValidDashboardToken(token);
  if (!valid) {
    notFound();
  }

  await touchDashboardTokenUsage(valid.id);

  const organization = await prisma.organization.findUnique({
    where: { id: valid.organizationId },
    select: { name: true, shortName: true },
  });
  if (!organization) {
    notFound();
  }

  const [events, vehicleBookings, totalBookingsCount] = await Promise.all([
    getDashboardEvents(valid.organizationId),
    getDashboardVehicleBookings(valid.organizationId),
    getUpcomingVehicleBookingsCount(valid.organizationId),
  ]);

  const now = new Date();
  const monthLabel = now.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f4f4f6] text-[#1c1c1e]" style={{ fontFamily: "'Barlow', system-ui, sans-serif" }}>
      <meta httpEquiv="refresh" content="300" />

      {/* ================= Kopf ================= */}
      <div
        className="flex flex-none items-center justify-between bg-white px-[clamp(20px,2.1vw,44px)]"
        style={{ height: 'clamp(84px, 9vh, 132px)', borderBottom: '4px solid #e4322b' }}
      >
        <div className="flex items-center gap-[22px]">
          <img src="/wappen-afkdo.png" alt={`Wappen ${organization.name}`} className="h-[62px] w-[62px] object-contain" />
          <div className="flex flex-col gap-[5px]">
            <span className="text-[30px] font-bold leading-none tracking-[-0.01em]">{organization.name}</span>
            <span className="dash-section-label font-semibold uppercase leading-none tracking-[0.06em] text-[#6c6c70]">
              Abschnittsfeuerwehrkommando Purkersdorf
            </span>
          </div>
        </div>
        <ClockDisplay />
      </div>

      {/* ================= Inhalt ================= */}
      <div
        className="grid min-h-0 flex-1 gap-[clamp(16px,1.5vw,32px)] overflow-hidden px-[clamp(20px,2.1vw,44px)] pt-[clamp(20px,2.1vw,44px)] grid-cols-1 [@media(max-aspect-ratio:1/1)]:grid-cols-1 dash-sm:grid-cols-[minmax(0,1fr)_minmax(340px,26vw)] dash-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(380px,27vw,560px)]"
      >
        {/* ---------- Spalte 1: Termine ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Kommende Termine</span>
            <span className="dash-secondary text-[#6c6c70]">{monthLabel}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-hidden">
            {events.length === 0 && (
              <div className="rounded-xl bg-white p-5 text-[#6c6c70] shadow-sm">Keine kommenden Termine.</div>
            )}
            {events.map((event) => {
              const color = event.isSectionWide && event.category === 'ALLGEMEIN' ? SECTION_WIDE_COLOR : CATEGORY_COLOR[event.category];
              const time = formatEventTime(event.startsAt, event.endsAt, event.allDay);
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-[22px] rounded-xl bg-white p-[19px_22px] shadow-sm"
                  style={{ borderLeft: `5px solid ${color}` }}
                >
                  <div className="w-[74px] flex-none text-center">
                    <div className="text-[40px] font-bold leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                      {String(event.startsAt.getDate()).padStart(2, '0')}
                    </div>
                    <div className="dash-section-label mt-1 font-semibold uppercase tracking-[0.09em] text-[#6c6c70]">
                      {WEEKDAY_SHORT[event.startsAt.getDay()]}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="dash-event-title mb-1.5 font-semibold">{event.title}</div>
                    {event.location && <div className="dash-secondary text-[#6c6c70]">{event.location}</div>}
                  </div>
                  <div className="flex-none text-right">
                    <div className="dash-table-cell font-semibold leading-none">{time.top}</div>
                    <div className="dash-secondary mt-2 leading-none text-[#6c6c70]">{time.bottom}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- Spalte 2: Fahrzeuge + WASTL ---------- */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Ausgeborgte Fahrzeuge</span>
            <span className="dash-secondary text-[#6c6c70]">Nächste 30 Tage</span>
          </div>
          <div className="flex flex-none flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] gap-x-[18px] border-b-2 border-[#1c1c1e] px-6 py-3">
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Datum</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Fahrzeug</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Zeit</span>
              <span className="dash-section-label font-semibold uppercase tracking-[0.1em]">Ausgeborgt von</span>
            </div>
            {vehicleBookings.map((booking) => (
              <div
                key={booking.id}
                className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] items-center gap-x-[18px] border-b border-[#f0f0f2] px-6 py-3"
              >
                <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                  {booking.vehicleTaktischeBezeichnung}
                </span>
                <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                </span>
                <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                  {booking.borrowerName}
                </span>
              </div>
            ))}
            {vehicleBookings.length === 0 && (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Buchungen in den nächsten 30 Tagen.</div>
            )}
            <div className="dash-secondary flex-none px-6 py-3 text-[#6c6c70]">
              Buchung über die App unter „Meine Feuerwehr" · {totalBookingsCount}{' '}
              {totalBookingsCount === 1 ? 'Buchung' : 'Buchungen'} in den nächsten 30 Tagen
            </div>
          </div>

          {/* WASTL-Platzhalter - wird in Task 8 durch die echte Karte ersetzt */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
              <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
            </div>
            <div className="dash-secondary flex min-h-0 flex-1 items-center justify-center text-[#6c6c70]">
              Wird geladen …
            </div>
          </div>
        </div>

        {/* ---------- Spalte 3: Facebook + QR ---------- */}
        <div className="flex min-h-0 flex-col gap-5 overflow-hidden">
          {/* Facebook-Platzhalter - wird in Task 11 durch den echten Feed ersetzt */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white p-[22px] shadow-sm">
              <span className="dash-secondary text-[#6c6c70]">Wird geladen …</span>
            </div>
          </div>

          {/* QR-Platzhalter - wird in Task 6 durch den echten QR-Code ersetzt */}
          <div className="flex flex-none items-center gap-5 rounded-xl bg-[#1c1c1e] p-[20px_22px]">
            <div className="flex h-[118px] w-[118px] flex-none items-center justify-center rounded-lg bg-white">
              <span className="dash-secondary text-center text-[#6c6c70]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                QR-Code
                <br />
                wird generiert
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 text-[22px] font-semibold leading-tight text-white">App installieren</div>
              <div className="dash-secondary mb-3 leading-snug text-[#c9c9ce]">Termine, Fahrzeuge und Atemschutz am Handy.</div>
              <div className="dash-secondary break-all font-semibold text-white" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                app-177.ff-wolfsgraben.at
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= Fuß ================= */}
      <div
        className="flex flex-none items-center justify-between border-t border-[#e0e0e4] px-[clamp(20px,2.1vw,44px)]"
        style={{ height: 'clamp(40px, 5vh, 62px)' }}
      >
        <span className="dash-secondary text-[#6c6c70]">Dashboard Feuerwehrhaus · Anzeige aktualisiert sich automatisch</span>
        <span className="dash-secondary text-[#6c6c70]">
          Zuletzt aktualisiert {now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} · Quellen: App-177, WASTL
          Niederösterreich, Facebook
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 6: Create a test token and verify in the browser**

```bash
docker exec app-177-postgres-1 psql -U ffapp -d ffapp -c "
INSERT INTO \"DashboardToken\" (id, token, \"organizationId\", \"createdById\", \"createdAt\")
SELECT 'test-dash-token', 'test-dash-token-value', o.id, u.id, now()
FROM \"Organization\" o, \"User\" u
WHERE o.name = 'FF Gablitz' AND u.email = 'admin@abschnitt-purkersdorf.at';
"
```

Start the dev server (`npx next dev -p 3005` or similar free port) and navigate to
`/dashboard/test-dash-token-value`. Confirm: page renders with the real org name, no console errors, the
three-column grid at desktop width, events (if any exist for FF Gablitz/section-wide) listed, vehicle
bookings listed or the empty-state text, WASTL/Facebook placeholders visible, QR placeholder visible.
Navigate to `/dashboard/wrong-token` and confirm a real 404 page (not the app shell). Resize the browser
window narrow (portrait-ish) and confirm the grid collapses toward one column without a horizontal
scrollbar. Clean up the test token afterward:

```bash
docker exec app-177-postgres-1 psql -U ffapp -d ffapp -c "DELETE FROM \"DashboardToken\" WHERE id = 'test-dash-token';"
```

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/app/globals.css tailwind.config.ts "src/app/dashboard/[token]/page.tsx" "src/app/dashboard/[token]/clock-display.tsx"
git commit -m "Add public dashboard page with fluid layout, token auth, Termine/Fahrzeuge"
```

---

### Task 5: `HeightFittedList` — ResizeObserver-based dynamic list length

**Files:**
- Create: `src/components/dashboard/height-fitted-list.tsx`
- Modify: `src/app/dashboard/[token]/page.tsx`

**Interfaces:**
- Produces: `HeightFittedList({ minVisible, maxVisible, children }: { minVisible: number; maxVisible:
  number; children: React.ReactNode[] })` — a client component wrapping a list of already-rendered item
  elements, consumed by this task's edit to `page.tsx` (Termine and Fahrzeugbuchungen lists) and later by
  Task 11 (Facebook older-posts list).

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useLayoutEffect, useRef, useState } from 'react';

interface HeightFittedListProps {
  /** Design-Spec §3: untere Grenze, unter die trotz Platzmangel nie gekürzt wird. */
  minVisible: number;
  /** Design-Spec §3: obere Grenze - entspricht der Anzahl, die der Server bereits geliefert hat. */
  maxVisible: number;
  /** Ein bereits fertig gerendertes Element pro Eintrag, in Anzeige-Reihenfolge. */
  children: React.ReactNode[];
}

/**
 * "Menge anpassen, nicht Größe" (Design-Spec §3): zeigt beim ersten Rendern ALLE übergebenen Kinder
 * (bis maxVisible), damit ihre echte Höhe gemessen werden kann, und blendet danach - noch bevor der
 * Browser malt (useLayoutEffect läuft synchron vor dem Paint) - den Überhang aus, der nicht in den
 * verfügbaren Platz passt. Ein ResizeObserver hält das bei Größenänderungen des Containers nach.
 *
 * Bewusste Einschränkung: nach dem ersten Messen werden nur noch die sichtbaren Kinder tatsächlich
 * gerendert (nicht bloß versteckt), damit inaktive Einträge nicht unnötig im DOM bleiben. Das bedeutet,
 * ein SPÄTERES Vergrößern des Containers kann nicht mehr Einträge aufdecken, als beim letzten Messen
 * sichtbar waren, ohne die zuvor ausgeblendeten neu zu messen. Für einen Kiosk-Screen, der nicht live in
 * der Fenstergröße verändert wird (Auflösung ändert sich nur zwischen den harten 5-Minuten-Reloads, siehe
 * Design-Spec §8), ist das kein praktisches Problem - ein Reload rendert wieder alle Kinder neu.
 */
export function HeightFittedList({ minVisible, maxVisible, children }: HeightFittedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const total = Math.min(children.length, maxVisible);
  const [visibleCount, setVisibleCount] = useState(total);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      if (!container) return;
      const available = container.clientHeight;
      const items = Array.from(container.children) as HTMLElement[];
      let cumulative = 0;
      let fitCount = 0;
      for (const item of items) {
        cumulative += item.offsetHeight;
        if (cumulative > available) break;
        fitCount++;
      }
      setVisibleCount((prev) => {
        const clamped = Math.max(Math.min(minVisible, total), Math.min(fitCount, total));
        return prev === clamped ? prev : clamped;
      });
    }

    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [minVisible, total]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-hidden">
      {children.slice(0, visibleCount)}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Termine list in `page.tsx`**

Replace the Termine block's inner list container (the `<div className="flex min-h-0 flex-1 flex-col
gap-[11px] overflow-hidden">` wrapping `events.map(...)`) with a call to `HeightFittedList`. Add the
import at the top of the file:

```ts
import { HeightFittedList } from '@/components/dashboard/height-fitted-list';
```

Replace:

```tsx
          <div className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-hidden">
            {events.length === 0 && (
              <div className="rounded-xl bg-white p-5 text-[#6c6c70] shadow-sm">Keine kommenden Termine.</div>
            )}
            {events.map((event) => {
```

with:

```tsx
          {events.length === 0 ? (
            <div className="rounded-xl bg-white p-5 text-[#6c6c70] shadow-sm">Keine kommenden Termine.</div>
          ) : (
            <HeightFittedList minVisible={4} maxVisible={10}>
              {events.map((event) => {
```

and the matching closing tags — after the `.map()` callback's closing `})}` (previously followed
immediately by `</div>` closing the manual list wrapper), close with:

```tsx
              })}
            </HeightFittedList>
          )}
```

The full replaced block reads:

```tsx
          {events.length === 0 ? (
            <div className="rounded-xl bg-white p-5 text-[#6c6c70] shadow-sm">Keine kommenden Termine.</div>
          ) : (
            <HeightFittedList minVisible={4} maxVisible={10}>
              {events.map((event) => {
                const color = event.isSectionWide && event.category === 'ALLGEMEIN' ? SECTION_WIDE_COLOR : CATEGORY_COLOR[event.category];
                const time = formatEventTime(event.startsAt, event.endsAt, event.allDay);
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-[22px] rounded-xl bg-white p-[19px_22px] shadow-sm"
                    style={{ borderLeft: `5px solid ${color}` }}
                  >
                    <div className="w-[74px] flex-none text-center">
                      <div className="text-[40px] font-bold leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                        {String(event.startsAt.getDate()).padStart(2, '0')}
                      </div>
                      <div className="dash-section-label mt-1 font-semibold uppercase tracking-[0.09em] text-[#6c6c70]">
                        {WEEKDAY_SHORT[event.startsAt.getDay()]}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="dash-event-title mb-1.5 font-semibold">{event.title}</div>
                      {event.location && <div className="dash-secondary text-[#6c6c70]">{event.location}</div>}
                    </div>
                    <div className="flex-none text-right">
                      <div className="dash-table-cell font-semibold leading-none">{time.top}</div>
                      <div className="dash-secondary mt-2 leading-none text-[#6c6c70]">{time.bottom}</div>
                    </div>
                  </div>
                );
              })}
            </HeightFittedList>
          )}
```

- [ ] **Step 3: Wire it into the Fahrzeugbuchungen rows (below the fixed header row)**

Within the Fahrzeuge table's wrapper `<div className="flex flex-none flex-col overflow-hidden rounded-xl bg-white shadow-sm">`,
the header row (`Datum/Fahrzeug/Zeit/Ausgeborgt von`) and the footer text stay outside — only the
`vehicleBookings.map(...)` rows go inside a `HeightFittedList`. Change:

```tsx
            {vehicleBookings.map((booking) => (
              <div
                key={booking.id}
                className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] items-center gap-x-[18px] border-b border-[#f0f0f2] px-6 py-3"
              >
                <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                  {booking.vehicleTaktischeBezeichnung}
                </span>
                <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                </span>
                <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                  {booking.borrowerName}
                </span>
              </div>
            ))}
            {vehicleBookings.length === 0 && (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Buchungen in den nächsten 30 Tagen.</div>
            )}
```

to:

```tsx
            {vehicleBookings.length === 0 ? (
              <div className="dash-secondary px-6 py-4 text-[#6c6c70]">Keine Fahrzeug-Buchungen in den nächsten 30 Tagen.</div>
            ) : (
              <HeightFittedList minVisible={3} maxVisible={8}>
                {vehicleBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="grid grid-cols-[clamp(70px,4.5vw,110px)_minmax(160px,1.6fr)_clamp(104px,6.5vw,150px)_minmax(120px,1.4fr)] items-center gap-x-[18px] border-b border-[#f0f0f2] px-6 py-3"
                  >
                    <span className="dash-table-cell font-semibold">{formatBookingDate(booking.startsAt)}</span>
                    <span className="dash-table-cell overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
                      {booking.vehicleTaktischeBezeichnung}
                    </span>
                    <span className="dash-table-cell" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {formatBookingTimeRange(booking.startsAt, booking.endsAt)}
                    </span>
                    <span className="dash-secondary overflow-hidden text-ellipsis whitespace-nowrap text-[#48484c]">
                      {booking.borrowerName}
                    </span>
                  </div>
                ))}
              </HeightFittedList>
            )}
```

Note `HeightFittedList` itself renders `flex-1 min-h-0` — since this table's row-container previously had
no explicit flex sizing (it just stacked rows), and the table block overall is `flex-none` (fixed to its
content height, not stretched), this is fine: `HeightFittedList`'s own `flex-1` only matters when its
parent is itself a flex container with room to give, which in the Termine case it is (`flex-1
flex-col`), and in the Fahrzeuge case the rows simply stack at their natural height same as before — the
`ResizeObserver` still fires on mount and constrains `visibleCount` correctly either way, since
`clientHeight` is measured directly on the container regardless of how its own size was determined.

- [ ] **Step 4: Type-check and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: both clean.

- [ ] **Step 5: Verify in the browser**

Re-create the test token from Task 4 Step 6 (same SQL), seed at least 12 test `Event` rows and 10 test
`VehicleBooking` rows for FF Gablitz so the lists actually exceed their `maxVisible`, load
`/dashboard/test-dash-token-value` at a small window height, and confirm fewer rows show than at a tall
window height (resize the browser vertically and reload — the kiosk doesn't need live-resize, but
confirming two different reloads at two different heights show different counts is sufficient proof the
measurement works). Clean up all test data afterward.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/height-fitted-list.tsx "src/app/dashboard/[token]/page.tsx"
git commit -m "Add HeightFittedList and wire into Termine/Fahrzeuge lists"
```

---

### Task 6: Server-side QR code generation

**Files:**
- Modify: `package.json`
- Create: `src/lib/dashboard/qr-code.ts`
- Modify: `src/app/dashboard/[token]/page.tsx`

**Interfaces:**
- Produces: `generateAppQrCodeDataUri(): Promise<string>` — consumed by this task's page edit, and later
  by Task 13 (admin UI, showing the same QR next to a dashboard link).

- [ ] **Step 1: Add the dependency**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

Then move `qrcode` from `devDependencies` to `dependencies` in `package.json` if `npm install` placed it
in `dependencies` already (it should, since no `--save-dev` flag was used for the main package) — confirm
by checking `package.json` after the install: `qrcode` must appear under `"dependencies"`, `@types/qrcode`
under `"devDependencies"` (matching this project's convention that only `@types/*` packages live in
devDependencies).

- [ ] **Step 2: Write the QR helper**

```ts
import QRCode from 'qrcode';

const APP_URL = 'https://app-177.ff-wolfsgraben.at/';

/** Erzeugt den QR-Code für den App-Download-Link als SVG-Data-URI, serverseitig - Design-Spec §7:
 * Fehlerkorrektur M, Ruhezone 4 Module. Wird sowohl auf dem öffentlichen Dashboard als auch (Task 13)
 * in der Verwaltung verwendet, damit ein Admin denselben Code vor dem Ausdrucken sehen kann. */
export async function generateAppQrCodeDataUri(): Promise<string> {
  const svg = await QRCode.toString(APP_URL, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
  });
  const base64 = Buffer.from(svg, 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
```

- [ ] **Step 3: Wire it into the page**

In `src/app/dashboard/[token]/page.tsx`, add the import:

```ts
import { generateAppQrCodeDataUri } from '@/lib/dashboard/qr-code';
```

Add the fetch alongside the existing `Promise.all` (or as a separate `await` right after it — QR
generation is CPU-only and fast, no need to parallelize with the DB queries specifically, but doing so
costs nothing):

```ts
  const [events, vehicleBookings, totalBookingsCount, qrCodeDataUri] = await Promise.all([
    getDashboardEvents(valid.organizationId),
    getDashboardVehicleBookings(valid.organizationId),
    getUpcomingVehicleBookingsCount(valid.organizationId),
    generateAppQrCodeDataUri(),
  ]);
```

Replace the QR placeholder card's inner content:

```tsx
            <div className="flex h-[118px] w-[118px] flex-none items-center justify-center rounded-lg bg-white">
              <span className="dash-secondary text-center text-[#6c6c70]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                QR-Code
                <br />
                wird generiert
              </span>
            </div>
```

with:

```tsx
            <div className="flex h-[clamp(96px,7vw,180px)] w-[clamp(96px,7vw,180px)] flex-none items-center justify-center rounded-lg bg-white p-2">
              <img src={qrCodeDataUri} alt="QR-Code zum App-Download" className="h-full w-full" />
            </div>
```

- [ ] **Step 4: Type-check and verify**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Reload `/dashboard/test-dash-token-value` (recreate the test token if it was cleaned up) and confirm a
real, scannable QR code renders (zoom in / inspect the `<img>` element's `src` starts with
`data:image/svg+xml;base64,`). Clean up the test token afterward.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/dashboard/qr-code.ts "src/app/dashboard/[token]/page.tsx"
git commit -m "Add server-side QR code generation for the app download link"
```

---

### Task 7: WASTL proxy route with fallback cache

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/app/api/wastl/overview/route.ts`

**Interfaces:**
- Consumes: `prisma.wastlImageCache`.
- Produces: `GET /api/wastl/overview` — returns the proxied image bytes with `Content-Type` matching the
  source, `Cache-Control: s-maxage=120`; consumed by Task 8 (wiring the `<img>` into the page).

- [ ] **Step 1: Reconnaissance — fetch the real WASTL page first**

Before writing any scraping code, actually fetch the real source and inspect what it returns — the design
spec deliberately doesn't guess at this, since nobody in this session has fetched it live:

```bash
curl -sL -o /tmp/wastl-page.html "https://www.feuerwehr-krems.at/CodePages/Wastl/wastlmain/ShowOverview.asp"
head -c 2000 /tmp/wastl-page.html
grep -oiE '<img[^>]+src="[^"]+"' /tmp/wastl-page.html
```

Determine: is the response itself a raw image (`Content-Type: image/*`), or an HTML page containing an
`<img>` tag pointing at a separate image URL? If it's HTML, find the actual image URL (likely a relative
path — resolve it against the page's own origin) and fetch THAT URL directly to confirm it returns real
image bytes and a sensible `Content-Type`. Write down what you found in this task's implementation report
before proceeding — the exact fetch strategy below assumes the common case (HTML wrapper with one
overview `<img>`); adjust if the reconnaissance shows otherwise (e.g., if it's already a direct image
endpoint, skip the HTML-parsing step entirely and proxy it directly).

- [ ] **Step 2: Write the route, using `unstable_cache` matching the existing `system-check.ts` pattern**

```ts
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db/prisma';

const WASTL_PAGE_URL = 'https://www.feuerwehr-krems.at/CodePages/Wastl/wastlmain/ShowOverview.asp';
const FETCH_TIMEOUT_MS = 8000;

async function fetchWastlImage(): Promise<{ data: Buffer; mimeType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const pageResponse = await fetch(WASTL_PAGE_URL, { signal: controller.signal });
    if (!pageResponse.ok) return null;

    const contentType = pageResponse.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) {
      // Quelle liefert direkt ein Bild - kein HTML-Wrapper zu parsen (siehe Task-7-Rechercheergebnis).
      const buffer = Buffer.from(await pageResponse.arrayBuffer());
      return { data: buffer, mimeType: contentType };
    }

    const html = await pageResponse.text();
    const match = html.match(/<img[^>]+src="([^"]+)"/i);
    if (!match) return null;
    const imageUrl = new URL(match[1], WASTL_PAGE_URL).toString();

    const imageResponse = await fetch(imageUrl, { signal: controller.signal });
    if (!imageResponse.ok) return null;
    const imageMimeType = imageResponse.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return { data: buffer, mimeType: imageMimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** unstable_cache-gewrapptes Live-Fetch, 120s Toleranz - dasselbe Muster wie
 * getAdminSidebarStatus() in lib/system/system-check.ts. Bei Fehlschlag null statt zu werfen; der
 * Route-Handler entscheidet dann, ob das letzte erfolgreiche Bild aus WastlImageCache verwendet wird. */
const getCachedWastlImage = unstable_cache(fetchWastlImage, ['wastl-overview-image'], { revalidate: 120 });

export async function GET() {
  const fresh = await getCachedWastlImage();

  if (fresh) {
    // Erfolgreichen Abruf als neuen Fallback für künftige Ausfälle sichern.
    await prisma.wastlImageCache.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', data: fresh.data, mimeType: fresh.mimeType },
      update: { data: fresh.data, mimeType: fresh.mimeType, fetchedAt: new Date() },
    });
    return new NextResponse(new Uint8Array(fresh.data), {
      headers: { 'Content-Type': fresh.mimeType, 'Cache-Control': 's-maxage=120' },
    });
  }

  const cached = await prisma.wastlImageCache.findUnique({ where: { id: 'singleton' } });
  if (!cached) {
    return NextResponse.json({ error: 'WASTL derzeit nicht verfügbar' }, { status: 503 });
  }
  return new NextResponse(new Uint8Array(cached.data), {
    headers: {
      'Content-Type': cached.mimeType,
      'Cache-Control': 's-maxage=120',
      'X-Wastl-Stale-Since': cached.fetchedAt.toISOString(),
    },
  });
}
```

- [ ] **Step 3: Add the route to public path prefixes**

`/api/wastl` is not covered by any existing prefix. Add it to `src/middleware.ts`'s `PUBLIC_PATH_PREFIXES`
(the dashboard page fetches this route via a plain `<img src="/api/wastl/overview">`, which runs from the
kiosk browser with no session cookie, so it must be public):

```ts
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/kalender/ics',
  '/aktivieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
  '/drohnen-schnell',
  '/api/cron',
  '/dashboard',
  '/api/wastl',
];
```

- [ ] **Step 4: Type-check and verify**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Start the dev server and navigate directly to `http://localhost:PORT/api/wastl/overview` — confirm an
image renders in the browser (not a JSON error). Then temporarily break the fetch (e.g., change
`WASTL_PAGE_URL` to an unreachable host in a scratch copy, or just disconnect network briefly) and reload
— confirm the route still returns 200 with the last-cached image once one successful fetch has happened
at least once (seed `WastlImageCache` manually via SQL first if no successful live fetch is possible from
this environment's network — insert a small placeholder PNG's bytes to prove the fallback path works
end-to-end even without live internet access to the real WASTL host).

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/app/api/wastl/overview/route.ts
git commit -m "Add WASTL overview image proxy with cached fallback"
```

---

### Task 8: Wire the WASTL image into the dashboard page

**Files:**
- Modify: `src/app/dashboard/[token]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/wastl/overview` (Task 7).

- [ ] **Step 1: Replace the WASTL placeholder**

Replace:

```tsx
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
              <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
            </div>
            <div className="dash-secondary flex min-h-0 flex-1 items-center justify-center text-[#6c6c70]">
              Wird geladen …
            </div>
          </div>
```

with:

```tsx
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl bg-white p-[18px_22px] shadow-sm">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Lage Niederösterreich</span>
              <span className="dash-secondary text-[#6c6c70]">WASTL · Bezirksalarmzentralen</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxied same-origin image, next/image's optimizer adds no value here */}
              <img
                src="/api/wastl/overview"
                alt="WASTL Lagekarte Niederösterreich mit Einsatzstatus je Bezirk"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
            <div className="flex flex-none items-center justify-between border-t border-[#f0f0f2] pt-[10px]">
              <span className="dash-secondary flex items-center gap-4 text-[#48484c]">
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#5aa552' }} />
                  Normal
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#f2c14e' }} />
                  Erhöht
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[13px] w-[13px] rounded-[3px]" style={{ backgroundColor: '#e06666' }} />
                  Stark
                </span>
              </span>
            </div>
          </div>
```

Note: the per-district status line shown in the mockup ("Bezirk St. Pölten: erhöht") requires parsing the
WASTL page for district-level text, which the design spec does not ask for beyond the legend itself — the
legend explains the PNG's own color coding, and the PNG already shows every district's color. Leave the
per-district text line out unless a later task explicitly adds district-level scraping; the legend + image
already satisfy the spec's "Legende ... bleiben als eigene Zeile unter dem Bild" requirement.

- [ ] **Step 2: Type-check and verify**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Reload the dashboard page and confirm the WASTL card now shows a real (or fallback) image plus the
three-color legend row, still fitting inside its flex column without overflowing.

- [ ] **Step 3: Commit**

```bash
git add "src/app/dashboard/[token]/page.tsx"
git commit -m "Wire WASTL overview image and legend into the dashboard page"
```

---

### Task 9: Facebook Graph API fetch + hourly cron route

**Files:**
- Create: `src/lib/facebook/fetch-posts.ts`
- Create: `src/app/api/cron/facebook-fetch/route.ts`
- Create: `docker/facebook-fetch.sh`

**Interfaces:**
- Consumes: `Organization.facebookPageId`, `Organization.facebookPageAccessToken` (Task 1);
  `prisma.facebookPostCache`, `prisma.facebookPostImage`.
- Produces: `fetchAndCacheFacebookPosts(organizationId: string): Promise<void>` — called by the cron
  route for every `FEUERWEHR` org with Facebook configured; consumed only internally by this task's own
  route (later tasks read the cache directly via Prisma, not this function).

- [ ] **Step 1: Write the fetch/cache logic**

```ts
import { prisma } from '@/lib/db/prisma';

const GRAPH_API_VERSION = 'v21.0';
const MAX_POST_AGE_DAYS = 90;

interface GraphApiPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url: string;
  full_picture?: string;
}

interface GraphApiPostsResponse {
  data: GraphApiPost[];
}

export interface CachedFacebookPost {
  id: string;
  message: string | null;
  createdTime: string;
  permalinkUrl: string;
  hasImage: boolean;
}

/** Holt die Beiträge einer Facebook-Seite über die Graph API und schreibt sie in FacebookPostCache;
 * Bilder werden separat in FacebookPostImage abgelegt (Bytes in Postgres, siehe Task 1) - nur für
 * tatsächlich neue Post-IDs, damit ein stündlicher Refresh nicht jedes Mal alle Bilder neu herunterlädt.
 * Wird ausschließlich vom stündlichen Cron-Endpunkt aufgerufen, nie live bei einem Seitenaufruf (Design-
 * Spec §6: "Abruf 1x pro Stunde"). */
export async function fetchAndCacheFacebookPosts(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { facebookPageId: true, facebookPageAccessToken: true },
  });
  if (!org?.facebookPageId || !org.facebookPageAccessToken) return;

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${org.facebookPageId}/posts`);
  url.searchParams.set('fields', 'message,created_time,permalink_url,full_picture');
  url.searchParams.set('access_token', org.facebookPageAccessToken);

  const response = await fetch(url.toString());
  if (!response.ok) return;
  const body = (await response.json()) as GraphApiPostsResponse;

  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000);
  const recentPosts = body.data.filter((post) => new Date(post.created_time) >= cutoff);

  const posts: CachedFacebookPost[] = recentPosts.map((post) => ({
    id: post.id,
    message: post.message ?? null,
    createdTime: post.created_time,
    permalinkUrl: post.permalink_url,
    hasImage: Boolean(post.full_picture),
  }));

  await prisma.facebookPostCache.upsert({
    where: { organizationId },
    create: { organizationId, posts },
    update: { posts, fetchedAt: new Date() },
  });

  const postsWithImage = recentPosts.filter((post) => post.full_picture);
  for (const post of postsWithImage) {
    const alreadyCached = await prisma.facebookPostImage.findUnique({ where: { postId: post.id } });
    if (alreadyCached) continue;

    try {
      const imageResponse = await fetch(post.full_picture!);
      if (!imageResponse.ok) continue;
      const mimeType = imageResponse.headers.get('content-type') ?? 'image/jpeg';
      const data = Buffer.from(await imageResponse.arrayBuffer());
      await prisma.facebookPostImage.create({ data: { postId: post.id, data, mimeType } });
    } catch {
      // Ein einzelnes fehlgeschlagenes Bild darf den restlichen Cache-Refresh nicht abbrechen.
      continue;
    }
  }
}
```

- [ ] **Step 2: Write the cron route**

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { fetchAndCacheFacebookPosts } from '@/lib/facebook/fetch-posts';

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const organizations = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', facebookPageId: { not: null } },
    select: { id: true },
  });

  for (const org of organizations) {
    try {
      await fetchAndCacheFacebookPosts(org.id);
    } catch {
      // Eine Feuerwehr's Graph-API-Fehler darf die anderen nicht blockieren - dasselbe Muster wie
      // checkAndNotifyAtemschutzWarnungen() (eigenes try/catch pro Organisation).
      continue;
    }
  }

  return NextResponse.json({ ok: true, count: organizations.length });
}
```

- [ ] **Step 3: Write the host cron wrapper script**

```bash
#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
. ./.env
curl -fsS "${AUTH_URL}/api/cron/facebook-fetch?secret=${CRON_SECRET}" >> docker/facebook-fetch.log 2>&1
```

Make it executable (git-tracked, matching this project's existing convention for host cron scripts):

```bash
chmod +x docker/facebook-fetch.sh
git update-index --chmod=+x docker/facebook-fetch.sh
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output. (`/api/cron` is already a public prefix in `middleware.ts` — no change needed there.)

- [ ] **Step 5: Verify with a real or fake Graph API token**

If a real Facebook Page Access Token is available for testing, set `facebookPageId`/
`facebookPageAccessToken` on a test org via SQL and hit
`curl "http://localhost:PORT/api/cron/facebook-fetch?secret=<your CRON_SECRET from .env>"` — confirm a
`FacebookPostCache` row appears (`docker exec app-177-postgres-1 psql -U ffapp -d ffapp -c "SELECT * FROM \"FacebookPostCache\";"`).
If no real token is available in this environment, verify the no-token no-op path instead: confirm the
route returns `{ ok: true, count: 0 }` when no organization has `facebookPageId` set, and confirm
`fetchAndCacheFacebookPosts` is a true no-op (returns immediately) for an org with `facebookPageId` set
but no `facebookPageAccessToken` — test this directly with a small script:

```bash
npx tsx -e "
import { fetchAndCacheFacebookPosts } from './src/lib/facebook/fetch-posts';
fetchAndCacheFacebookPosts('nonexistent-org-id').then(() => console.log('no-op OK, no throw'));
"
```

Report which verification path was used in this task's implementation report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/facebook/fetch-posts.ts src/app/api/cron/facebook-fetch/route.ts docker/facebook-fetch.sh
git commit -m "Add Facebook Graph API fetch and hourly cron endpoint"
```

---

### Task 10: Facebook post image serving route

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/app/api/facebook/image/[postId]/route.ts`

**Interfaces:**
- Consumes: `prisma.facebookPostImage` (Task 1/9).
- Produces: `GET /api/facebook/image/[postId]` — returns image bytes or 404; consumed by Task 11's page
  wiring.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const image = await prisma.facebookPostImage.findUnique({ where: { postId } });
  if (!image) {
    return NextResponse.json({ error: 'nicht gefunden' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.mimeType, 'Cache-Control': 'public, max-age=3600, immutable' },
  });
}
```

`immutable` is safe here: a given `postId`'s image never changes once cached (a new post gets a new
`postId`), so a full hour of browser caching plus `immutable` avoids re-fetching the same bytes on every
5-minute kiosk reload.

- [ ] **Step 2: Add to public path prefixes**

```ts
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/kalender/ics',
  '/aktivieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
  '/drohnen-schnell',
  '/api/cron',
  '/dashboard',
  '/api/wastl',
  '/api/facebook/image',
];
```

- [ ] **Step 3: Type-check and verify**

```bash
npx tsc --noEmit -p tsconfig.json
```

If a `FacebookPostImage` row exists from Task 9's verification, navigate directly to
`/api/facebook/image/<that postId>` and confirm the image renders. Otherwise, insert one manually via SQL
with a small test PNG's bytes and confirm the same.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts "src/app/api/facebook/image/[postId]/route.ts"
git commit -m "Add Facebook post image serving route"
```

---

### Task 11: Wire the Facebook feed into the dashboard page

**Files:**
- Modify: `src/app/dashboard/[token]/page.tsx`

**Interfaces:**
- Consumes: `prisma.facebookPostCache` (read directly, not via `fetchAndCacheFacebookPosts` — the page
  never fetches live, only reads what the hourly cron already wrote); `HeightFittedList` (Task 5);
  `/api/facebook/image/[postId]` (Task 10).

- [ ] **Step 1: Add the Facebook cache read**

Add a helper function near the top of `page.tsx` (or inline in the component — given it's a single
`findUnique`, inline is fine) and fetch it alongside the other `Promise.all` entries:

```ts
  const [events, vehicleBookings, totalBookingsCount, qrCodeDataUri, organizationFull, facebookCache] = await Promise.all([
    getDashboardEvents(valid.organizationId),
    getDashboardVehicleBookings(valid.organizationId),
    getUpcomingVehicleBookingsCount(valid.organizationId),
    generateAppQrCodeDataUri(),
    prisma.organization.findUnique({ where: { id: valid.organizationId }, select: { name: true, facebookPageId: true } }),
    prisma.facebookPostCache.findUnique({ where: { organizationId: valid.organizationId } }),
  ]);
```

(This replaces the earlier separate `organization` fetch from Task 4 with `organizationFull` here so
`facebookPageId` is available too, alongside the `name` the header already needed — note the `select`
includes BOTH fields, not `facebookPageId` alone, since the header JSX still reads `.name`. Update the
earlier `const organization = await prisma.organization.findUnique({ where: { id: valid.organizationId },
select: { name: true, shortName: true } })` call from Task 4's Step 4 to be removed entirely, and every
place in the JSX that read `organization.name` now reads `organizationFull.name` instead — Task 4's JSX
never actually used `organization.shortName` despite selecting it, so there is no `.shortName` reference
to migrate, just the unused extra field to drop. Also move the `if (!organization) { notFound(); }` check
to check `organizationFull` instead — but since `organizationFull` is now fetched inside the same
`Promise.all` as everything else, restructure slightly: keep all five fetches in one `Promise.all` (none
of them depend on each other, all only need `valid.organizationId`), and do the "organization must exist"
check on the resolved `organizationFull` right after the `Promise.all` completes, exactly where the
`if (!organization)` check already sat in Task 4.)

- [ ] **Step 2: Compute the display logic (newest post with image, or most recent within 30 days)**

Add this logic right after the `Promise.all` resolves, before the JSX return:

```ts
  const posts = (facebookCache?.posts as CachedFacebookPostShape[] | undefined) ?? [];
  const newestPost = posts[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const featuredPost =
    newestPost?.hasImage
      ? newestPost
      : posts.find((post) => post.hasImage && new Date(post.createdTime) >= thirtyDaysAgo);
  const compactPosts = posts.filter((post) => post.id !== featuredPost?.id);
```

Add the shape type near the top of the file (or import `CachedFacebookPost` from
`@/lib/facebook/fetch-posts` directly instead of redeclaring — prefer the import, since it's the same
shape the cron route writes):

```ts
import type { CachedFacebookPost } from '@/lib/facebook/fetch-posts';
```

and use `CachedFacebookPost` instead of `CachedFacebookPostShape` in the cast above.

- [ ] **Step 3: Replace the Facebook placeholder**

Replace:

```tsx
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white p-[22px] shadow-sm">
              <span className="dash-secondary text-[#6c6c70]">Wird geladen …</span>
            </div>
          </div>
```

with:

```tsx
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex flex-none items-baseline justify-between">
              <span className="dash-section-label font-bold uppercase tracking-[0.15em] text-[#6c6c70]">Aus unserer Feuerwehr</span>
              {organizationFull.facebookPageId && (
                <span className="dash-secondary text-[#6c6c70]">facebook.com/{organizationFull.facebookPageId}</span>
              )}
            </div>

            {!organizationFull.facebookPageId ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-white p-[22px] shadow-sm">
                <span className="dash-secondary text-[#6c6c70]">Facebook nicht verbunden</span>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-hidden rounded-xl bg-white p-[22px] shadow-sm">
                {featuredPost && (
                  <div className="flex-none">
                    <div className="mb-3.5 aspect-video w-full overflow-hidden rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served from our own /api/facebook/image proxy */}
                      <img
                        src={`/api/facebook/image/${featuredPost.id}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="dash-secondary mb-2 text-[#6c6c70]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {new Date(featuredPost.createdTime).toLocaleDateString('de-AT')}
                    </div>
                    {featuredPost.message && (
                      <div className="text-[23px] font-semibold leading-snug" style={{ textWrap: 'pretty' }}>
                        {featuredPost.message.split('\n')[0]}
                      </div>
                    )}
                  </div>
                )}

                {compactPosts.length > 0 && (
                  <HeightFittedList minVisible={2} maxVisible={6}>
                    {compactPosts.map((post) => (
                      <div key={post.id} className="flex items-baseline gap-4 border-t border-[#f0f0f2] pt-3.5 first:border-t-0 first:pt-0">
                        <span
                          className="dash-secondary w-[100px] flex-none text-[#6c6c70]"
                          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                        >
                          {new Date(post.createdTime).toLocaleDateString('de-AT')}
                        </span>
                        <span className="dash-table-cell flex-1 font-semibold" style={{ textWrap: 'pretty' }}>
                          {post.message?.split('\n')[0] ?? ''}
                        </span>
                      </div>
                    ))}
                  </HeightFittedList>
                )}

                {!featuredPost && compactPosts.length === 0 && (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <span className="dash-secondary text-[#6c6c70]">Noch keine Beiträge.</span>
                  </div>
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 4: Type-check and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

- [ ] **Step 5: Verify all three Facebook states in the browser**

1. Org with no `facebookPageId` set: confirm "Facebook nicht verbunden".
2. Org with `facebookPageId` set but an empty/no `FacebookPostCache` row: confirm "Noch keine Beiträge."
3. Org with a `FacebookPostCache` row containing at least one post with `hasImage: true` and a matching
   `FacebookPostImage` row (seed both directly via SQL/a small script if no real Graph API access is
   available in this environment) plus 2+ posts without images: confirm the featured post renders large
   with its image, and the rest render as the compact date+headline list.

Clean up all test data afterward.

- [ ] **Step 6: Commit**

```bash
git add "src/app/dashboard/[token]/page.tsx"
git commit -m "Wire Facebook feed into the dashboard page"
```

---

### Task 12: Admin actions — create/expire/revoke dashboard tokens, set Facebook config

**Files:**
- Create: `src/app/(app)/admin/heimatfeuerwehr/dashboard-token-actions.ts`

**Interfaces:**
- Consumes: `generateDashboardToken`, `setDashboardTokenExpiry`, `revokeDashboardToken` (Task 2);
  `canManageHeimatfeuerwehrFor` (existing, `@/lib/auth/permissions`); `requireUser` (existing).
- Produces: `createDashboardToken(organizationId: string): Promise<void>`,
  `setTokenExpiry(tokenId: string, organizationId: string, formData: FormData): Promise<{ error?: string }>`,
  `revokeToken(tokenId: string, organizationId: string): Promise<void>`,
  `setFacebookConfig(organizationId: string, _prevState: FacebookConfigState, formData: FormData): Promise<FacebookConfigState>`
  (with exported `FacebookConfigState` type) — all consumed by Task 13 (admin UI).

- [ ] **Step 1: Write the file**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireUser } from '@/lib/auth/session';
import { assertPermission, canManageHeimatfeuerwehrFor } from '@/lib/auth/permissions';
import { generateDashboardToken, setDashboardTokenExpiry, revokeDashboardToken } from '@/lib/dashboard/token';

export async function createDashboardToken(organizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  await generateDashboardToken(organizationId, user.id);
  revalidatePath('/admin/heimatfeuerwehr');
}

/** organizationId wird nur zur Berechtigungsprüfung übergeben (der Token selbst trägt seine eigene
 * organizationId in der DB) - ein Admin könnte sonst versuchen, das Ablaufdatum eines fremden Tokens
 * zu setzen, indem er dessen tokenId errät; die Prüfung läuft daher gegen die tatsächlich gespeicherte
 * organizationId des Tokens, nicht gegen das vom Client behauptete organizationId-Argument. */
export async function setTokenExpiry(
  tokenId: string,
  claimedOrganizationId: string,
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, claimedOrganizationId));

  const token = await prisma.dashboardToken.findUnique({ where: { id: tokenId }, select: { organizationId: true } });
  if (!token) {
    return { error: 'Token wurde nicht gefunden.' };
  }
  assertPermission(canManageHeimatfeuerwehrFor(user, token.organizationId));

  const raw = formData.get('expiresAt');
  const expiresAt = typeof raw === 'string' && raw.length > 0 ? new Date(raw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { error: 'Ungültiges Datum.' };
  }

  await setDashboardTokenExpiry(tokenId, expiresAt);
  revalidatePath('/admin/heimatfeuerwehr');
  return {};
}

export async function revokeToken(tokenId: string, claimedOrganizationId: string): Promise<void> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, claimedOrganizationId));

  const token = await prisma.dashboardToken.findUnique({ where: { id: tokenId }, select: { organizationId: true } });
  if (!token) return;
  assertPermission(canManageHeimatfeuerwehrFor(user, token.organizationId));

  await revokeDashboardToken(tokenId);
  revalidatePath('/admin/heimatfeuerwehr');
}

export interface FacebookConfigState {
  success?: boolean;
  error?: string;
}

/** Leere Eingabe für beide Felder ist gültig (= "Facebook nicht verbunden" auf dem Dashboard), analog
 * zu setAtemschutzSachbearbeiter's optionalem E-Mail-Feld. */
export async function setFacebookConfig(
  organizationId: string,
  _prevState: FacebookConfigState,
  formData: FormData,
): Promise<FacebookConfigState> {
  const user = await requireUser();
  assertPermission(canManageHeimatfeuerwehrFor(user, organizationId));

  const pageId = formData.get('facebookPageId');
  const accessToken = formData.get('facebookPageAccessToken');

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      facebookPageId: typeof pageId === 'string' && pageId.trim() ? pageId.trim() : null,
      facebookPageAccessToken: typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : null,
    },
  });

  revalidatePath('/admin/heimatfeuerwehr');
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/admin/heimatfeuerwehr/dashboard-token-actions.ts"
git commit -m "Add admin actions for dashboard tokens and Facebook config"
```

---

### Task 13: Admin UI — "Dashboard Feuerwehrhaus" section on `/admin/heimatfeuerwehr`

**Files:**
- Modify: `src/app/(app)/admin/heimatfeuerwehr/page.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/dashboard-token-expiry-form.tsx`
- Create: `src/app/(app)/admin/heimatfeuerwehr/dashboard-facebook-config-form.tsx`

**Interfaces:**
- Consumes: `listDashboardTokens` (Task 2); `createDashboardToken`, `setTokenExpiry`, `revokeToken`,
  `setFacebookConfig`, `FacebookConfigState` (Task 12); `generateAppQrCodeDataUri` (Task 6);
  `CopyLinkButton` (existing, `@/components/ui/copy-link-button`).

- [ ] **Step 1: Add the imports and the `Promise.all` query**

In `src/app/(app)/admin/heimatfeuerwehr/page.tsx`, add these imports alongside the existing ones:

```ts
import { listDashboardTokens } from '@/lib/dashboard/token';
import { generateAppQrCodeDataUri } from '@/lib/dashboard/qr-code';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { createDashboardToken, setTokenExpiry, revokeToken, setFacebookConfig } from './dashboard-token-actions';
import { DashboardTokenExpiryForm } from './dashboard-token-expiry-form';
import { DashboardFacebookConfigForm } from './dashboard-facebook-config-form';
```

Change the existing `Promise.all([vehicles, members, allBookings])` to a five-element array, adding
`dashboardTokens` and `qrCodeDataUri`:

```ts
  const [vehicles, members, allBookings, dashboardTokens, qrCodeDataUri] = await Promise.all([
    prisma.vehicle.findMany({
      where: { organizationId: selectedOrgId },
      orderBy: { taktischeBezeichnung: 'asc' },
    }),
    prisma.user.findMany({
      where: { homeOrganizationId: selectedOrgId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        istAtemschutzgeraeteTraeger: true,
        atemschutzUntersuchungAm: true,
        atemschutzGueltigBis: true,
        atemschutzFinnentestAm: true,
      },
    }),
    prisma.vehicleBooking.findMany({
      where: { vehicle: { organizationId: selectedOrgId } },
      orderBy: { startsAt: 'desc' },
      include: {
        vehicle: { select: { taktischeBezeichnung: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    listDashboardTokens(selectedOrgId),
    generateAppQrCodeDataUri(),
  ]);
```

Also, `selectedOrg` (already destructured earlier in the file as `allowedOrgs.find((o) => o.id ===
selectedOrgId)!`) needs `facebookPageId`/`facebookPageAccessToken` selected — the existing `allowedOrgs`
query uses `prisma.organization.findMany({ where: ..., orderBy: { name: 'asc' } })` with no `select`, so
every scalar column (including the two new Facebook fields, once Task 1's migration is applied) is
already included by default. No change needed there.

- [ ] **Step 2: Add a `NEXT_PUBLIC_APP_URL`-independent base URL helper**

The dashboard link needs the app's own current origin. Add this small helper near the top of the file
(reuse if one already exists for a similar purpose elsewhere in the codebase — grep for `AUTH_URL` first;
if `process.env.AUTH_URL` is already used server-side for building absolute links in this project, e.g. in
`src/lib/email/templates.ts`, reuse that exact same env var instead of introducing a new one):

```ts
function buildDashboardLink(token: string): string {
  const baseUrl = process.env.AUTH_URL ?? 'http://localhost:3000';
  return `${baseUrl}/dashboard/${token}`;
}
```

- [ ] **Step 3: Write the token-expiry inline form (client component)**

```tsx
'use client';

import { useActionState } from 'react';
import { setTokenExpiry } from './dashboard-token-actions';

interface DashboardTokenExpiryFormProps {
  tokenId: string;
  organizationId: string;
  initialExpiresAt: string;
}

/** Ein Datum + "Setzen"-Button pro Token-Zeile, inline in der Tabelle - kein Dialog nötig, da nur ein
 * einziges Feld geändert wird. Leeres Datum = kein Ablauf (unbefristet). */
export function DashboardTokenExpiryForm({ tokenId, organizationId, initialExpiresAt }: DashboardTokenExpiryFormProps) {
  const boundAction = setTokenExpiry.bind(null, tokenId, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        type="date"
        name="expiresAt"
        defaultValue={initialExpiresAt}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line px-2 py-1 text-sm text-ink hover:bg-surface-sunken disabled:opacity-60"
      >
        Setzen
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 4: Write the Facebook config form (client component)**

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import { setFacebookConfig, type FacebookConfigState } from './dashboard-token-actions';

const initialState: FacebookConfigState = {};

interface DashboardFacebookConfigFormProps {
  organizationId: string;
  initialPageId: string;
  initialAccessToken: string;
}

/** Zwei Felder für die Facebook-Seite dieser Heimatfeuerwehr - analog zu AtemschutzSachbearbeiterForm
 * (leeres Feld ist gültig = "Facebook nicht verbunden" auf dem Dashboard). Das Access-Token-Feld ist
 * type="password", damit es beim Betrachten des Bildschirms (z. B. während einer Bildschirmfreigabe)
 * nicht im Klartext sichtbar ist. */
export function DashboardFacebookConfigForm({ organizationId, initialPageId, initialAccessToken }: DashboardFacebookConfigFormProps) {
  const boundAction = setFacebookConfig.bind(null, organizationId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  return (
    <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="facebookPageId" className="text-[13px] font-medium text-ink">
          Facebook Page-ID
        </label>
        <input
          id="facebookPageId"
          name="facebookPageId"
          type="text"
          defaultValue={initialPageId}
          onChange={() => setDirty(true)}
          placeholder="z. B. feuerwehr.wolfsgraben"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="facebookPageAccessToken" className="text-[13px] font-medium text-ink">
          Page Access Token
        </label>
        <input
          id="facebookPageAccessToken"
          name="facebookPageAccessToken"
          type="password"
          defaultValue={initialAccessToken}
          onChange={() => setDirty(true)}
          placeholder="Long-Lived Page Access Token"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
          saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
        }`}
      >
        {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
      </button>
      {state.error && <p className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Add the new section to the page**

Add this as a fifth section, right after the existing "Fahrzeug-Buchungen" section (before the outer
wrapping `</div>` that closes the page's top-level `flex flex-col gap-4` container):

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Dashboard Feuerwehrhaus</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Öffentlicher, token-geschützter Kiosk-Screen für einen PC im Feuerwehrhaus - zeigt kommende
          Termine, ausgeborgte Fahrzeuge, die WASTL-Lagekarte und den Facebook-Feed. Kein Login nötig, wer
          den Link/QR-Code kennt, kann ausschließlich diese Ansicht lesen (keine Zu-/Absagen, keine
          Atemschutzdaten). Ein widerrufener Link ist sofort ungültig.
        </p>

        <DashboardFacebookConfigForm
          organizationId={selectedOrgId}
          initialPageId={selectedOrg.facebookPageId ?? ''}
          initialAccessToken={selectedOrg.facebookPageAccessToken ?? ''}
        />

        <Table>
          <TableHeader>
            <TableRow className="border-b-2 border-line-strong hover:bg-transparent">
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Erstellt am
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Ablaufdatum
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Zuletzt verwendet
              </TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                Status
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {dashboardTokens.map((token) => {
              const boundRevoke = revokeToken.bind(null, token.id, selectedOrgId);
              const link = buildDashboardLink(token.token);
              return (
                <TableRow key={token.id} className="border-line">
                  <TableCell className="text-ink-muted">{token.createdAt.toLocaleDateString('de-AT')}</TableCell>
                  <TableCell>
                    {token.revokedAt ? (
                      <span className="text-ink-faint">–</span>
                    ) : (
                      <DashboardTokenExpiryForm
                        tokenId={token.id}
                        organizationId={selectedOrgId}
                        initialExpiresAt={toDateInputValue(token.expiresAt)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {token.lastUsedAt ? token.lastUsedAt.toLocaleString('de-AT') : 'noch nie'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        token.revokedAt
                          ? 'border-transparent bg-surface-sunken text-ink-faint'
                          : token.expiresAt && token.expiresAt.getTime() < Date.now()
                            ? 'border-transparent bg-danger-subtle text-danger'
                            : 'border-transparent bg-success-subtle text-success-text'
                      }
                    >
                      {token.revokedAt ? 'Widerrufen' : token.expiresAt && token.expiresAt.getTime() < Date.now() ? 'Abgelaufen' : 'Aktiv'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!token.revokedAt && (
                      <div className="flex items-center justify-end gap-3">
                        <details>
                          <summary className="inline-block cursor-pointer text-sm text-brand hover:underline">QR anzeigen</summary>
                          <div className="mt-2 flex items-start gap-2">
                            <img src={qrCodeDataUri} alt={`QR-Code für ${link}`} className="h-24 w-24" />
                            <div className="flex flex-col gap-1">
                              <p className="max-w-xs break-all rounded-md border border-line bg-surface-sunken px-2 py-1 text-xs text-ink">
                                {link}
                              </p>
                              <CopyLinkButton text={link} />
                            </div>
                          </div>
                        </details>
                        <form action={boundRevoke}>
                          <button type="submit" className="text-sm text-danger hover:underline">
                            Widerrufen
                          </button>
                        </form>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {dashboardTokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-ink-muted">
                  Noch kein Dashboard-Link erzeugt.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <form action={createDashboardToken.bind(null, selectedOrgId)} className="mt-3">
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover">
            Neuen Link erzeugen
          </button>
        </form>
      </div>
```

Note the reused `toDateInputValue` helper — it already exists at the top of this same file (used by
`AtemschutzEditDialog`'s target-building), so no new helper is needed for the expiry-date formatting.

- [ ] **Step 6: Type-check and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

- [ ] **Step 7: Verify in the browser**

Navigate to `/admin/heimatfeuerwehr?org=<a Feuerwehr id>` as the seeded site admin. Confirm the new
"Dashboard Feuerwehrhaus" section renders with the Facebook config form and an empty token table plus
"Neuen Link erzeugen". Click it (native form submit works without hydration, per this project's
established browser-automation limitation) and confirm a new row appears with "Aktiv" status, a working
"QR anzeigen" disclosure (native `<details>`, no JS needed), a copyable link, a date input for expiry, and
a "Widerrufen" button that flips the status badge to "Widerrufen" and removes the row's action controls.
Set an expiry date in the past and confirm the badge becomes "Abgelaufen". Load the token's own dashboard
link in the browser (`/dashboard/<the actual token value>` — copy it from the rendered link text) and
confirm it renders the real dashboard. Then revoke it and confirm the same URL now 404s. Clean up test
tokens afterward via SQL or the "Widerrufen" UI (revoked rows can be left in place — they're valid audit
history, not test pollution requiring deletion, though deleting is also fine if preferred for a clean
demo dataset).

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/admin/heimatfeuerwehr/page.tsx" "src/app/(app)/admin/heimatfeuerwehr/dashboard-token-expiry-form.tsx" "src/app/(app)/admin/heimatfeuerwehr/dashboard-facebook-config-form.tsx"
git commit -m "Add Dashboard Feuerwehrhaus admin section (tokens + Facebook config)"
```

---

### Task 14: Kiosk docs — cron entry, Chrome flags, README

**Files:**
- Modify: `docker/README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the Facebook cron entry to the crontab section**

In `docker/README.md`, find the existing crontab documentation (the section listing `backup.sh`,
`system-check-email.sh`, `atemschutz-warnung-email.sh` entries) and add one more line following the exact
same format as the existing entries, e.g.:

```
0 * * * * /path/to/app-177/docker/facebook-fetch.sh
```

with a one-line explanation ("stündlicher Facebook-Feed-Abruf für das Dashboard Feuerwehrhaus, Issue #8")
matching the style of the surrounding entries.

- [ ] **Step 2: Add a new "Dashboard Feuerwehrhaus (Kiosk)" section**

Add a new top-level section (after the existing crontab section) documenting the Windows kiosk setup:

```markdown
## Dashboard Feuerwehrhaus (Kiosk-Screen)

Der öffentliche Kiosk-Screen (`/dashboard/[token]`, Issue #8) läuft auf einem gewöhnlichen Windows-PC im
Feuerwehrhaus, Chrome im Vollbild. Den Link/QR-Code erzeugt ein Feuerwehr-Admin unter Verwaltung →
Heimatfeuerwehr → "Dashboard Feuerwehrhaus".

Empfohlener Chrome-Start (Verknüpfung im Autostart-Ordner):

```
chrome.exe --kiosk --noerrdialogs --disable-session-crashed-bubble "https://<domain>/dashboard/<token>"
```

Die Seite lädt sich selbst alle 5 Minuten neu (`<meta http-equiv="refresh">`) - kein zusätzlicher
Neustart-Mechanismus nötig. Kein Zoom/Skalierung erforderlich, das Layout passt sich der tatsächlichen
Displayauflösung automatisch an.
```

- [ ] **Step 3: Commit**

```bash
git add docker/README.md
git commit -m "Document Facebook cron entry and kiosk Chrome setup"
```

---

### Task 15: Full verification, CLAUDE.md, final commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: both clean, `/dashboard/[token]`, `/api/wastl/overview`, `/api/cron/facebook-fetch`,
`/api/facebook/image/[postId]` all listed in the build output.

- [ ] **Step 2: Resolution sweep**

Start the dev server, create a fresh test `DashboardToken` (SQL, as in Task 4 Step 6), seed enough test
`Event`/`VehicleBooking` rows to exceed each list's `maxVisible`, and load `/dashboard/<token>` at each of:
1366×768, 1920×1080, 2560×1440, 3840×2160, and a portrait viewport (e.g. 1080×1920). For each: confirm no
scrollbar, no clipped content, no text rendering below 14px (use the browser's computed-style inspector on
the smallest text elements to confirm), and confirm 3840×2160 shows visibly more list entries than
1920×1080 for at least the Termine block.

- [ ] **Step 3: Failure-mode sweep**

Confirm: invalid token → real 404 (check response status, not just visual content). WASTL image proxy
falls back to cache when the live fetch fails (simulate by temporarily pointing the fetch at an
unreachable URL, or by relying on this environment's actual network access if the real WASTL host is
unreachable from here anyway — either way, confirm `WastlImageCache` is used and the card never renders
empty). Facebook block shows "Facebook nicht verbunden" with no `facebookPageId` configured, and remains
fully rendered (no error, no blank card) even when `FacebookPostCache` has no row at all for that org.

- [ ] **Step 4: Admin flow end-to-end**

As documented in Task 13 Step 7 — token creation, QR display, copy, expiry, revocation, and Facebook
config save, all against real data.

- [ ] **Step 5: Clean up all test data**

Remove every test `DashboardToken`, `Event`, `VehicleBooking`, `FacebookPostCache`, `FacebookPostImage`,
`WastlImageCache` (unless a real successful fetch already populated `WastlImageCache` legitimately, in
which case leave it — it's real, useful fallback data, not test pollution) row created during this task
and Tasks 4–13's own verification steps.

- [ ] **Step 6: Update CLAUDE.md**

Add a new top-level `### Module 5: Dashboard Feuerwehrhaus` section (after the existing "Module 4: Meine
Feuerwehr" section and its Heimatfeuerwehr V3/V4 sub-sections), documenting: the public token-gated route
and its deliberate `notFound()`-on-invalid-token behavior (contrasted with `drohnen-schnell`'s
always-200 pattern, and why — spec explicitly calls for "kein Hinweis auf die Existenz der Seite"); the
`DashboardToken`/`FacebookPostCache`/`FacebookPostImage`/`WastlImageCache` schema and the Bytes-in-Postgres
rationale (mirroring `DroneDocument`); the fluid `clamp()`/grid layout and the `HeightFittedList`
ResizeObserver component's "measure once at mount, no live-resize regrowth" tradeoff; the WASTL proxy's
`unstable_cache` + DB-fallback pattern; the Facebook hourly-cron-not-live-fetch design and its 90-day
cutoff; the QR code generation; and the new admin section on `/admin/heimatfeuerwehr` — written in the
same style/depth as this file's existing module documentation (see the file for tone and reference-density
to match, e.g. the existing "Module 4: Meine Feuerwehr" and "News module (Web Push)" sections as the
closest structural precedents: public/token-gated route + admin management UI + external
integration-with-fallback).

- [ ] **Step 7: Stage everything and confirm before committing**

```bash
git status --short
```

Use `AskUserQuestion` to confirm before the final commit/push, summarizing what was verified live per
Steps 2–4 — do not skip this, and do not forget the actual `git push`/PR step afterward per whatever
merge process the user prefers (this project has used both "merge locally to main" and "push branch +
create PR" in different rounds — ask which applies here rather than assuming).

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md
git commit -m "Document Dashboard Feuerwehrhaus (Issue #8)"
```
