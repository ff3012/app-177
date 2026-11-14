import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getChecklist, searchChecklists } from './checklists';
import { principalFixture, sessionUserFixture } from './test-support';

const RUN = `mcp-chk-${Date.now()}`;
const NOT_FOUND = 'Checkliste wurde nicht gefunden.';

type Group = { id: string; organizationId: string; featureChecklist: boolean };
let group: Group;
let otherGroup: Group;
const original: Record<string, boolean> = {};
let drone: { id: string };
let otherDrone: { id: string };
const ids: Record<string, string> = {};
const checklistIds: Record<string, string> = {};
let flightId: string | null = null;

async function makeUser(key: string, groupId: string | null, role: 'PILOT' | 'ADMIN' = 'PILOT') {
  const org = await prisma.organization.findFirst({ where: { type: 'FEUERWEHR' } });
  if (!org) throw new Error('Testvoraussetzung fehlt: keine Feuerwehr in der lokalen Datenbank (npm run db:seed).');
  const user = await prisma.user.create({
    data: {
      email: `${RUN}-${key}@example.local`,
      passwordHash: 'x',
      firstName: key,
      lastName: RUN,
      homeOrganizationId: org.id,
      ...(groupId ? { droneMembership: { create: { droneGroupId: groupId, role } } } : {}),
    },
  });
  ids[key] = user.id;
}

async function makeChecklist(
  key: string,
  opts: {
    groupId: string;
    createdBy: string;
    submittedBy?: string | null;
    status?: 'DRAFT' | 'SUBMITTED' | 'DISCARDED';
    purpose?: 'EINSATZ' | 'TRAINING';
    area?: string;
    flightAt?: Date;
    pilot?: string | null;
    droneId?: string;
    data?: Record<string, unknown>;
    submittedAt?: Date;
  },
) {
  const status = opts.status ?? 'SUBMITTED';
  const row = await prisma.droneChecklist.create({
    data: {
      droneGroupId: opts.groupId,
      createdById: ids[opts.createdBy],
      submittedById: status === 'SUBMITTED' ? ids[opts.submittedBy ?? opts.createdBy] : null,
      pilotId: opts.pilot === undefined ? ids[opts.createdBy] : opts.pilot ? ids[opts.pilot] : null,
      status,
      flightAt: opts.flightAt ?? new Date('2030-06-15T08:00:00Z'),
      purpose: opts.purpose ?? 'EINSATZ',
      area: opts.area ?? `${RUN} Gebiet ${key}`,
      data: (opts.data ?? { art: opts.purpose === 'TRAINING' ? 'Training' : 'Einsatz', gebiet: `${RUN} Gebiet ${key}` }) as object,
      submittedAt: status === 'SUBMITTED' ? (opts.submittedAt ?? new Date('2030-06-15T12:00:00Z')) : null,
      confirmedAt: status === 'SUBMITTED' ? (opts.submittedAt ?? new Date('2030-06-15T12:00:00Z')) : null,
      discardedAt: status === 'DISCARDED' ? new Date() : null,
      ...(opts.droneId ? { drones: { create: { droneId: opts.droneId } } } : {}),
    },
  });
  checklistIds[key] = row.id;
  return row;
}

