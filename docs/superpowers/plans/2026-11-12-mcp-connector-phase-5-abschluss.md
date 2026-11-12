# MCP-Connector · Phase 5: Verbindungen verwalten, Aufräumen, Dokumentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den MCP-Connector betriebsreif machen: Jeder Benutzer sieht und beendet seine Verbindungen ("Verbundene KI-Apps" im Profil), Admins sperren alle Verbindungen eines Benutzers und sehen das Prüfprotokoll, ein täglicher Cron räumt Prüfprotokoll und abgelaufene Token auf, und die Dokumentation (Modul-`CLAUDE.md`, `README.md`, `docker/README.md`) ist aktuell.

**Architecture:** Eine kleine Service-Datei `src/lib/mcp/connections.ts` (Verbindungen je Client, Widerruf) und `src/lib/mcp/retention.ts` (Aufräumen) mit DB-Tests; darauf aufbauend eine Profilseite, eine Server Action der Benutzerverwaltung, ein Cron-Endpunkt nach dem Muster von `report-retention` und ein Host-Skript.

**Tech Stack:** Next.js (Server Components/Actions, Route Handler), Prisma, vitest, POSIX-Shell.

**Voraussetzung:** Phasen 1–4 sind umgesetzt (`OauthToken`, `revokeTokensOfUser`, `isMcpEnabled`, `McpAuditLog`, `canManageUserRecord`, `ProfileMenu`).

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`

## Global Constraints

- **Verbindungen:** Jeder sieht und beendet nur seine eigenen. Ein Admin sperrt alle Token eines Benutzers nur, wenn `canManageUserRecord(currentUser, target)` gilt (Rechtestufe des Ziels wird mitgeprüft).
- **Aufbewahrung:** Prüfprotokoll 180 Tage; widerrufene oder abgelaufene Token 30 Tage nach Widerruf/Ablauf; Autorisierungscodes einen Tag nach Ablauf. Täglicher Cron `/api/cron/mcp-retention` (Secret-Muster wie `report-retention`), Host-Skript `docker/mcp-retention.sh` (LF-Zeilenenden, ausführbar im Repo).
- **Schalter aus:** Die Profilseite antwortet 404, der Menüeintrag fehlt. Das Aufräumen läuft unabhängig vom Schalter.
- **Keine neuen Umgebungsvariablen** (der Cron nutzt das vorhandene `CRON_SECRET`).
- **Host-Skripte:** nie mit `bash -x`/`set -x` debuggen (sie exportieren alle `.env`-Werte); `.env` wird zeilenweise gelesen, nie mit `source`.
- Übrige Konventionen wie in den Phasen 1–4 (CRLF, Tests, Commits nur auf Anweisung).

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/lib/mcp/connections.ts` | `listConnections`, `revokeConnection`, `getKiAppsVisibility` |
| `src/lib/mcp/retention.ts` | `purgeMcpData` |
| `src/app/(app)/profile/ki-apps/{page.tsx,actions.ts}` | Profilseite "Verbundene KI-Apps" |
| `src/components/layout/profile-menu.tsx`, `src/app/(app)/layout.tsx` (ändern) | Menüeintrag |
| `src/app/(app)/admin/benutzer/actions.ts`, `src/components/admin/user-form-sheet.tsx` (ändern) | "Verbindungen sperren" |
| `src/app/(app)/admin/mcp/page.tsx` (ändern) | Prüfprotokoll-Ansicht |
| `src/app/api/cron/mcp-retention/route.ts`, `docker/mcp-retention.sh` | Aufräumen |
| `src/lib/mcp/CLAUDE.md`, `CLAUDE.md`, `README.md`, `docker/README.md` | Dokumentation |

---

### Task 1: Verbindungen (Service, Profilseite, Menüeintrag)

**Files:**
- Create: `src/lib/mcp/connections.ts`, `src/app/(app)/profile/ki-apps/page.tsx`, `src/app/(app)/profile/ki-apps/actions.ts`
- Modify: `src/components/layout/profile-menu.tsx`, `src/app/(app)/layout.tsx`
- Test: `src/lib/mcp/connections.db.test.ts`

**Interfaces:**
- Produces:
  - `interface McpConnection { oauthClientId: string; clientName: string; scope: string; connectedAt: Date; lastUsedAt: Date | null }`
  - `listConnections(userId: string, now?: Date): Promise<McpConnection[]>` — ein Eintrag je Client mit noch gültigem (nicht widerrufen, Refresh nicht abgelaufen) Token, neueste Verbindung zuerst
  - `revokeConnection(userId: string, oauthClientId: string): Promise<number>` — widerruft nur Token dieses Benutzers für diesen Client
  - `getKiAppsVisibility(userId: string): Promise<boolean>` — `isMcpEnabled()` und `mcpAccess !== 'NONE'`

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/connections.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getKiAppsVisibility, listConnections, revokeConnection } from './connections';
import { isMcpEnabled, setMcpEnabled } from './enabled';
import { issueTestToken } from './test-support-db';

const RUN = `mcp-conn-${Date.now()}`;
let userId: string;
let otherUserId: string;
let wasEnabled: boolean;

beforeAll(async () => {
  wasEnabled = await isMcpEnabled();
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  userId = (await prisma.user.create({ data: { email: `${RUN}-a@example.local`, passwordHash: 'x', firstName: 'A', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'READ' } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `${RUN}-b@example.local`, passwordHash: 'x', firstName: 'B', lastName: RUN, homeOrganizationId: org.id, mcpAccess: 'NONE' } })).id;
});

