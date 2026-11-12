import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { listCalendarEvents } from './calendar';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-cal-${Date.now()}`;
type Org = { id: string; parentId: string | null };
let abschnitt: { id: string };
let foreignAbschnittId: string;
let orgA: Org;
let orgB: Org;
let foreignOrg: Org;
let creatorId: string | undefined;
let sondergruppeId: string | undefined;
let groupA: { id: string };
let groupB: { id: string };

const START = new Date('2030-06-15T10:00:00Z');
const END = new Date('2030-06-15T12:00:00Z');
const ALL_KEYS = [
  'eigen',
  'andere-ff',
  'abschnitt',
  'fremd',
  'fremd-abschnitt',
  'bezirk',
  'drohne-a',
  'drohne-b',
  'drohne-bezirk',
  'drohne-eigene-org',
  'sondergruppe',
  'ausserhalb',
  'ganztag',
  'abend',
];

async function event(key: string, data: Record<string, unknown>) {
  await prisma.event.create({
    data: {
      title: `${RUN} ${key}`,
      startsAt: START,
      endsAt: END,
      createdById: creatorId!,
      organizationId: orgA.id,
      description: `Beschreibung ${key}`,
      ...data,
    } as never,
  });
}

beforeAll(async () => {
  const feuerwehren = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', isActive: true, parentId: { not: null } },
    orderBy: { name: 'asc' },
  });
  if (feuerwehren.length === 0) throw new Error('Testvoraussetzung fehlt: keine Feuerwehren in der lokalen Datenbank (npm run db:seed).');
  orgA = feuerwehren[0];
  const sameAbschnitt = feuerwehren.find((o) => o.id !== orgA.id && o.parentId === orgA.parentId);
  if (!sameAbschnitt) throw new Error('Testvoraussetzung fehlt: zweite Feuerwehr im selben Abschnitt (npm run db:seed).');
  orgB = sameAbschnitt;
  const foreign = feuerwehren.find((o) => o.parentId !== orgA.parentId);
  if (!foreign) throw new Error('Testvoraussetzung fehlt: Feuerwehr in einem anderen Abschnitt (npm run db:seed).');
  foreignOrg = foreign;
  abschnitt = { id: orgA.parentId! };
  foreignAbschnittId = foreignOrg.parentId!;
  const a = await prisma.droneGroup.findFirst({ where: { name: 'AFKDO Purkersdorf' } });
  if (!a) throw new Error('Testvoraussetzung fehlt: Drohnengruppe "AFKDO Purkersdorf" (npm run db:seed).');
  groupA = a;
  const b = await prisma.droneGroup.findFirst({ where: { id: { not: groupA.id } } });
  if (!b) throw new Error('Testvoraussetzung fehlt: zweite Drohnengruppe (npm run db:seed).');
  groupB = b;

  const creator = await prisma.user.create({
    data: { email: `${RUN}@example.local`, passwordHash: 'x', firstName: 'Cal', lastName: RUN, homeOrganizationId: orgA.id },
  });
  creatorId = creator.id;
  const maxSort = await prisma.sondergruppe.aggregate({ _max: { sortOrder: true } });
  const sondergruppe = await prisma.sondergruppe.create({ data: { name: RUN, sortOrder: (maxSort._max.sortOrder ?? 0) + 1000 } });
  sondergruppeId = sondergruppe.id;

  await event('eigen', { organizationId: orgA.id });
  await event('andere-ff', { organizationId: orgB.id });
  await event('abschnitt', { organizationId: orgB.id, isSectionWide: true });
  await event('fremd', { organizationId: foreignOrg.id });
  await event('fremd-abschnitt', { organizationId: foreignOrg.id, isSectionWide: true });
  await event('bezirk', { organizationId: foreignOrg.id, isDistrictWide: true });
  await event('drohne-a', { organizationId: orgB.id, category: 'DROHNENGRUPPE', droneGroupId: groupA.id });
  await event('drohne-b', { organizationId: foreignOrg.id, category: 'DROHNENGRUPPE', droneGroupId: groupB.id });
  await event('drohne-bezirk', { organizationId: foreignOrg.id, category: 'DROHNENGRUPPE', droneGroupId: null });
  // Technisch in der eigenen Feuerwehr/abschnittsweit, aber Drohnengruppe B: Nicht-Mitglieder und Gruppe A dürfen es nie sehen.
  await event('drohne-eigene-org', { organizationId: orgA.id, isSectionWide: true, category: 'DROHNENGRUPPE', droneGroupId: groupB.id });
  await event('sondergruppe', { organizationId: orgA.id, sondergruppeId });
  // Ganztägig am 15.6. (Wiener Mitternacht, 22:00 UTC am Vortag) und ein Abendtermin kurz vor Wiener Mitternacht.
  await event('ganztag', { organizationId: orgA.id, allDay: true, startsAt: new Date('2030-06-14T22:00:00Z'), endsAt: new Date('2030-06-15T21:59:59Z') });
  await event('abend', { organizationId: orgA.id, startsAt: new Date('2030-06-15T21:30:00Z'), endsAt: new Date('2030-06-15T22:30:00Z') });
  await event('ausserhalb', { organizationId: orgA.id, startsAt: new Date('2030-09-15T10:00:00Z'), endsAt: new Date('2030-09-15T12:00:00Z') });
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { title: { startsWith: RUN } } });
  if (sondergruppeId) await prisma.sondergruppe.deleteMany({ where: { id: sondergruppeId } });
  if (creatorId) await prisma.user.deleteMany({ where: { id: creatorId } });
  await prisma.$disconnect();
});

const member = (overrides = {}) =>
  sessionUserFixture({ homeOrganizationId: orgA.id, homeAbschnittOrganizationId: abschnitt.id, ...overrides });
const foreignMember = (overrides = {}) =>
  sessionUserFixture({ homeOrganizationId: foreignOrg.id, homeAbschnittOrganizationId: foreignAbschnittId, ...overrides });

type Item = {
  titel: string;
  datum: string;
  ganztaegig: boolean;
  beginn: string;
  ende: string;
  kategorie: string;
  abschnittsweit: boolean;
  bezirksweit: boolean;
  sondergruppe: string | null;
  drohnengruppe: string | null;
  organisation: string;
  beschreibung?: string | null;
};
type Result = { items: Item[]; nextCursor: string | null };
const call = async (user: ReturnType<typeof sessionUserFixture>, input: Record<string, unknown> = {}) =>
  (await listCalendarEvents.handler({ principal: principalFixture(user) }, { from: '2030-06-01', to: '2030-06-30', ...input })).data as Result;
const titles = (r: Result) =>
  r.items
    .map((i) => i.titel.replace(`${RUN} `, ''))
    .filter((t) => ALL_KEYS.includes(t))
    .sort();

describe('list_calendar_events', () => {
  it('zeigt einem Mitglied eigene Feuerwehr, Abschnitt und Bezirk - nicht fremde Termine und keine Drohnengruppen-Termine', async () => {
    expect(titles(await call(member()))).toEqual(['abend', 'abschnitt', 'bezirk', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('zeigt Mitgliedern eines anderen Abschnitts nur deren Feuerwehr, Abschnitt und den Bezirk', async () => {
    expect(titles(await call(foreignMember()))).toEqual(['bezirk', 'fremd', 'fremd-abschnitt']);
  });

  it('gibt Feuerwehr-, Abschnitts- und Bezirksadmins keine zusätzliche Sicht über die App hinaus', async () => {
    const feuerwehrAdmin = await call(member({ feuerwehrAdminOrgIds: [orgA.id] }));
    expect(titles(feuerwehrAdmin)).toEqual(['abend', 'abschnitt', 'bezirk', 'eigen', 'ganztag', 'sondergruppe']);
    const abschnittsAdmin = await call(member({ abschnittAdminOrgIds: [abschnitt.id], feuerwehrAdminOrgIds: [abschnitt.id, orgA.id, orgB.id] }));
    expect(titles(abschnittsAdmin)).toEqual(['abend', 'abschnitt', 'bezirk', 'eigen', 'ganztag', 'sondergruppe']);
    const bezirksAdmin = await call(member({ isBezirksAdmin: true }));
    expect(titles(bezirksAdmin)).toEqual(['abend', 'abschnitt', 'bezirk', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('zeigt Mitgliedern der Drohnengruppe A deren Termine und bezirksweite, nicht die der Gruppe B', async () => {
    const result = await call(member({ isDrohnengruppeMember: true, droneGroupId: groupA.id, droneGroupRole: 'PILOT' }));
    expect(titles(result)).toEqual(['abend', 'abschnitt', 'bezirk', 'drohne-a', 'drohne-bezirk', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('zeigt Mitgliedern der Drohnengruppe B deren Termine, auch wenn sie technisch an der eigenen Feuerwehr hängen', async () => {
    const result = await call(member({ isDrohnengruppeMember: true, droneGroupId: groupB.id, droneGroupRole: 'ADMIN' }));
    expect(titles(result)).toEqual(['abend', 'abschnitt', 'bezirk', 'drohne-b', 'drohne-bezirk', 'drohne-eigene-org', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('zeigt dem Bezirks-Drohnenadmin ohne Gruppe nur bezirksweite Drohnengruppen-Termine', async () => {
    const result = await call(member({ isBezirksDrohnenAdmin: true }));
    expect(titles(result)).toEqual(['abend', 'abschnitt', 'bezirk', 'drohne-bezirk', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('versteckt Drohnengruppen-Termine vor Nicht-Mitgliedern, auch wenn sie an der eigenen Feuerwehr hängen', async () => {
    const result = await call(member());
    expect(titles(result)).not.toContain('drohne-eigene-org');
    expect(titles(result)).not.toContain('drohne-a');
    expect(titles(result)).not.toContain('drohne-bezirk');
  });

  it('kann die Sicht über organizationId nicht erweitern', async () => {
    expect(titles(await call(member(), { organizationId: foreignOrg.id }))).toEqual(['bezirk']);
    expect(titles(await call(member(), { organizationId: orgB.id }))).toEqual(['abschnitt']);
    expect(titles(await call(member(), { organizationId: orgA.id }))).toEqual(['abend', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('filtert nach Sondergruppe und Zeitraum', async () => {
    expect(titles(await call(member(), { sondergruppeId }))).toEqual(['sondergruppe']);
    expect(titles(await call(member()))).not.toContain('ausserhalb');
    expect(titles(await call(member(), { from: '2030-09-01', to: '2030-09-30' }))).toEqual(['ausserhalb']);
  });

  it('liefert die Felder des Termins', async () => {
    const result = await call(member({ isDrohnengruppeMember: true, droneGroupId: groupA.id, droneGroupRole: 'PILOT' }));
    const find = (key: string) => result.items.find((i) => i.titel === `${RUN} ${key}`)!;
    expect(find('eigen')).toMatchObject({
      datum: '2030-06-15',
      beginn: '2030-06-15T12:00:00+02:00',
      ende: '2030-06-15T14:00:00+02:00',
      kategorie: 'Allgemein',
      abschnittsweit: false,
      bezirksweit: false,
      sondergruppe: null,
      drohnengruppe: null,
    });
    // Ganztägig: Wiener Datum/Offset statt UTC (sonst "14. Juni, 22:00Z").
    expect(find('ganztag')).toMatchObject({ ganztaegig: true, datum: '2030-06-15', beginn: '2030-06-15T00:00:00+02:00', ende: '2030-06-15T23:59:59+02:00' });
    // Abendtermin: 23:30 Wiener Zeit am 15.6., obwohl UTC erst 21:30.
    expect(find('abend')).toMatchObject({ ganztaegig: false, datum: '2030-06-15', beginn: '2030-06-15T23:30:00+02:00', ende: '2030-06-16T00:30:00+02:00' });
    expect(find('bezirk').bezirksweit).toBe(true);
    expect(find('abschnitt').abschnittsweit).toBe(true);
    expect(find('sondergruppe').sondergruppe).toBe(RUN);
    expect(find('drohne-a')).toMatchObject({ kategorie: 'Drohnengruppe' });
    expect(find('drohne-a').drohnengruppe).toBeTruthy();
    expect(find('drohne-bezirk').drohnengruppe).toBeNull();
  });

  it('lässt Beschreibungen nur auf Wunsch zu und kürzt sie', async () => {
    const without = await call(member(), { organizationId: orgA.id });
    expect(without.items.every((i) => !('beschreibung' in i))).toBe(true);
    const withDescription = await call(member(), { includeDescription: true });
    expect(withDescription.items.find((i) => i.titel === `${RUN} eigen`)?.beschreibung).toBe('Beschreibung eigen');

    const long = await prisma.event.create({
      data: {
        title: `${RUN} lang`,
        startsAt: START,
        endsAt: END,
        createdById: creatorId!,
        organizationId: orgA.id,
        description: 'x'.repeat(1500),
      },
    });
    try {
      const result = await call(member(), { includeDescription: true });
      expect(result.items.find((i) => i.titel === `${RUN} lang`)?.beschreibung).toHaveLength(1000);
    } finally {
      await prisma.event.deleteMany({ where: { id: long.id } });
    }

    // Kürzen zerreißt kein Surrogatpaar: 999 Zeichen + 5 Emojis -> 999 + 1 Emoji.
    const emoji = await prisma.event.create({
      data: {
        title: `${RUN} emoji`,
        startsAt: START,
        endsAt: END,
        createdById: creatorId!,
        organizationId: orgA.id,
        description: 'x'.repeat(999) + '😀'.repeat(5),
      },
    });
    try {
      const result = await call(member(), { includeDescription: true });
      const text = result.items.find((i) => i.titel === `${RUN} emoji`)?.beschreibung ?? '';
      expect(Array.from(text)).toHaveLength(1000);
      expect(text.endsWith('😀')).toBe(true);
      expect(/[�-�](?![�-�])|(?<![�-�])[�-�]/.test(text)).toBe(false);
    } finally {
      await prisma.event.deleteMany({ where: { id: emoji.id } });
    }
  });

  it('blättert über Seiten', async () => {
    const first = await call(member(), { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await call(member(), { limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0].titel).not.toBe(first.items[0].titel);

    // Vollständiger Durchlauf mit großen Seiten; die lokale Datenbank kann weitere Termine im Zeitraum enthalten.
    const seen: string[] = [];
    let cursor: string | undefined;
    let finished = false;
    for (let page = 0; page < 1000; page++) {
      const result = await call(member(), { limit: 50, ...(cursor ? { cursor } : {}) });
      seen.push(...result.items.map((i) => i.titel));
      if (!result.nextCursor) {
        finished = true;
        break;
      }
      cursor = result.nextCursor;
    }
    expect(finished).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.map((t) => t.replace(`${RUN} `, '')).filter((t) => ALL_KEYS.includes(t)).sort()).toEqual(['abend', 'abschnitt', 'bezirk', 'eigen', 'ganztag', 'sondergruppe']);
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen', async () => {
    const run = (input: Record<string, unknown>) => listCalendarEvents.handler({ principal: principalFixture(member()) }, input);
    await expect(run({ from: '2028-01-01', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(run({ from: 'morgen', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });
});