beforeAll(async () => {
  const found = await prisma.droneGroup.findFirst({ where: { name: 'AFKDO Purkersdorf' }, select: { id: true, organizationId: true, featureChecklist: true } });
  if (!found) throw new Error('Testvoraussetzung fehlt: Drohnengruppe "AFKDO Purkersdorf" nicht in der lokalen Datenbank (npm run db:seed).');
  group = found;
  // Andere Gruppe an einem ANDEREN Abschnitt: sonst wäre der Abschnittsadmin-Test nicht aussagekräftig.
  const other = await prisma.droneGroup.findFirst({
    where: { organizationId: { not: group.organizationId } },
    select: { id: true, organizationId: true, featureChecklist: true },
  });
  if (!other) throw new Error('Testvoraussetzung fehlt: eine zweite Drohnengruppe an einem anderen Abschnitt in der lokalen Datenbank (npm run db:seed).');
  otherGroup = other;
  // Funktionsschalter merken und für den Test einschalten; afterAll stellt ihn wieder her.
  original[group.id] = group.featureChecklist;
  original[otherGroup.id] = otherGroup.featureChecklist;
  await prisma.droneGroup.updateMany({ where: { id: { in: [group.id, otherGroup.id] } }, data: { featureChecklist: true } });

  drone = await prisma.drone.create({ data: { name: `${RUN}-d`, droneGroupId: group.id } });
  otherDrone = await prisma.drone.create({ data: { name: `${RUN}-d2`, droneGroupId: otherGroup.id } });
  await makeUser('ersteller', group.id);
  await makeUser('abschliesser', group.id);
  await makeUser('kollege', group.id);
  await makeUser('admin', group.id, 'ADMIN');
  await makeUser('fremd', otherGroup.id);
  await makeUser('fremd2', otherGroup.id);
  await makeUser('ohne', null);

  // c1: Ersteller 'ersteller', abgeschlossen von 'abschliesser', Einsatz, mit allen Details.
  await makeChecklist('c1', {
    groupId: group.id,
    createdBy: 'ersteller',
    submittedBy: 'abschliesser',
    area: `${RUN} Wald Nord`,
    droneId: drone.id,
    data: {
      datum: '2030-06-15',
      zeit: '10:00',
      art: 'Einsatz',
      alarmVon: 'Leitstelle X',
      grund: 'Personensuche',
      gebiet: `${RUN} Wald Nord`,
      gemeinde: 'Gemeinde Y',
      drohnen: [drone.id],
      grundlage: 'open',
      openKat: 'A1',
      sicht: 'VLOS',
      hoehe: 50,
      pilot: undefined,
      checks: { p_gesund: true, p_fs: false, b_start: true, n_kam: true },
      kommentar15: 'Kommentar zu 15',
      stellenAuswahl: ['oeamtc'],
      stellen: 'Polizei',
      fluege: [{ akku: 'A1', uVor: '100', uNach: '40', start: '10:05', landung: '10:20', zw: true }],
      n18: 'ok',
      n19: 'tausch',
      n20: 'gereinigt',
      abm: { el: '2030-06-15T09:30:00Z', lst: null },
      anmerkungen: 'Geheime Anmerkung',
      bezugNr: '7',
      bestaetigt: true,
    },
  });
  // Nach dem Anlegen den Piloten/Teamleiter/Helfer/Wechsel (Namen werden aufgelöst) in die Daten schreiben.
  const c1 = await prisma.droneChecklist.findUniqueOrThrow({ where: { id: checklistIds.c1 }, select: { data: true } });
  await prisma.droneChecklist.update({
    where: { id: checklistIds.c1 },
    data: {
      data: {
        ...(c1.data as object),
        pilot: ids.ersteller,
        teamleiter: ids.kollege,
        helfer: [ids.kollege, ids.admin],
        pilotWechsel: [{ zeit: '10:30', pilot: ids.abschliesser, checks: { p_gesund: true }, kommentar17: 'Wechselkommentar' }],
      },
    },
  });
  // c2: von 'kollege' erstellt und abgeschlossen, Training, anderes Datum.
  await makeChecklist('c2', {
    groupId: group.id,
    createdBy: 'kollege',
    purpose: 'TRAINING',
    area: `${RUN} Wiese Süd`,
    flightAt: new Date('2030-06-20T08:00:00Z'),
    submittedAt: new Date('2030-06-20T12:00:00Z'),
    pilot: 'admin',
  });
  // c3: andere Gruppe, von 'fremd' erstellt.
  await makeChecklist('c3', { groupId: otherGroup.id, createdBy: 'fremd', droneId: otherDrone.id, area: `${RUN} Fremdgebiet`, submittedAt: new Date('2030-06-16T12:00:00Z') });
  // Entwurf und verworfene Checkliste des Erstellers in Gruppe A.
  await makeChecklist('draft', { groupId: group.id, createdBy: 'ersteller', status: 'DRAFT' });
  await makeChecklist('discarded', { groupId: group.id, createdBy: 'ersteller', status: 'DISCARDED' });

  // Ein verknüpfter Flug an c1.
  const flight = await prisma.droneFlight.create({
    data: {
      startsAt: new Date('2030-06-15T08:05:00Z'),
      pilotUserId: ids.ersteller,
      registeredById: ids.ersteller,
      location: `${RUN} Flugort`,
      droneId: drone.id,
      purpose: 'EINSATZ',
      checklistId: checklistIds.c1,
    },
  });
  flightId = flight.id;
});