afterAll(async () => {
  await setMcpEnabled(wasEnabled);
  const ids = [userId, otherUserId];
  await prisma.oauthToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId: { in: ids } } });
  await prisma.oauthClient.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('listConnections / revokeConnection', () => {
  it('führt je Client genau eine Verbindung und blendet widerrufene und abgelaufene aus', async () => {
    await issueTestToken({ userId, namePrefix: `${RUN}-claude` });
    await issueTestToken({ userId, namePrefix: `${RUN}-chatgpt` });
    await issueTestToken({ userId, namePrefix: `${RUN}-alt` });
    await prisma.oauthToken.updateMany({ where: { oauthClient: { name: `${RUN}-alt-client` } }, data: { refreshExpiresAt: new Date(Date.now() - 1000) } });

    const connections = await listConnections(userId);
    expect(connections.map((c) => c.clientName).sort()).toEqual([`${RUN}-chatgpt-client`, `${RUN}-claude-client`]);
    expect(connections[0].connectedAt).toBeInstanceOf(Date);
  });

  it('revokeConnection beendet nur die Verbindung dieses Clients des eigenen Benutzers', async () => {
    const connections = await listConnections(userId);
    const victim = connections.find((c) => c.clientName === `${RUN}-claude-client`)!;

    // Ein anderer Benutzer kann diese Verbindung nicht beenden.
    expect(await revokeConnection(otherUserId, victim.oauthClientId)).toBe(0);
    expect(await listConnections(userId)).toHaveLength(2);

    expect(await revokeConnection(userId, victim.oauthClientId)).toBe(1);
    const after = await listConnections(userId);
    expect(after.map((c) => c.clientName)).toEqual([`${RUN}-chatgpt-client`]);
  });
});

