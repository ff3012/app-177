import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getReport, searchReports } from './reports';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-rep-${Date.now()}`;
const YEAR = 2999;
// Alle Testberichte liegen im Juni 2030: ein enger Zeitraum hält fremde Zeilen der lokalen Datenbank fern.
const RANGE = { from: '2030-06-01', to: '2030-06-30' };

let orgA: { id: string; parentId: string | null };
let orgA2: { id: string; parentId: string | null };
let orgB: { id: string; parentId: string | null };
let abschnittA: string;
const ids: Record<string, string> = {};
const reportIds: Record<string, string> = {};
let vehicleId: string | null = null;
let number = 0;

async function makeUser(key: string, organizationId: string) {
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      stbNr: '4711',
      homeOrganizationId: organizationId,
    },
  });
  ids[key] = user.id;
}

async function makeReport(
  key: string,
  data: {
    organizationId: string;
    createdBy: string;
    filledBy?: string;
    type?: 'ACTIVITY' | 'EXERCISE' | 'INCIDENT';
    startAt?: Date;
    remark?: string;
    activityOther?: string | null;
    activityKinds?: string[];
    submittedAt?: Date;
    extra?: Record<string, unknown>;
  },
) {
  number += 1;
  const startAt = data.startAt ?? new Date('2030-06-15T08:00:00Z');
  const report = await prisma.report.create({
    data: {
      number,
      year: YEAR,
      type: data.type ?? 'ACTIVITY',
      fireDepartmentId: data.organizationId,
      createdById: ids[data.createdBy],
      filledById: ids[data.filledBy ?? data.createdBy],
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000),
      ownActivity: true,
      activityKinds: data.activityKinds ?? ['ATEMSCHUTZ'],
      activityOther: data.activityOther ?? null,
      remark: data.remark ?? `${RUN} Bemerkung ${key}`,
      submittedAt: data.submittedAt ?? new Date('2030-06-16T09:00:00Z'),
      ...(data.extra ?? {}),
    },
  });
  reportIds[key] = report.id;
  return report;
}

beforeAll(async () => {
  // Zwei Feuerwehren im selben Abschnitt (A, A2) und eine in einem ANDEREN Abschnitt (B): sonst wäre der
  // Abschnittsadmin-Test nicht aussagekräftig.
  const feuerwehren = await prisma.organization.findMany({
    where: { type: 'FEUERWEHR', isActive: true, parentId: { not: null } },
    orderBy: { name: 'asc' },
    select: { id: true, parentId: true },
  });
  const byAbschnitt = new Map<string, { id: string; parentId: string | null }[]>();
  for (const org of feuerwehren) byAbschnitt.set(org.parentId!, [...(byAbschnitt.get(org.parentId!) ?? []), org]);
  const same = [...byAbschnitt.values()].find((list) => list.length >= 2);
  if (!same) throw new Error('Testvoraussetzung fehlt: ein Abschnitt mit mindestens zwei Feuerwehren (npm run db:seed).');
  [orgA, orgA2] = same;
  const other = feuerwehren.find((org) => org.parentId !== orgA.parentId);
  if (!other) throw new Error('Testvoraussetzung fehlt: eine Feuerwehr in einem zweiten Abschnitt (npm run db:seed).');
  orgB = other;
  abschnittA = orgA.parentId!;

  await makeUser('ersteller', orgA.id);
  await makeUser('ausfueller', orgA.id);
  await makeUser('kollege', orgA.id);
  await makeUser('adminA', orgA.id);
  await makeUser('adminB', orgB.id);
  await makeUser('abschnittsadmin', orgA.id);
  await makeUser('bezirksadmin', orgB.id);
  await makeUser('leiter', orgA.id);
  await makeUser('mitglied1', orgA.id);

  const vehicle = await prisma.vehicle.create({
    data: { organizationId: orgA.id, taktischeBezeichnung: `${RUN}-TLF`, kennzeichen: `${RUN}-KZ`, marke: 'M', typ: 'T' },
  });
  vehicleId = vehicle.id;

  // Bericht 1: Ersteller = ersteller, Ausfüller = ausfueller, Feuerwehr A.
  const r1 = await makeReport('r1', {
    organizationId: orgA.id,
    createdBy: 'ersteller',
    filledBy: 'ausfueller',
    remark: `${RUN} Geheime Bemerkung zum Brand`,
    activityOther: `${RUN} Sonstiges`,
    submittedAt: new Date('2030-06-16T09:00:00Z'),
  });
  // Bericht 2: Feuerwehr A, andere Person (kollege hat nichts damit zu tun).
  await makeReport('r2', { organizationId: orgA.id, createdBy: 'adminA', submittedAt: new Date('2030-06-17T09:00:00Z') });
  // Bericht 3: Feuerwehr A2 (selber Abschnitt), anderes Datum.
  await makeReport('r3', {
    organizationId: orgA2.id,
    createdBy: 'adminA',
    startAt: new Date('2030-06-20T08:00:00Z'),
    submittedAt: new Date('2030-06-21T09:00:00Z'),
  });
  // Bericht 4: Feuerwehr B (anderer Abschnitt), Übungsbericht.
  await makeReport('r4', {
    organizationId: orgB.id,
    createdBy: 'adminB',
    type: 'EXERCISE',
    activityKinds: ['UE_FUNKUEBUNG'],
    submittedAt: new Date('2030-06-18T09:00:00Z'),
    extra: {
      uebungsleiterId: ids.leiter,
      uebungsortOrt: `${RUN}-Ortschaft`,
      uebungsziel: `${RUN} Ziel der Übung`,
      uebungslage: 'Lage',
      weitereFeuerwehren: 'FF Nachbar',
      emailError: 'SMTP geheimer-fehlertext',
    },
  });
  // Bericht 5 (Feuerwehr A, vor dem Zeitraum) für den Zeitraumfilter.
  await makeReport('rAlt', {
    organizationId: orgA.id,
    createdBy: 'adminA',
    startAt: new Date('2030-01-10T08:00:00Z'),
    submittedAt: new Date('2030-01-11T09:00:00Z'),
  });
  // Bericht 6: mit Mitglied, Fahrzeug und Mengen (für get_report).
  const rv = await makeReport('rDetail', {
    organizationId: orgA.id,
    createdBy: 'ersteller',
    type: 'ACTIVITY',
    submittedAt: new Date('2030-06-22T09:00:00Z'),
  });
  const reportVehicle = await prisma.reportVehicle.create({ data: { reportId: rv.id, vehicleId: vehicleId!, km: 12 } });
  await prisma.reportMember.create({ data: { reportId: rv.id, userId: ids.mitglied1, funktion: 'FAHRER', reportVehicleId: reportVehicle.id } });
  await prisma.reportMember.create({ data: { reportId: rv.id, userId: ids.ersteller, funktion: 'MANNSCHAFT' } });
  await prisma.reportQuantity.create({ data: { reportId: rv.id, kind: 'MATERIAL', code: 'WASSER', value: 1500 } });
  await prisma.reportQuantity.create({ data: { reportId: rv.id, kind: 'EQUIPMENT', code: 'STROMA_60KVA', value: 2.5 } });
  void r1;
});

afterAll(async () => {
  // Geguardet: nie ein deleteMany-Filter, der undefined sein kann.
  const rIds = Object.values(reportIds);
  if (rIds.length > 0) await prisma.report.deleteMany({ where: { id: { in: rIds } } });
  if (vehicleId) await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  const userIds = Object.values(ids);
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const member = (key: string, overrides: Partial<Parameters<typeof sessionUserFixture>[0]> = {}) =>
  principalFixture(sessionUserFixture({ id: ids[key], homeOrganizationId: orgA.id, ...overrides }));
const asAdminA = () => member('adminA', { feuerwehrAdminOrgIds: [orgA.id] });
const asAdminB = () => member('adminB', { homeOrganizationId: orgB.id, feuerwehrAdminOrgIds: [orgB.id] });
const asAbschnittsadmin = () =>
  member('abschnittsadmin', { abschnittAdminOrgIds: [abschnittA], feuerwehrAdminOrgIds: [abschnittA, orgA.id, orgA2.id] });
const asBezirksadmin = () => member('bezirksadmin', { isBezirksAdmin: true });

type Item = Record<string, unknown> & { id: string };
type Page = { items: Item[]; nextCursor: string | null };

/** Liest alle Seiten und liefert die Schlüssel (r1, r2, ...) der gefundenen Testberichte. */
async function found(principal: ReturnType<typeof member>, input: Record<string, unknown> = {}): Promise<string[]> {
  const keyById = Object.fromEntries(Object.entries(reportIds).map(([key, id]) => [id, key]));
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const data = (await searchReports.handler({ principal }, { ...RANGE, ...input, limit: 50, cursor })).data as Page;
    keys.push(...data.items.map((item) => keyById[item.id]).filter(Boolean));
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return keys.sort();
}

describe('search_reports: Rechtematrix', () => {
  it('Ersteller sieht den eigenen Bericht (und nur eigene)', async () => {
    expect(await found(member('ersteller'))).toEqual(['r1', 'rDetail']);
  });

  it('Ausfüller sieht den Bericht, den er ausgefüllt hat', async () => {
    expect(await found(member('ausfueller'))).toEqual(['r1']);
  });

  it('ein fremdes Mitglied derselben Feuerwehr sieht keinen Bericht', async () => {
    expect(await found(member('kollege'))).toEqual([]);
  });

  it('Feuerwehr-Admin sieht alle Berichte der eigenen Feuerwehr, nicht die einer anderen', async () => {
    // adminA hat r2/r3/rAlt selbst erstellt; r3 liegt in A2 (nicht verwaltet) und ist deshalb nur als Ersteller sichtbar.
    expect(await found(asAdminA(), { fireDepartmentId: orgA.id })).toEqual(['r1', 'r2', 'rDetail']);
    expect(await found(asAdminB())).toEqual(['r4']);
  });

  it('Feuerwehr-Admin ohne eigene Beteiligung sieht fremde Berichte nur in der eigenen Feuerwehr', async () => {
    const adminB = principalFixture(sessionUserFixture({ id: ids.kollege, homeOrganizationId: orgA.id, feuerwehrAdminOrgIds: [orgB.id] }));
    expect(await found(adminB)).toEqual(['r4']);
  });

  it('Abschnittsadmin sieht die Berichte der Feuerwehren des eigenen Abschnitts, nicht die eines anderen', async () => {
    expect(await found(asAbschnittsadmin())).toEqual(['r1', 'r2', 'r3', 'rDetail']);
  });

  it('Bezirksadmin sieht alle', async () => {
    expect(await found(asBezirksadmin())).toEqual(['r1', 'r2', 'r3', 'r4', 'rDetail']);
  });

  it('der Filter fireDepartmentId erweitert die Sicht nie', async () => {
    expect(await found(member('kollege'), { fireDepartmentId: orgA.id })).toEqual([]);
    expect(await found(member('ersteller'), { fireDepartmentId: orgB.id })).toEqual([]);
    expect(await found(asAdminA(), { fireDepartmentId: orgB.id })).toEqual([]);
    expect(await found(asAbschnittsadmin(), { fireDepartmentId: orgB.id })).toEqual([]);
  });
});

describe('search_reports: Filter, Suche und Blättern', () => {
  it('filtert nach Berichtstyp', async () => {
    expect(await found(asBezirksadmin(), { type: 'EXERCISE' })).toEqual(['r4']);
    expect(await found(asBezirksadmin(), { type: 'INCIDENT' })).toEqual([]);
  });

  it('begrenzt den Zeitraum über den Beginn (Wiener Tagesgrenzen)', async () => {
    expect(await found(asBezirksadmin(), { from: '2030-06-20', to: '2030-06-20' })).toEqual(['r3']);
    expect(await found(asBezirksadmin(), { from: '2030-01-01', to: '2030-01-31' })).toEqual(['rAlt']);
    // 2030-06-15T22:30Z ist in Wien bereits der 16. Juni.
    const late = await makeReport('rSpaet', {
      organizationId: orgA.id,
      createdBy: 'ersteller',
      startAt: new Date('2030-06-15T22:30:00Z'),
      submittedAt: new Date('2030-06-23T09:00:00Z'),
    });
    try {
      expect(await found(member('ersteller'), { from: '2030-06-16', to: '2030-06-16' })).toEqual(['rSpaet']);
      const first = (await searchReports.handler({ principal: member('ersteller') }, { from: '2030-06-16', to: '2030-06-16' })).data as Page;
      expect(first.items[0]).toMatchObject({ datum: '2030-06-16', beginn: '2030-06-16T00:30:00+02:00' });
    } finally {
      await prisma.report.deleteMany({ where: { id: late.id } });
      delete reportIds.rSpaet;
    }
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen, from und to gemeinsam', async () => {
    const principal = asBezirksadmin();
    await expect(searchReports.handler({ principal }, { from: '2028-01-01', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(searchReports.handler({ principal }, { from: 'kaputt', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(searchReports.handler({ principal }, { from: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('durchsucht Bemerkung, Sonstiges und Übungsziel/-ort - immer nur innerhalb der erlaubten Berichte', async () => {
    expect(await found(asBezirksadmin(), { query: 'GEHEIME bemerkung' })).toEqual(['r1']);
    expect(await found(asBezirksadmin(), { query: `${RUN} sonstiges` })).toEqual(['r1']);
    expect(await found(asBezirksadmin(), { query: `${RUN}-ortschaft` })).toEqual(['r4']);
    expect(await found(asBezirksadmin(), { query: `${RUN} ziel der` })).toEqual(['r4']);
    // Kein Informations-Orakel: derselbe Suchtext findet für Benutzer ohne Recht an r1/r4 nichts.
    expect(await found(member('kollege'), { query: 'Geheime Bemerkung' })).toEqual([]);
    expect(await found(asAdminA(), { query: `${RUN}-ortschaft` })).toEqual([]);
    expect(await found(member('ersteller'), { query: `${RUN}-ortschaft` })).toEqual([]);
  });

  it('blättert ohne Duplikate und ohne Lücken (deterministische Sortierung)', async () => {
    // Gleicher submittedAt-Zeitpunkt für mehrere Berichte: nur der id-Tiebreaker hält die Seiten stabil.
    const tie = new Date('2030-06-25T09:00:00Z');
    for (const key of ['t1', 't2', 't3', 't4', 't5']) {
      await makeReport(key, { organizationId: orgA.id, createdBy: 'ersteller', submittedAt: tie, remark: `${RUN} Paging ${key}` });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const data = (await searchReports.handler({ principal: member('ersteller') }, { ...RANGE, query: `${RUN} Paging`, limit: 2, cursor })).data as Page;
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...data.items.map((item) => item.id));
      cursor = data.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual(['t1', 't2', 't3', 't4', 't5'].map((key) => reportIds[key]).sort());
  });

  it('neueste zuerst (submittedAt absteigend)', async () => {
    const data = (await searchReports.handler({ principal: asBezirksadmin() }, { ...RANGE, query: RUN, limit: 50 })).data as Page;
    const own = data.items.filter((item) => Object.values(reportIds).includes(item.id));
    const times = own.map((item) => String(item.abgegebenAm));
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('search_reports: Ausgabe', () => {
  it('liefert in der Liste nur Metadaten, keine Freitexte, und keine Fehlertexte oder Interna', async () => {
    const data = (await searchReports.handler({ principal: asBezirksadmin() }, { ...RANGE, query: RUN, limit: 50 })).data as Page;
    const text = JSON.stringify(data);
    expect(text).not.toContain('Geheime Bemerkung');
    expect(text).not.toContain('Ziel der Übung');
    expect(text).not.toContain('geheimer-fehlertext');
    expect(text).not.toMatch(/emailError|pdfKey|remark|bemerkung/i);
    const r1 = data.items.find((item) => item.id === reportIds.r1)!;
    expect(r1).toMatchObject({
      nummer: expect.stringMatching(/^\d+\/2999$/),
      art: 'Tätigkeitsbericht',
      feuerwehr: { id: orgA.id },
      ausfueller: `${RUN} ausfueller`,
      eigeneTaetigkeit: true,
      taetigkeiten: ['Atemschutz', `Sonstige: ${RUN} Sonstiges`],
      anzahlMitglieder: 0,
      mailVersendet: false,
      datum: '2030-06-15',
      beginn: '2030-06-15T10:00:00+02:00',
      ende: '2030-06-15T12:00:00+02:00',
      abgegebenAm: '2030-06-16T11:00:00+02:00',
    });
    const detail = data.items.find((item) => item.id === reportIds.rDetail)!;
    expect(detail.anzahlMitglieder).toBe(2);
  });
});

describe('get_report', () => {
  const get = async (principal: ReturnType<typeof member>, reportId: string) =>
    (await getReport.handler({ principal }, { reportId })).data as Record<string, unknown>;

  it('liefert dem Ersteller alle Details samt Freitexten, Mitgliedern, Fahrzeugen und Mengen', async () => {
    const report = await get(member('ersteller'), reportIds.rDetail);
    expect(report).toMatchObject({
      id: reportIds.rDetail,
      art: 'Tätigkeitsbericht',
      feuerwehr: { id: orgA.id },
      bemerkung: `${RUN} Bemerkung rDetail`,
      ersteller: `${RUN} ersteller`,
      ausfueller: `${RUN} ersteller`,
      taetigkeiten: ['Atemschutz'],
      uebung: null,
      gesamtKilometer: 12,
    });
    expect(report.fahrzeuge).toEqual([{ bezeichnung: `${RUN}-TLF (${RUN}-KZ)`, kilometer: 12 }]);
    expect(report.mitglieder).toEqual([
      { name: `${RUN} ersteller`, funktion: 'Mannschaft', fahrzeug: null },
      { name: `${RUN} mitglied1`, funktion: 'Fahrer', fahrzeug: `${RUN}-TLF (${RUN}-KZ)` },
    ]);
    expect(report.material).toEqual([{ code: 'WASSER', bezeichnung: 'Wasser', menge: 1500, einheit: 'Liter' }]);
    expect(report.geraete).toEqual([{ code: 'STROMA_60KVA', bezeichnung: 'STROMA-60kVA', menge: 2.5, einheit: 'Betriebsstunden' }]);
  });

  it('liefert bei Übungsberichten die Übungsfelder, nie E-Mail-Fehlertexte', async () => {
    const report = await get(asBezirksadmin(), reportIds.r4);
    expect(report.uebung).toMatchObject({
      leiter: `${RUN} leiter`,
      ort: `${RUN}-Ortschaft`,
      ziel: `${RUN} Ziel der Übung`,
      lage: 'Lage',
      weitereFeuerwehren: 'FF Nachbar',
    });
    expect(report.taetigkeiten).toEqual(['Funkübung']);
    expect(JSON.stringify(report)).not.toMatch(/geheimer-fehlertext|emailError|pdfKey|passwordHash/);
  });

  it('Feuerwehr-Admin und Abschnittsadmin sehen Berichte ihres Bereichs, nicht anderer', async () => {
    expect(await get(asAdminA(), reportIds.r1)).toMatchObject({ id: reportIds.r1 });
    expect(await get(asAbschnittsadmin(), reportIds.r3)).toMatchObject({ id: reportIds.r3 });
    await expect(getReport.handler({ principal: asAdminA() }, { reportId: reportIds.r4 })).rejects.toMatchObject({ kind: 'denied' });
    await expect(getReport.handler({ principal: asAbschnittsadmin() }, { reportId: reportIds.r4 })).rejects.toMatchObject({ kind: 'denied' });
  });

  it('antwortet für fremde und unbekannte Berichte mit demselben Text; nur der fremde wird als DENIED protokolliert', async () => {
    await expect(getReport.handler({ principal: member('kollege') }, { reportId: reportIds.r1 })).rejects.toMatchObject({
      kind: 'denied',
      message: 'Bericht wurde nicht gefunden.',
    });
    await expect(getReport.handler({ principal: member('kollege') }, { reportId: 'gibt-es-nicht' })).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Bericht wurde nicht gefunden.',
    });
  });
});