afterAll(async () => {
  // Zuerst den Funktionsschalter zurückstellen: ein fehlschlagendes Aufräumen darf die lokalen Gruppen nie eingeschaltet lassen.
  try {
    for (const [groupId, value] of Object.entries(original)) {
      if (groupId) await prisma.droneGroup.update({ where: { id: groupId }, data: { featureChecklist: value } });
    }
  } finally {
    // Geguardet: nie ein deleteMany-Filter, der undefined sein kann. Reihenfolge wegen der Fremdschlüssel.
    try {
      if (flightId) await prisma.droneFlight.deleteMany({ where: { id: flightId } });
      const cIds = Object.values(checklistIds);
      if (cIds.length > 0) await prisma.droneChecklist.deleteMany({ where: { id: { in: cIds } } });
      const droneIds = [drone?.id, otherDrone?.id].filter((id): id is string => !!id);
      if (droneIds.length > 0) await prisma.drone.deleteMany({ where: { id: { in: droneIds } } });
      const userIds = Object.values(ids);
      if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await prisma.$disconnect();
    }
  }
});

const memberOf = (key: string, groupRef: Group, role: 'PILOT' | 'ADMIN' = 'PILOT') =>
  principalFixture(
    sessionUserFixture({ id: ids[key], isDrohnengruppeMember: true, droneGroupId: groupRef.id, droneGroupRole: role }),
  );
const asAbschnittsadmin = () =>
  principalFixture(
    sessionUserFixture({
      id: ids.fremd2,
      isDrohnengruppeMember: true,
      droneGroupId: otherGroup.id,
      droneGroupRole: 'PILOT',
      abschnittAdminOrgIds: [group.organizationId],
      feuerwehrAdminOrgIds: [group.organizationId],
    }),
  );
const asBezirksadmin = () => principalFixture(sessionUserFixture({ id: ids.ohne, isBezirksAdmin: true }));
const asBezirksDrohnenadmin = () => principalFixture(sessionUserFixture({ id: ids.ohne, isBezirksDrohnenAdmin: true }));

type Item = Record<string, unknown> & { id: string };
type Page = { items: Item[]; nextCursor: string | null };

/** Liest alle Seiten und liefert die Schlüssel (c1, c2, ...) der gefundenen Testchecklisten. */
async function found(principal: ReturnType<typeof asBezirksadmin>, input: Record<string, unknown> = {}): Promise<string[]> {
  const keyById = Object.fromEntries(Object.entries(checklistIds).map(([key, id]) => [id, key]));
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const data = (await searchChecklists.handler({ principal }, { ...input, limit: 50, cursor })).data as Page;
    keys.push(...data.items.map((item) => keyById[item.id]).filter(Boolean));
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
  return keys.sort();
}