describe('getKiAppsVisibility', () => {
  it('zeigt den Eintrag nur bei eingeschaltetem Schalter und vorhandenem MCP-Recht', async () => {
    await setMcpEnabled(true);
    expect(await getKiAppsVisibility(userId)).toBe(true);
    expect(await getKiAppsVisibility(otherUserId)).toBe(false);
    expect(await getKiAppsVisibility('gibt-es-nicht')).toBe(false);
    await setMcpEnabled(false);
    expect(await getKiAppsVisibility(userId)).toBe(false);
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/connections.db.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Service implementieren**

Create `src/lib/mcp/connections.ts`:

```ts
import { prisma } from '@/lib/db/prisma';
import { isMcpEnabled } from './enabled';
import { revokeTokensOfUser } from './oauth/service';

export interface McpConnection {
  oauthClientId: string;
  clientName: string;
  scope: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
}

/** Eine Verbindung je Client: gültig = nicht widerrufen und Refresh-Token nicht abgelaufen. */
export async function listConnections(userId: string, now: Date = new Date()): Promise<McpConnection[]> {
  const tokens = await prisma.oauthToken.findMany({
    where: { userId, revokedAt: null, refreshExpiresAt: { gt: now } },
    include: { oauthClient: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const byClient = new Map<string, McpConnection>();
  for (const token of tokens) {
    const existing = byClient.get(token.oauthClientId);
    if (!existing) {
      byClient.set(token.oauthClientId, {
        oauthClientId: token.oauthClientId,
        clientName: token.oauthClient.name,
        scope: token.scope,
        connectedAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
      });
    } else {
      if (token.createdAt < existing.connectedAt) existing.connectedAt = token.createdAt;
      if (token.lastUsedAt && (!existing.lastUsedAt || token.lastUsedAt > existing.lastUsedAt)) existing.lastUsedAt = token.lastUsedAt;
    }
  }
  return [...byClient.values()];
}

/** Beendet die Verbindung eines Clients - nur Token des angegebenen Benutzers (nie fremde). Gibt die Anzahl zurück. */
export async function revokeConnection(userId: string, oauthClientId: string): Promise<number> {
  return revokeTokensOfUser(userId, oauthClientId);
}

/** Soll der Menüeintrag "Verbundene KI-Apps" erscheinen? Schalter an UND der Benutzer hat ein MCP-Recht. */
export async function getKiAppsVisibility(userId: string): Promise<boolean> {
  const [enabled, user] = await Promise.all([
    isMcpEnabled(),
    prisma.user.findUnique({ where: { id: userId }, select: { mcpAccess: true } }),
  ]);
  return enabled && !!user && user.mcpAccess !== 'NONE';
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/connections.db.test.ts` → PASS (3 Tests). `npx tsc --noEmit` → keine Fehler.

- [ ] **Step 5: Server Action und Seite**

Create `src/app/(app)/profile/ki-apps/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { revokeConnection } from '@/lib/mcp/connections';

/** Beendet die Verbindung einer KI-App für den angemeldeten Benutzer (nie für andere). */
export async function revokeMyConnection(oauthClientId: string): Promise<void> {
  const user = await requireUser();
  await revokeConnection(user.id, oauthClientId);
  revalidatePath('/profile/ki-apps');
}
```

Create `src/app/(app)/profile/ki-apps/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { listConnections } from '@/lib/mcp/connections';
import { getMcpAccessOf } from '@/lib/mcp/access-db';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { revokeMyConnection } from './actions';

const dateTime = (date: Date) =>
  date.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' });

export default async function KiAppsPage() {
  if (!(await isMcpEnabled())) notFound();
  const user = await requireUser();
  const [access, connections] = await Promise.all([getMcpAccessOf(user.id), listConnections(user.id)]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold text-ink">Verbundene KI-Apps</h1>
      <p className="max-w-[640px] text-[15px] text-ink-muted">
        Hier siehst du, welche KI-Anwendungen (z. B. Claude oder ChatGPT) in deinem Namen auf die Feuerwehr-App zugreifen dürfen.
        Sie sehen nur, was du auch in der App sehen darfst.
      </p>
      {access === 'NONE' && (
        <p className="max-w-[640px] rounded-lg bg-surface p-4 text-sm text-ink shadow-card">
          Dein Konto hat derzeit keinen KI-Zugriff. Bestehende Verbindungen funktionieren nicht mehr.
        </p>
      )}
      {connections.length === 0 ? (
        <p className="max-w-[640px] rounded-lg bg-surface p-4 text-sm text-ink-muted shadow-card">Keine aktiven Verbindungen.</p>
      ) : (
        <ul className="flex max-w-[640px] flex-col gap-2.5">
          {connections.map((connection) => (
            <li key={connection.oauthClientId} className="flex items-center gap-3 rounded-lg bg-surface p-4 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{connection.clientName}</div>
                <div className="text-xs text-ink-muted">
                  Verbunden seit {dateTime(connection.connectedAt)} ·{' '}
                  {connection.lastUsedAt ? `zuletzt benutzt ${dateTime(connection.lastUsedAt)}` : 'noch nicht benutzt'} ·{' '}
                  {connection.scope.includes('mcp:write') ? 'Lesen und Schreiben' : 'Nur Lesen'}
                </div>
              </div>
              <form action={revokeMyConnection.bind(null, connection.oauthClientId)}>
                <button type="submit" className="min-h-11 rounded-md border border-line-strong px-3 text-sm font-semibold text-red-700">
                  Beenden
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Menüeintrag**

In `src/components/layout/profile-menu.tsx`:
- In `interface ProfileMenuProps` nach `canSendAnyNews: boolean;` ergänzen: `showKiApps: boolean;`
- In der Parameterliste der Funktion nach `canSendAnyNews,` ergänzen: `showKiApps,`
- Direkt **nach** dem Block `{canSendAnyNews && ( <div className="mt-4 border-t border-neutral-200 pt-3 sm:hidden"> ... </div> )}` (der "News"-Link) einfügen:

```tsx
          {showKiApps && (
            <div className="mt-4 border-t border-neutral-200 pt-3">
              <Link
                href="/profile/ki-apps"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Verbundene KI-Apps
              </Link>
            </div>
          )}
```

In `src/app/(app)/layout.tsx`:
- Import ergänzen: `import { getKiAppsVisibility } from '@/lib/mcp/connections';`
- Direkt **nach** der Zeile `const verwaltungHref = verwaltungNavItem?.href ?? '/admin/heimatfeuerwehr';` einfügen: `const showKiApps = await getKiAppsVisibility(user.id);`
- Im Aufruf `<ProfileMenu ...>` nach `canSendAnyNews={canSendAnyNews(user)}` ergänzen: `showKiApps={showKiApps}`

- [ ] **Step 7: Prüfen**

Run: `npx tsc --noEmit` und `npm run build` → ohne Fehler; `/profile/ki-apps` steht in der Routenliste.
Sichtprüfung (lokal): Schalter aus → kein Menüeintrag, Seite 404. Schalter an, Benutzer mit `READ`, eine Verbindung aufgebaut (Phase 2/3 Inspector-Ablauf) → Menüeintrag "Verbundene KI-Apps", Seite zeigt die Verbindung, "Beenden" entfernt sie, ein weiterer Aufruf im Inspector scheitert mit 401.

- [ ] **Step 8: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/connections.ts src/lib/mcp/connections.db.test.ts "src/app/(app)/profile/ki-apps" src/components/layout/profile-menu.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: Verbundene KI-Apps im Profil (Anzeige und Beenden)"
```

---

### Task 2: Admin sperrt Verbindungen, Prüfprotokoll-Ansicht

**Files:**
- Modify: `src/app/(app)/admin/benutzer/actions.ts`, `src/components/admin/user-form-sheet.tsx`, `src/app/(app)/admin/mcp/page.tsx`

**Interfaces:**
- Produces: `revokeMcpTokens(userId: string): Promise<{ error?: string; revoked?: number }>` (Server Action der Benutzerverwaltung).

Die Aktion ist eine dünne Hülle um `revokeTokensOfUser` (in Phase 2 mit Test) und `canManageUserRecord` (bestehend); ihre Prüfung ist daher `tsc`/`build` plus Sichtprüfung.

- [ ] **Step 1: Server Action**

In `src/app/(app)/admin/benutzer/actions.ts` den Import ergänzen: `import { revokeTokensOfUser } from '@/lib/mcp/oauth/service';` (die Namen `assertPermission`, `canManageUserRecord`, `prisma`, `requireUser` sind dort bereits importiert) und am Dateiende anfügen:

```ts
/**
 * Sperrt ALLE MCP-Verbindungen (OAuth-Token) eines Benutzers, z. B. bei Verdacht auf Missbrauch. Wer das darf, folgt
 * der Regel für den Datensatz (canManageUserRecord: eigener Verwaltungsbereich und nicht höhere Rechtestufe).
 * Der Benutzer kann sich danach selbst neu verbinden, solange er noch MCP-Recht hat - zum dauerhaften Ausschluss
 * zusätzlich die Stufe auf "Kein" setzen.
 */
export async function revokeMcpTokens(userId: string): Promise<{ error?: string; revoked?: number }> {
  const currentUser = await requireUser();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { error: 'Benutzer wurde nicht gefunden.' };
  }
  assertPermission(canManageUserRecord(currentUser, target));
  const revoked = await revokeTokensOfUser(userId);
  return { revoked };
}
```

- [ ] **Step 2: Schaltfläche im Sheet**

In `src/components/admin/user-form-sheet.tsx` den Import erweitern: in der Zeile `import { createUser, updateUser, deleteUser, sendPasswordResetEmailToUser } from '@/app/(app)/admin/benutzer/actions';` zusätzlich `revokeMcpTokens` aufnehmen.

Im Abschnitt "KI-Zugriff (MCP)" (Phase 1, Task 4) **innerhalb** des Blocks `{canEditMcp && ( <section> ... </section> )}` direkt nach dem schließenden `</div>` der Zeile mit der `SegmentedControl` (also noch innerhalb von `<div className="rounded-lg border border-line">`) einfügen:

```tsx
                      {mode === 'edit' && target && (
                        <div className="flex items-center justify-between gap-3.5 border-t border-line px-3.5 py-3">
                          <div className="text-[13px] text-ink-muted">Beendet alle bestehenden Verbindungen dieses Benutzers sofort.</div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const result = await revokeMcpTokens(target.id);
                                if (result.error) {
                                  toast.error(result.error);
                                  return;
                                }
                                toast.success(result.revoked ? result.revoked + ' Verbindung(en) gesperrt.' : 'Es gab keine aktiven Verbindungen.');
                              })
                            }
                          >
                            Verbindungen sperren
                          </Button>
                        </div>
                      )}
```


- [ ] **Step 3: Prüfprotokoll auf `/admin/mcp`**

In `src/app/(app)/admin/mcp/page.tsx` den Import ergänzen: `import { prisma } from '@/lib/db/prisma';`. Nach `const enabled = await isMcpEnabled();` einfügen:

```tsx
  const [entries, activeConnections] = await Promise.all([
    prisma.mcpAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.oauthToken.count({ where: { revokedAt: null, refreshExpiresAt: { gt: new Date() } } }),
  ]);
```

und im JSX direkt **nach** dem schließenden `</div>` des Containers `flex max-w-[640px] flex-col gap-4` einfügen:

```tsx
      <div className="rounded-lg bg-surface p-4 shadow-card">
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Prüfprotokoll</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Schreibaktionen und abgelehnte Zugriffe der letzten 180 Tage (die letzten 50). Aktive Verbindungen: {activeConnections}.
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-muted">Noch keine Einträge.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pr-3">Zeit</th>
                  <th className="py-2 pr-3">Benutzer</th>
                  <th className="py-2 pr-3">Werkzeug</th>
                  <th className="py-2 pr-3">Ergebnis</th>
                  <th className="py-2">Zusammenfassung</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">
                      {entry.createdAt.toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Vienna' })}
                    </td>
                    <td className="py-2 pr-3">{entry.user ? `${entry.user.lastName} ${entry.user.firstName}` : '–'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{entry.tool}</td>
                    <td className="py-2 pr-3">{entry.outcome === 'OK' ? 'OK' : entry.outcome === 'DENIED' ? 'Abgelehnt' : 'Fehler'}</td>
                    <td className="py-2 text-ink-muted">{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Prüfen**

Run: `npx tsc --noEmit` und `npm run build` → ohne Fehler.
Sichtprüfung: Sheet eines Benutzers mit Verbindung öffnen → "Verbindungen sperren" → Toast "1 Verbindung(en) gesperrt.", der Benutzer sieht in "Verbundene KI-Apps" nichts mehr. Als Feuerwehr-Admin einen Bezirksadmin-Datensatz öffnen: die Aktion wird vom Server abgelehnt (`canManageUserRecord`). `/admin/mcp` zeigt nach einem `create_user`-Aufruf den Eintrag.

- [ ] **Step 5: Commit (nur auf Anweisung)**

```bash
git add "src/app/(app)/admin/benutzer/actions.ts" src/components/admin/user-form-sheet.tsx "src/app/(app)/admin/mcp/page.tsx"
git commit -m "feat: Admin sperrt MCP-Verbindungen eines Benutzers, Prüfprotokoll auf /admin/mcp"
```

---

### Task 3: Aufräumen (Service, Cron, Host-Skript)

**Files:**
- Create: `src/lib/mcp/retention.ts`, `src/app/api/cron/mcp-retention/route.ts`, `docker/mcp-retention.sh`
- Test: `src/lib/mcp/retention.db.test.ts`

**Interfaces:**
- Produces: `AUDIT_RETENTION_DAYS = 180`, `TOKEN_RETENTION_DAYS = 30`, `purgeMcpData(now?: Date): Promise<{ audit: number; tokens: number; codes: number }>`.

- [ ] **Step 1: Failing DB-Test**

Create `src/lib/mcp/retention.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { hashSecret } from './oauth/secrets';
import { purgeMcpData } from './retention';

const RUN = `mcp-ret-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
let userId: string;
let clientRowId: string;

const token = (key: string, data: { revokedAt?: Date | null; refreshExpiresAt: Date }) =>
  prisma.oauthToken.create({
    data: {
      accessTokenHash: hashSecret(`${RUN}-a-${key}`),
      refreshTokenHash: hashSecret(`${RUN}-r-${key}`),
      oauthClientId: clientRowId,
      userId,
      scope: 'mcp:read',
      expiresAt: new Date(Date.now() + DAY),
      refreshExpiresAt: data.refreshExpiresAt,
      revokedAt: data.revokedAt ?? null,
    },
  });

beforeAll(async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { type: 'FEUERWEHR' } });
  userId = (await prisma.user.create({ data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'R', lastName: RUN, homeOrganizationId: org.id } })).id;
  clientRowId = (await prisma.oauthClient.create({ data: { clientId: `mcp_${RUN}`, name: `${RUN}-client`, redirectUris: ['https://claude.ai/cb'] } })).id;
});

afterAll(async () => {
  await prisma.oauthToken.deleteMany({ where: { userId } });
  await prisma.oauthAuthorizationCode.deleteMany({ where: { userId } });
  await prisma.mcpAuditLog.deleteMany({ where: { clientId: RUN } });
  await prisma.oauthClient.deleteMany({ where: { id: clientRowId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('purgeMcpData', () => {
  it('löscht Prüfprotokoll-Einträge älter als 180 Tage, behält jüngere', async () => {
    await prisma.mcpAuditLog.create({ data: { userId, clientId: RUN, tool: 'x', outcome: 'OK', summary: 'alt', createdAt: new Date(Date.now() - 181 * DAY) } });
    await prisma.mcpAuditLog.create({ data: { userId, clientId: RUN, tool: 'x', outcome: 'OK', summary: 'jung', createdAt: new Date(Date.now() - 179 * DAY) } });
    const result = await purgeMcpData();
    expect(result.audit).toBeGreaterThanOrEqual(1);
    const left = await prisma.mcpAuditLog.findMany({ where: { clientId: RUN } });
    expect(left.map((e) => e.summary)).toEqual(['jung']);
  });

  it('löscht Token 30 Tage nach Widerruf oder Ablauf, behält gültige und frisch widerrufene', async () => {
    await token('lange-widerrufen', { refreshExpiresAt: new Date(Date.now() + 10 * DAY), revokedAt: new Date(Date.now() - 31 * DAY) });
    await token('lange-abgelaufen', { refreshExpiresAt: new Date(Date.now() - 31 * DAY) });
    await token('frisch-widerrufen', { refreshExpiresAt: new Date(Date.now() + 10 * DAY), revokedAt: new Date(Date.now() - 1 * DAY) });
    await token('gueltig', { refreshExpiresAt: new Date(Date.now() + 10 * DAY) });
    const result = await purgeMcpData();
    expect(result.tokens).toBeGreaterThanOrEqual(2);
    const left = await prisma.oauthToken.findMany({ where: { userId } });
    expect(left.map((t) => t.accessTokenHash).sort()).toEqual([hashSecret(`${RUN}-a-frisch-widerrufen`), hashSecret(`${RUN}-a-gueltig`)].sort());
  });

  it('löscht Autorisierungscodes einen Tag nach Ablauf', async () => {
    const base = { oauthClientId: clientRowId, userId, redirectUri: 'https://claude.ai/cb', codeChallenge: 'c'.repeat(43), scope: 'mcp:read' };
    await prisma.oauthAuthorizationCode.create({ data: { ...base, codeHash: hashSecret(`${RUN}-c-alt`), expiresAt: new Date(Date.now() - 2 * DAY) } });
    await prisma.oauthAuthorizationCode.create({ data: { ...base, codeHash: hashSecret(`${RUN}-c-neu`), expiresAt: new Date(Date.now() - 60 * 1000) } });
    const result = await purgeMcpData();
    expect(result.codes).toBeGreaterThanOrEqual(1);
    const left = await prisma.oauthAuthorizationCode.findMany({ where: { userId } });
    expect(left.map((c) => c.codeHash)).toEqual([hashSecret(`${RUN}-c-neu`)]);
  });
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/retention.db.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Service implementieren**

Create `src/lib/mcp/retention.ts`:

```ts
import { prisma } from '@/lib/db/prisma';

export const AUDIT_RETENTION_DAYS = 180;
export const TOKEN_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tägliches Aufräumen: Prüfprotokoll nach 180 Tagen; Token 30 Tage nach Widerruf oder Ablauf des Refresh-Tokens
 * (so bleibt eine Wiederverwendung eines ersetzten Refresh-Tokens noch eine Weile erkennbar); Autorisierungscodes
 * (60 Sekunden gültig) einen Tag nach Ablauf.
 */
export async function purgeMcpData(now: Date = new Date()): Promise<{ audit: number; tokens: number; codes: number }> {
  const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS);
  const tokenCutoff = new Date(now.getTime() - TOKEN_RETENTION_DAYS * DAY_MS);
  const codeCutoff = new Date(now.getTime() - DAY_MS);

  const [audit, tokens, codes] = await Promise.all([
    prisma.mcpAuditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    prisma.oauthToken.deleteMany({ where: { OR: [{ revokedAt: { lt: tokenCutoff } }, { refreshExpiresAt: { lt: tokenCutoff } }] } }),
    prisma.oauthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: codeCutoff } } }),
  ]);
  return { audit: audit.count, tokens: tokens.count, codes: codes.count };
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run -c vitest.db.config.ts src/lib/mcp/retention.db.test.ts` → PASS (3 Tests).

- [ ] **Step 5: Cron-Endpunkt**

Create `src/app/api/cron/mcp-retention/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { purgeMcpData } from '@/lib/mcp/retention';