describe('search_checklists: Rechtematrix', () => {
  it('Ersteller sieht seine abgeschlossene Checkliste', async () => {
    expect(await found(memberOf('ersteller', group))).toEqual(['c1']);
  });

  it('wer die Checkliste abgeschlossen hat, sieht sie ebenfalls', async () => {
    expect(await found(memberOf('abschliesser', group))).toEqual(['c1']);
  });

  it('ein anderes Gruppenmitglied sieht abgeschlossene Checklisten NICHT (obwohl es Entwürfe sehen würde)', async () => {
    expect(await found(memberOf('kollege', group))).toEqual(['c2']);
    // Gegenprobe: dieselbe Regel wie in der App - der Entwurf des Erstellers wäre für das Mitglied sichtbar, wird aber nie gelistet.
    expect(await found(memberOf('kollege', group))).not.toContain('draft');
    expect(await found(memberOf('kollege', group), { droneGroupId: group.id })).toEqual(['c2']);
  });

  it('Admin der Gruppe sieht alle abgeschlossenen Checklisten der Gruppe, aber nicht die einer anderen', async () => {
    expect(await found(memberOf('admin', group, 'ADMIN'))).toEqual(['c1', 'c2']);
  });

  it('Mitglied einer anderen Gruppe sieht nur die eigenen, nie die der Gruppe A', async () => {
    expect(await found(memberOf('fremd', otherGroup))).toEqual(['c3']);
    expect(await found(memberOf('fremd2', otherGroup))).toEqual([]);
    expect(await found(memberOf('fremd2', otherGroup), { droneGroupId: group.id })).toEqual([]);
  });

  it('Abschnittsadmin des Abschnitts der Gruppe sieht deren Checklisten, nicht die Gruppe anderer Abschnitte', async () => {
    expect(await found(asAbschnittsadmin())).toEqual(['c1', 'c2']);
    expect(await found(asAbschnittsadmin(), { droneGroupId: otherGroup.id })).toEqual([]);
  });

  it('Bezirksadmin und Bezirks-Drohnenadmin sehen alle Gruppen (wie die Checklisten-Verwaltung der App)', async () => {
    expect(await found(asBezirksadmin())).toEqual(['c1', 'c2', 'c3']);
    expect(await found(asBezirksDrohnenadmin())).toEqual(['c1', 'c2', 'c3']);
    expect(await found(asBezirksadmin(), { droneGroupId: otherGroup.id })).toEqual(['c3']);
  });

  it('ohne Drohnenmodul und ohne Admin-Recht wird abgelehnt', async () => {
    await expect(searchChecklists.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, {})).rejects.toMatchObject({ kind: 'denied' });
  });

  it('der Filter droneGroupId erweitert die Sicht nie', async () => {
    expect(await found(memberOf('kollege', group), { droneGroupId: otherGroup.id })).toEqual([]);
    expect(await found(memberOf('ersteller', group), { droneGroupId: otherGroup.id })).toEqual([]);
    expect(await found(memberOf('admin', group, 'ADMIN'), { droneGroupId: otherGroup.id })).toEqual([]);
  });

  it('pilotId erweitert die Sicht nie', async () => {
    // c2 hat 'admin' als Piloten, ist für 'ersteller' aber unsichtbar.
    expect(await found(memberOf('ersteller', group), { pilotId: ids.admin })).toEqual([]);
    expect(await found(memberOf('admin', group, 'ADMIN'), { pilotId: ids.admin })).toEqual(['c2']);
  });

  it('Gruppe ohne Funktionsschalter liefert nichts (auch nicht dem Ersteller oder Admins)', async () => {
    await prisma.droneGroup.update({ where: { id: otherGroup.id }, data: { featureChecklist: false } });
    try {
      expect(await found(memberOf('fremd', otherGroup))).toEqual([]);
      expect(await found(asBezirksadmin())).toEqual(['c1', 'c2']);
      await expect(getChecklist.handler({ principal: asBezirksadmin() }, { checklistId: checklistIds.c3 })).rejects.toMatchObject({ kind: 'invalid', message: NOT_FOUND });
      await expect(getChecklist.handler({ principal: memberOf('fremd', otherGroup) }, { checklistId: checklistIds.c3 })).rejects.toMatchObject({ kind: 'invalid', message: NOT_FOUND });
    } finally {
      await prisma.droneGroup.update({ where: { id: otherGroup.id }, data: { featureChecklist: true } });
    }
  });

  it('Entwürfe und verworfene Checklisten stehen nie in der Liste', async () => {
    const all = await found(asBezirksadmin());
    expect(all).not.toContain('draft');
    expect(all).not.toContain('discarded');
    expect(await found(memberOf('ersteller', group))).toEqual(['c1']);
  });
});

describe('search_checklists: Filter, Suche und Blättern', () => {
  it('filtert nach Art, Pilot und Zeitraum (Wiener Tagesgrenzen)', async () => {
    const admin = asBezirksadmin();
    expect(await found(admin, { art: 'Training' })).toEqual(['c2']);
    expect(await found(admin, { art: 'Einsatz' })).toEqual(['c1', 'c3']);
    expect(await found(admin, { pilotId: ids.admin })).toEqual(['c2']);
    expect(await found(admin, { from: '2030-06-20', to: '2030-06-20' })).toEqual(['c2']);
    expect(await found(admin, { from: '2030-06-15', to: '2030-06-15' })).toEqual(['c1', 'c3']);
    expect(await found(admin, { from: '2030-07-01', to: '2030-07-31' })).toEqual([]);
  });

  it('verlangt einen gültigen Zeitraum von höchstens 366 Tagen, from und to gemeinsam', async () => {
    const principal = asBezirksadmin();
    await expect(searchChecklists.handler({ principal }, { from: '2028-01-01', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(searchChecklists.handler({ principal }, { from: 'kaputt', to: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
    await expect(searchChecklists.handler({ principal }, { from: '2030-01-01' })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('durchsucht das Fluggebiet - immer nur innerhalb der erlaubten Checklisten', async () => {
    expect(await found(asBezirksadmin(), { query: `${RUN} wald NORD` })).toEqual(['c1']);
    expect(await found(asBezirksadmin(), { query: 'Fremdgebiet' })).toEqual(['c3']);
    // Kein Informations-Orakel.
    expect(await found(memberOf('kollege', group), { query: 'Wald Nord' })).toEqual([]);
    expect(await found(memberOf('ersteller', group), { query: 'Fremdgebiet' })).toEqual([]);
  });

  it('blättert ohne Duplikate und ohne Lücken (deterministische Sortierung)', async () => {
    const tie = new Date('2030-06-25T08:00:00Z');
    for (const key of ['t1', 't2', 't3', 't4', 't5']) {
      await makeChecklist(key, { groupId: group.id, createdBy: 'ersteller', flightAt: tie, area: `${RUN} Paging ${key}` });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const data = (await searchChecklists.handler({ principal: memberOf('ersteller', group) }, { query: `${RUN} Paging`, limit: 2, cursor })).data as Page;
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...data.items.map((item) => item.id));
      cursor = data.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual(['t1', 't2', 't3', 't4', 't5'].map((key) => checklistIds[key]).sort());
  });
});

describe('search_checklists: Ausgabe', () => {
  it('liefert Metadaten mit Wiener Zeiten, Namen und Anzahl der verknüpften Flüge - ohne Interna', async () => {
    const data = (await searchChecklists.handler({ principal: asBezirksadmin() }, { query: `${RUN} Wald`, limit: 50 })).data as Page;
    const c1 = data.items.find((item) => item.id === checklistIds.c1)!;
    expect(c1).toEqual({
      id: checklistIds.c1,
      titel: `Einsatz · ${RUN} Wald Nord`,
      droneGroup: { id: group.id, name: 'AFKDO Purkersdorf' },
      flugzeitpunkt: '2030-06-15T10:00:00+02:00',
      datum: '2030-06-15',
      art: 'Einsatz',
      fluggebiet: `${RUN} Wald Nord`,
      pilot: `${RUN} ersteller`,
      ausfueller: `${RUN} ersteller`,
      abgeschlossenVon: `${RUN} abschliesser`,
      abgegebenAm: '2030-06-15T14:00:00+02:00',
      drohnen: [`${RUN}-d`],
      verknuepfteFluege: 1,
      mailVersendet: false,
    });
    expect(JSON.stringify(data)).not.toMatch(/pdfKey|mailError|mailedTo|Geheime Anmerkung/);
  });
});

describe('get_checklist', () => {
  const get = async (principal: ReturnType<typeof asBezirksadmin>, checklistId: string) =>
    (await getChecklist.handler({ principal }, { checklistId })).data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('liefert dem Ersteller alle Felder in lesbarer Form mit Klartext und aufgelösten Namen', async () => {
    const c = await get(memberOf('ersteller', group), checklistIds.c1);
    expect(c).toMatchObject({
      id: checklistIds.c1,
      titel: `Einsatz · ${RUN} Wald Nord`,
      droneGroup: { id: group.id },
      einsatzdaten: {
        flugzeitpunkt: '2030-06-15T10:00:00+02:00',
        art: 'Einsatzflug',
        alarmierungVon: 'Leitstelle X',
        grund: 'Personensuche',
        gemeindegebiet: 'Gemeinde Y',
        drohnen: [`${RUN}-d`],
      },
      grundlage: { grundlage: 'Kategorie OPEN A1', sichtverbindung: 'VLOS', geplanteFlughoeheMeter: 50 },
      team: {
        pilot: `${RUN} ersteller`,
        teamleiter: `${RUN} kollege`,
        helfer: [`${RUN} kollege`, `${RUN} admin`],
      },
      abschluss: { anmerkungen: 'Geheime Anmerkung', bezugNr: '7', bestaetigt: true, abgegebenAm: '2030-06-15T14:00:00+02:00', bestaetigtDurch: `${RUN} abschliesser`, bestaetigtFuerPilot: true },
    });
    expect(c.grundlage.abstaende).toMatchObject({ cvMeter: 5, grbMeter: 55, abstandMenschenansammlungenMeter: 180 });
    expect(c.vorbereitung.zustaendigeStellen).toBe('ÖAMTC, Weitere: Polizei');
    // Kontrollpunkte mit Nummer, Klartext und Erledigt-Status.
    expect(c.vorflugkontrolle.punkte[0]).toEqual({ nummer: '15.1', text: 'Pilot und Team sind gesund und einsatzfähig', erledigt: true });
    expect(c.vorflugkontrolle.punkte[1]).toEqual({ nummer: '15.2', text: 'Fernsteuerung: Akku geladen, Antennen ausgerichtet', erledigt: false });
    expect(c.vorflugkontrolle.punkte).toHaveLength(11);
    expect(c.vorflugkontrolle.kommentarZuOffenenPunkten).toBe('Kommentar zu 15');
    expect(c.betriebskontrolle.punkte[0]).toEqual({ nummer: '17.1', text: 'Start und Abheben ohne Auffälligkeit', erledigt: true });
    expect(c.betriebskontrolle.punkte).toHaveLength(10);
    expect(c.einsatzende.nachkontrolle[0]).toEqual({ nummer: '21.1', text: 'Kamera', erledigt: true });
    expect(c.einsatzende).toMatchObject({ drohne: 'Drohne in Ordnung', akkus: 'Akkutausch erforderlich', zustand: 'Gereinigt' });
    expect(c.einsatzende.abmeldungen).toContainEqual({ stelle: 'Einsatzleiter', zeitpunkt: '2030-06-15T11:30:00+02:00' });
    expect(c.einsatzende.abmeldungen).toContainEqual({ stelle: 'Leitstelle', zeitpunkt: null });
    // Flüge, Akkus und Pilotenwechsel mit aufgelöstem Namen.
    expect(c.fluege.akkuFluege).toEqual([{ akku: 'A1', prozentVor: '100', prozentNach: '40', start: '10:05', landung: '10:20', zwischenkontrolle: true }]);
    expect(c.fluege.pilotenwechsel).toHaveLength(1);
    expect(c.fluege.pilotenwechsel[0]).toMatchObject({ neuerPilot: `${RUN} abschliesser`, zeitpunkt: '10:30', kommentarBetriebskontrolle: 'Wechselkommentar' });
    expect(c.fluege.pilotenwechsel[0].vorflugkontrolle[0]).toMatchObject({ nummer: '15.1', erledigt: true });
    expect(c.fluege.pilotenwechsel[0].vorflugkontrolle[1]).toMatchObject({ nummer: '15.2', erledigt: false });
    expect(JSON.stringify(c)).not.toMatch(/pdfKey|mailError|mailedTo|passwordHash/);
  });

  it('Abschließer, Admin der Gruppe, Abschnittsadmin und Bezirksadmin dürfen lesen', async () => {
    expect((await get(memberOf('abschliesser', group), checklistIds.c1)).id).toBe(checklistIds.c1);
    expect((await get(memberOf('admin', group, 'ADMIN'), checklistIds.c2)).id).toBe(checklistIds.c2);
    expect((await get(asAbschnittsadmin(), checklistIds.c1)).id).toBe(checklistIds.c1);
    expect((await get(asBezirksadmin(), checklistIds.c3)).id).toBe(checklistIds.c3);
  });

  it('antwortet für fremde und unbekannte Checklisten mit demselben Text; nur die fremde wird als DENIED protokolliert', async () => {
    // Ein anderes Gruppenmitglied und ein Mitglied der anderen Gruppe dürfen die abgeschlossene Checkliste nicht lesen.
    await expect(getChecklist.handler({ principal: memberOf('kollege', group) }, { checklistId: checklistIds.c1 })).rejects.toMatchObject({ kind: 'denied', message: NOT_FOUND });
    await expect(getChecklist.handler({ principal: memberOf('fremd', otherGroup) }, { checklistId: checklistIds.c1 })).rejects.toMatchObject({ kind: 'denied', message: NOT_FOUND });
    await expect(getChecklist.handler({ principal: memberOf('admin', group, 'ADMIN') }, { checklistId: checklistIds.c3 })).rejects.toMatchObject({ kind: 'denied', message: NOT_FOUND });
    await expect(getChecklist.handler({ principal: memberOf('kollege', group) }, { checklistId: 'gibt-es-nicht' })).rejects.toMatchObject({ kind: 'invalid', message: NOT_FOUND });
  });

  it('Entwurf und verworfene Checkliste gelten als nicht gefunden - auch für den Ersteller und Admins', async () => {
    for (const key of ['draft', 'discarded']) {
      await expect(getChecklist.handler({ principal: memberOf('ersteller', group) }, { checklistId: checklistIds[key] })).rejects.toMatchObject({ kind: 'invalid', message: NOT_FOUND });
      await expect(getChecklist.handler({ principal: asBezirksadmin() }, { checklistId: checklistIds[key] })).rejects.toMatchObject({ kind: 'invalid', message: NOT_FOUND });
    }
  });

  it('lehnt Benutzer ohne Drohnenmodul und ohne Admin-Recht ab', async () => {
    await expect(
      getChecklist.handler({ principal: principalFixture(sessionUserFixture({ id: ids.ohne })) }, { checklistId: checklistIds.c1 }),
    ).rejects.toMatchObject({ kind: 'denied' });
  });
});