/**
 * Räumt täglich das MCP-Prüfprotokoll (180 Tage), abgelaufene/widerrufene OAuth-Token (30 Tage) und alte
 * Autorisierungscodes auf. Läuft unabhängig vom Funktionsschalter. Gleiches Secret-Muster wie jeder andere Cron.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const providedSecret = new URL(request.url).searchParams.get('secret');
  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await purgeMcpData();
  return NextResponse.json({ ok: true, ...result });
}
```

(`/api/cron` ist in `src/middleware.ts` bereits öffentlich.)

- [ ] **Step 6: Host-Skript**

Das Skript ist eine Kopie von `docker/report-retention.sh` mit anderem Aufruf. **Im Wurzelverzeichnis (bash):**

```bash
cp docker/report-retention.sh docker/mcp-retention.sh
sed -i 's#/api/cron/report-retention#/api/cron/mcp-retention#' docker/mcp-retention.sh
sed -i '2,8d' docker/mcp-retention.sh
```

Der zweite `sed` entfernt den alten Kommentarblock (Zeilen 2–8 von `report-retention.sh`, direkt hinter `#!/bin/sh` und vor `set -eu`). Danach direkt unter der ersten Zeile (`#!/bin/sh`) diesen neuen Kommentar einfügen (Datei bearbeiten, LF-Zeilenenden beibehalten):

```sh
# Triggers the daily MCP cleanup: audit log (180 days), expired/revoked OAuth tokens (30 days) and old
# authorization codes. Works unmodified for either stack - reads AUTH_URL/CRON_SECRET from whichever repo
# checkout's own .env it's run from. Add to crontab on the Hetzner host, daily:
#   15 5 * * * /opt/app-177/docker/mcp-retention.sh >> /var/log/ffapp-mcp-retention.log 2>&1
```

Kontrolle:

```bash
head -n 7 docker/mcp-retention.sh
grep -n "report-retention\|mcp-retention" docker/mcp-retention.sh
```

Erwartung: Zeile 1 `#!/bin/sh`, Zeilen 2–5 der neue Kommentar, Zeile 6 `set -eu`; `report-retention` kommt nirgends mehr vor, und die letzte `curl`-Zeile enthält `/api/cron/mcp-retention?secret=${CRON_SECRET}`.

Danach ausführbar im Repo eintragen und Zeilenenden prüfen (LF):

```bash
git add --chmod=+x docker/mcp-retention.sh
file docker/mcp-retention.sh
git ls-files -s docker/mcp-retention.sh
```

Erwartung: `POSIX shell script ... executable` **ohne** "CRLF", und `git ls-files -s` zeigt `100755`. Falls "CRLF" erscheint: `sed -i 's/\r$//' docker/mcp-retention.sh` und erneut `git add --chmod=+x`.

- [ ] **Step 7: Prüfen**

Run: `npx tsc --noEmit` und `npm run build` → ohne Fehler; `/api/cron/mcp-retention` steht in der Routenliste. Lokal bei laufendem Dev-Server: `curl "http://localhost:3000/api/cron/mcp-retention"` → 401; mit `?secret=<CRON_SECRET aus .env>` → `{"ok":true,"audit":0,"tokens":0,"codes":0}` (das Secret dazu nicht in Chat oder Logs kopieren).

- [ ] **Step 8: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/retention.ts src/lib/mcp/retention.db.test.ts src/app/api/cron/mcp-retention docker/mcp-retention.sh
git commit -m "feat: täglicher Cron zum Aufräumen von MCP-Prüfprotokoll, Token und Codes"
```

---

### Task 4: Dokumentation

**Files:**
- Create: `src/lib/mcp/CLAUDE.md`
- Modify: `CLAUDE.md`, `README.md`, `docker/README.md`

Reine Textänderungen; keine Tests. Danach `npm run build` (unverändert grün).

- [ ] **Step 1: Modul-Dokumentation**

Create `src/lib/mcp/CLAUDE.md`:

```markdown
# CLAUDE.md — MCP-Connector (Claude / ChatGPT)

Diese Datei lädt automatisch, wenn an Dateien unter `src/lib/mcp/` gearbeitet wird. Design: `docs/superpowers/specs/2026-11-12-mcp-connector-design.md`,
Umsetzungspläne: `docs/superpowers/plans/2026-11-12-mcp-connector-phase-*.md`.

## Was es ist

Ein MCP-Server (Model Context Protocol) in der App selbst: `POST /api/mcp` (Streamable HTTP, zustandslos, `@modelcontextprotocol/sdk`)
plus ein kleiner OAuth-2.1-Server (Authorization Code + PKCE S256, Dynamic Client Registration), über den sich Claude und ChatGPT mit dem
normalen App-Login anmelden. Benutzer mit `User.mcpAccess` `READ` oder `WRITE` dürfen ihn nutzen. Alles hängt am Funktionsschalter
`AppSettings.mcpEnabled` (`/admin/mcp`, nur Bezirksadmin); aus = `/api/mcp`, `/oauth/*` und `/.well-known/oauth-*` antworten 404.

## Rechte

- **Datenumfang = App-Rechte.** Jedes Werkzeug (`tools/*.ts`) ruft die bestehenden Rechtefunktionen mit dem `SessionUser` des Token-Inhabers auf
  (`canAccessUserManagementAdmin`, `canManageUsersFor`, `canManageHeimatfeuerwehrFor`, `canViewDroneModule`, `getAllowedDroneGroups`,
  `canViewEvent`). `mcpAccess` schaltet nur den Connector frei, es erweitert nie eine Sichtbarkeit. Neue Werkzeuge: Rechte dort prüfen, nicht hier neu erfinden.
- **`mcpAccess`** (`NONE`/`READ`/`WRITE`, WRITE schließt READ ein). Vergabe in der Benutzerverwaltung über `canGrantMcpAccess` (`lib/auth/permissions.ts`):
  Bezirksadmin immer; Abschnitts-/Feuerwehr-Admin nur im eigenen Verwaltungsbereich und nie über die eigene Stufe hinaus (weder neue noch bisherige Stufe des Ziels).
  Ein fehlendes Formularfeld bedeutet "unverändert", nie `NONE` (`parseMcpAccess` liefert `undefined`).
- **Nie über MCP setzbar:** `isBezirksAdmin`, `isBezirksDrohnenAdmin`, `mcpAccess`, zweite Heimatfeuerwehr. `create_user` baut seine Eingabe explizit aus den erlaubten Feldern (nie `...input`).
- **Bei jeder Anfrage live geprüft** (`auth.ts` `authenticateBearer`): Token gültig, Benutzer aktiv, Stufe = Token-Umfang ∩ aktuelles `mcpAccess`
  (`NONE` → 403). Rechteentzug, Deaktivierung und Widerruf wirken damit sofort.

## OAuth

- Codes und Token nur als SHA-256-Hash. Code 60 s und einmalig (atomar per `updateMany ... usedAt: null`, PKCE wird VOR dem Verbrauch geprüft),
  Access-Token 1 h, Refresh-Token 30 Tage rotierend. Wird ein bereits ersetzter Refresh-Token vorgelegt, werden alle Token des Benutzers für diesen Client widerrufen.
- Nur öffentliche Clients (`token_endpoint_auth_method: none`). Rücksprungadressen: https nur auf `claude.ai`/`chatgpt.com` (`oauth/redirect-uris.ts`), http nur Loopback.
  Eine unbekannte/nicht registrierte Adresse führt NIE zu einer Weiterleitung (Fehlerseite). **Plattformen ändern ihre Adressen - bei `invalid_redirect_uri` die Liste prüfen.**
- `/oauth/authorize` ist die einzige geschützte OAuth-Seite (normaler Login); die Middleware gibt für diesen Pfad die Query als `callbackUrl` mit (`lib/auth/callback-url.ts`).
  Die Anmeldung per E-Mail-Token kehrt nicht dorthin zurück - der Benutzer startet die Verbindung dann einfach neu.
- Issuer/Resource = `AUTH_URL`. `/.well-known/oauth-protected-resource` gibt es auch mit Pfadsuffix `/api/mcp` (RFC 9728), die 401-Antwort von `/api/mcp` verweist darauf.

## Werkzeuge (`tools/`)

Lesen: `list_users`, `get_user`, `get_atemschutz_status`, `list_drone_flights`, `get_drone_readiness`, `list_calendar_events`, `list_organizations`, `list_dienstgrade`.
Schreiben: `create_user` (Stammdaten plus Rollen; Willkommens-Mail immer, Link nie in der Antwort; 20/Stunde; über `createUserCore` in `lib/users/create-user.ts`,
dieselbe Logik wie die Benutzerverwaltung). Jedes Werkzeug ist eine reine Funktion `(ctx, input) => ToolResult` und ohne MCP-Transport testbar. `runTool` (`tools/run.ts`)
macht Mengenbegrenzung (120/min je Token), Fehlerabbildung (deutsche Meldung, nie Stacktrace) und Prüfprotokoll. Listen: höchstens 50 pro Aufruf, `cursor`;
Zeiträume höchstens 366 Tage; Freitexte nur auf Wunsch (`includeDescription`). Neues Werkzeug: Datei in `tools/`, in `tools/index.ts` eintragen, Stufe (`READ`/`WRITE`) am Werkzeug setzen,
Rechtematrix-Test schreiben.

## Betrieb

- Prüfprotokoll (`McpAuditLog`): alle Schreibaktionen und alle abgelehnten Zugriffe; Ansicht auf `/admin/mcp`. Aufräumen täglich über `/api/cron/mcp-retention`
  (`docker/mcp-retention.sh`): Protokoll 180 Tage, Token 30 Tage nach Widerruf/Ablauf, Codes 1 Tag nach Ablauf.
- Jeder Benutzer sieht und beendet seine Verbindungen unter `/profile/ki-apps`; Admins sperren alle Token eines Benutzers im Benutzer-Sheet ("Verbindungen sperren").
- Mengenbegrenzung (`rate-limit.ts`) liegt im Speicher des einen Containers; ein Neustart setzt sie zurück (bewusst akzeptiert).
- Tests: `*.db.test.ts` nur gegen die LOKALE Datenbank (`npm run test:db`); `test-support-db.ts` (`issueTestToken`) erzeugt Token für Tests.
```

- [ ] **Step 2: Wurzel-`CLAUDE.md`**

In `CLAUDE.md` im ersten Hinweis ("Module-specific deep-dive documentation has moved to nested CLAUDE.md files …") nach `News → \`src/lib/push/CLAUDE.md\`,` einfügen: ` MCP-Connector (Claude/ChatGPT) → \`src/lib/mcp/CLAUDE.md\`,`. Im Absatz "Core modules:" nach "**Checkliste Drohnenflug** (…)" einfügen: ` and the **MCP-Connector** for Claude/ChatGPT (\`/api/mcp\` + OAuth, per-user right \`User.mcpAccess\`, behind \`AppSettings.mcpEnabled\`; documented in \`src/lib/mcp/CLAUDE.md\`)`. Im Abschnitt "Stack" nach dem Satz zu `@react-pdf/renderer` ergänzen: ` \`@modelcontextprotocol/sdk\` serves the MCP endpoint (\`src/lib/mcp/server.ts\`, web-standard Streamable-HTTP transport, stateless).`

- [ ] **Step 3: `README.md`**

Im Abschnitt "Module" nach dem Punkt "Native Hüllen (Capacitor)" einfügen:

```markdown
- **MCP-Connector für Claude und ChatGPT** – Benutzer mit dem Recht "KI-Zugriff (MCP)" (Lesen/Schreiben, in der Benutzerverwaltung
  vergeben) können Claude oder ChatGPT mit der App verbinden: Abfragen zu Benutzerverwaltung, Drohnengruppe (Flugbuch,
  90-Tage-Regel, Einsatzbereitschaft), Kalender und Atemschutzstatus sowie (mit "Schreiben") Neuanlage von Benutzern. Die KI sieht nur,
  was der Benutzer auch in der App sehen darf. Anmeldung per OAuth mit dem normalen App-Login, Verbindungen verwaltet jeder unter
  "Verbundene KI-Apps" im Profil; ein-/ausgeschaltet vom Bezirksadmin unter Verwaltung → KI-Zugriff. Prüfprotokoll für Schreibaktionen
  und abgelehnte Zugriffe.
```

Im Tech-Stack-Absatz ergänzen: `· @modelcontextprotocol/sdk (MCP-Endpunkt)`. Im Abschnitt "Deployment" den Klammertext der Cronjobs um `/MCP-Aufräumen` erweitern.

- [ ] **Step 4: `docker/README.md`**

Vor dem Abschnitt `## Docker-Aufräumung (alte Images/Build-Cache)` einfügen:

````markdown
## MCP-Connector (Claude/ChatGPT): Einschalten, Aufräumen

Der Connector ist standardmäßig **aus** (`AppSettings.mcpEnabled = false`): `/api/mcp`, `/oauth/*` und `/.well-known/oauth-*` antworten 404. Einschalten
als Bezirksadmin unter Verwaltung → KI-Zugriff; wer ihn nutzen darf, steht je Benutzer in der Benutzerverwaltung ("KI-Zugriff (MCP)"). Die Migration ist
rein additiv (keine neue Umgebungsvariable, kein Backfill; `mcpAccess` ist überall `NONE`).

**Verbinden:** In Claude unter Einstellungen → Connectors → "Benutzerdefinierten Connector hinzufügen" die URL `https://<Domain>/api/mcp` eintragen (Client-ID und Secret
leer lassen, Claude registriert sich selbst); in ChatGPT im Entwicklermodus einen neuen Connector mit Authentifizierung OAuth anlegen. Scheitert die Registrierung mit
`invalid_redirect_uri`, hat die Plattform ihre Rücksprungadresse geändert: `ALLOWED_HTTPS_HOSTS` in `src/lib/mcp/oauth/redirect-uris.ts` anpassen und deployen.

**Aufräumen (täglich):** `docker/mcp-retention.sh` ruft `/api/cron/mcp-retention` auf (Prüfprotokoll 180 Tage, abgelaufene/widerrufene OAuth-Token 30 Tage, Autorisierungscodes
1 Tag). Nur auf dem Prod-Stack einrichten:

```bash
crontab -e
CRON_TZ=Europe/Vienna
15 5 * * * /opt/app-177/docker/mcp-retention.sh >> /var/log/ffapp-mcp-retention.log 2>&1
```

Das Skript ist im Repo ausführbar getrackt (`git ls-files -s docker/mcp-retention.sh` zeigt `100755`) und hat LF-Zeilenenden; nie mit `bash -x` debuggen (es exportiert alle `.env`-Werte).
Der Job meldet seinen Lauf nicht auf der Status-Seite; ob er läuft, zeigt `tail /var/log/ffapp-mcp-retention.log` (erwartet: `{"ok":true,...}`).
````

- [ ] **Step 5: Prüfen**

Run: `npm run build` → "Compiled successfully". Run: `git status --short` → nur die genannten Dateien (plus `docker/mcp-retention.sh`) sind geändert/neu.

- [ ] **Step 6: Commit (nur auf Anweisung)**

```bash
git add src/lib/mcp/CLAUDE.md CLAUDE.md README.md docker/README.md
git commit -m "docs: MCP-Connector (Modul-CLAUDE.md, README, docker/README)"
```

---

### Task 5: Gesamtabnahme und Einführung

- [ ] **Step 1: Alles grün**

```bash
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

- [ ] **Step 2: Einführung auf DEV (Nutzer führt aus)**

Der Nutzer deployt selbst (`git pull`, dann die DEV-Compose-Zeile aus `docker/README.md`, Abschnitt "Zweiter Stack für eine Test-/Dev-Umgebung"). Migrationen laufen beim Containerstart (`20261112090000_mcp_connector`, rein additiv). Danach: `/admin/mcp` auf DEV einschalten, einem Test-Benutzer `WRITE` geben, Claude/ChatGPT gegen `https://<dev-domain>/api/mcp` verbinden und prüfen: Abfragen aus allen vier Bereichen, `create_user` mit einer Testadresse, "Verbundene KI-Apps" zeigt die Verbindung, "Verbindungen sperren" beendet sie.

- [ ] **Step 3: Vor PROD (Nutzer entscheidet)**

Wie bei jeder Migration: Backup (`docker/backup.sh`), `prisma migrate status` vor dem Deploy (erwartet: nur die MCP-Migration steht aus), nach dem Deploy "Database schema is up to date!". Den Connector auf PROD erst einschalten, wenn DEV mit Claude **und** ChatGPT geprüft ist und die Rücksprungadressen stimmen. Danach die Crontab-Zeile aus `docker/README.md` ("MCP-Connector") auf dem Server eintragen.

## Phase-5-Abnahme

- Jeder Benutzer sieht und beendet seine Verbindungen; Admins sperren alle Token eines Benutzers; `/admin/mcp` zeigt das Prüfprotokoll.
- Der tägliche Cron räumt auf; Dokumentation (Modul-`CLAUDE.md`, `README.md`, `docker/README.md`) beschreibt Einschalten, Verbinden, Betrieb und die bekannten Stolpersteine.
