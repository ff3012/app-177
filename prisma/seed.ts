import { PrismaClient, OrganizationType, MembershipRole, DienstgradKategorie } from '@prisma/client';
import bcrypt from 'bcryptjs';
import feuerwehrenData from './data/feuerwehren-bezirk-17-raw.json';

const prisma = new PrismaClient();

// Niederösterreichische Landesfeuerwehr-Nummerierung - dieselben Werte, die auch die Backfill-
// UPDATEs in der Migration 20260810090000_organization_nummer für bestehende Datenbanken setzen.
// Referenziert von zukünftigen Modulen über Organization.nummer, siehe schema.prisma.
const FEUERWEHR_NAMEN: { name: string; nummer: string }[] = [
  { name: 'FF Wolfsgraben', nummer: '17711' },
  { name: 'FF Pressbaum', nummer: '17703' },
  { name: 'FF Purkersdorf', nummer: '17704' },
  { name: 'FF Gablitz', nummer: '17701' },
  { name: 'FF Tullnerbach', nummer: '17708' },
  { name: 'FF Tullnerbach-Irenental', nummer: '17709' },
  { name: 'FF Steinbach', nummer: '17707' },
  { name: 'FF Mauerbach', nummer: '17702' },
  { name: 'FF Rekawinkel', nummer: '17706' },
];

const DROHNEN_NAMEN = ['Drohne 1', 'Drohne 2'];

// Die 7 Abschnitte des Bezirks 17 St. Pölten - Nummer und Name exakt wie in AFK_NUMMER/AFK_NAME der
// Quelldatei (prisma/data/feuerwehren-bezirk-17-raw.json), damit der spätere Join eindeutig ist.
// Purkersdorf (177) ist NICHT in dieser Liste - die bestehende Organization-Zeile dafür existiert
// bereits (siehe main() unten, sie bekommt nur districtId ergänzt statt neu angelegt zu werden).
const NEUE_ABSCHNITTE: { nummer: string; name: string }[] = [
  { nummer: '171', name: 'Herzogenburg' },
  { nummer: '172', name: 'Kirchberg/Pielach' },
  { nummer: '173', name: 'Neulengbach' },
  { nummer: '174', name: 'St.Pölten - West' },
  { nummer: '175', name: 'St.Pölten-Stadt' },
  { nummer: '176', name: 'St.Pölten - Ost' },
];

// Die 4 Drohnengruppen (die 4. - "AFKDO Purkersdorf" - existiert bereits seit der Backfill-Migration,
// siehe Task 2) - Zuordnung zu ihrem Abschnitt anhand der realen Excel-Daten bestätigt (siehe
// docs/superpowers/specs/2026-08-09-bezirk-abschnitt-drohnengruppen-design.md §3.3), nicht geraten.
const NEUE_DROHNENGRUPPEN: { name: string; abschnittNummer: string }[] = [
  { name: 'AFKDO Kirchberg', abschnittNummer: '172' },
  { name: 'Feuerwehr Hafnerbach', abschnittNummer: '174' },
  { name: 'Spar BTF', abschnittNummer: '175' },
];

// Zentrale Dienstgrad-Tabelle laut NÖ-Landesfeuerwehrverband-Dienstgradordnung (recherchiert
// gegen Wikipedia/AustriaWiki "Dienstgrade der Feuerwehr in Österreich", NÖ-spezifischer
// Abschnitt, mit dem App-Eigentümer abgestimmter Umfang: volle Liste inkl. Verwaltungs-/
// Sachbearbeiter-/Sonderdienstgrade sowie die Ehrendienstgrade für pensionierte Offiziere).
// sortOrder trägt die fachliche Rangordnung innerhalb jeder Kategorie, nicht nur Alphabet -
// niedrigster Dienstgrad zuerst.
const DIENSTGRADE: {
  kurzform: string;
  bezeichnung: string;
  kategorie: DienstgradKategorie;
  sortOrder: number;
}[] = [
  // Mannschaftsdienstgrade
  { kurzform: 'PFM', bezeichnung: 'Probefeuerwehrmann', kategorie: DienstgradKategorie.MANNSCHAFT, sortOrder: 10 },
  { kurzform: 'FM', bezeichnung: 'Feuerwehrmann', kategorie: DienstgradKategorie.MANNSCHAFT, sortOrder: 20 },
  { kurzform: 'OFM', bezeichnung: 'Oberfeuerwehrmann', kategorie: DienstgradKategorie.MANNSCHAFT, sortOrder: 30 },
  { kurzform: 'HFM', bezeichnung: 'Hauptfeuerwehrmann', kategorie: DienstgradKategorie.MANNSCHAFT, sortOrder: 40 },
  // Chargen, Fachchargen und Gehilfen
  { kurzform: 'LM', bezeichnung: 'Löschmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 50 },
  { kurzform: 'OLM', bezeichnung: 'Oberlöschmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 60 },
  { kurzform: 'HLM', bezeichnung: 'Hauptlöschmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 70 },
  { kurzform: 'BM', bezeichnung: 'Brandmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 80 },
  { kurzform: 'OBM', bezeichnung: 'Oberbrandmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 90 },
  { kurzform: 'HBM', bezeichnung: 'Hauptbrandmeister', kategorie: DienstgradKategorie.CHARGE, sortOrder: 100 },
  // Offiziersdienstgrade (Kommandantendienstgrade)
  { kurzform: 'BI', bezeichnung: 'Brandinspektor', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 110 },
  { kurzform: 'OBI', bezeichnung: 'Oberbrandinspektor', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 120 },
  { kurzform: 'HBI', bezeichnung: 'Hauptbrandinspektor', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 130 },
  { kurzform: 'ABI', bezeichnung: 'Abschnittsbrandinspektor', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 140 },
  { kurzform: 'BR', bezeichnung: 'Brandrat', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 150 },
  { kurzform: 'OBR', bezeichnung: 'Oberbrandrat', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 160 },
  { kurzform: 'LFR', bezeichnung: 'Landesfeuerwehrrat', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 170 },
  {
    kurzform: 'LBD-Stv',
    bezeichnung: 'Landesbranddirektor-Stellvertreter',
    kategorie: DienstgradKategorie.OFFIZIER,
    sortOrder: 180,
  },
  { kurzform: 'LBD', bezeichnung: 'Landesbranddirektor', kategorie: DienstgradKategorie.OFFIZIER, sortOrder: 190 },
  // Verwaltungsdienstgrade
  { kurzform: 'VM', bezeichnung: 'Verwaltungsmeister', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 200 },
  {
    kurzform: 'OVM',
    bezeichnung: 'Oberverwaltungsmeister',
    kategorie: DienstgradKategorie.VERWALTUNG,
    sortOrder: 210,
  },
  {
    kurzform: 'HVM',
    bezeichnung: 'Hauptverwaltungsmeister',
    kategorie: DienstgradKategorie.VERWALTUNG,
    sortOrder: 220,
  },
  { kurzform: 'V', bezeichnung: 'Verwalter', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 230 },
  { kurzform: 'OV', bezeichnung: 'Oberverwalter', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 240 },
  { kurzform: 'HV', bezeichnung: 'Hauptverwalter', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 250 },
  { kurzform: 'VI', bezeichnung: 'Verwaltungsinspektor', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 260 },
  { kurzform: 'VR', bezeichnung: 'Verwaltungsrat', kategorie: DienstgradKategorie.VERWALTUNG, sortOrder: 270 },
  // Sachbearbeiter-Dienstgrade
  {
    kurzform: 'SB',
    bezeichnung: 'Sachbearbeiter',
    kategorie: DienstgradKategorie.SACHBEARBEITER,
    sortOrder: 280,
  },
  {
    kurzform: 'ASB',
    bezeichnung: 'Abschnittssachbearbeiter',
    kategorie: DienstgradKategorie.SACHBEARBEITER,
    sortOrder: 290,
  },
  {
    kurzform: 'BSB',
    bezeichnung: 'Bezirkssachbearbeiter',
    kategorie: DienstgradKategorie.SACHBEARBEITER,
    sortOrder: 300,
  },
  // Sonderdienstgrade
  {
    kurzform: 'FT',
    bezeichnung: 'Feuerwehrtechniker',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 310,
  },
  { kurzform: 'FARZT', bezeichnung: 'Feuerwehrarzt', kategorie: DienstgradKategorie.SONDERDIENSTGRAD, sortOrder: 320 },
  {
    kurzform: 'FJUR',
    bezeichnung: 'Feuerwehrjurist',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 330,
  },
  {
    kurzform: 'FKUR',
    bezeichnung: 'Feuerwehrkurat',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 340,
  },
  {
    kurzform: 'BFARZT',
    bezeichnung: 'Bezirksfeuerwehrarzt',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 350,
  },
  {
    kurzform: 'BFJUR',
    bezeichnung: 'Bezirksfeuerwehrjurist',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 360,
  },
  {
    kurzform: 'BFKUR',
    bezeichnung: 'Bezirksfeuerwehrkurat',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 370,
  },
  {
    kurzform: 'LFARZT',
    bezeichnung: 'Landesfeuerwehrarzt',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 380,
  },
  {
    kurzform: 'LFJUR',
    bezeichnung: 'Landesfeuerwehrjurist',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 390,
  },
  {
    kurzform: 'LFKUR',
    bezeichnung: 'Landesfeuerwehrkurat',
    kategorie: DienstgradKategorie.SONDERDIENSTGRAD,
    sortOrder: 400,
  },
  // Ehrendienstgrade (pensionierte Offiziere, behalten den Titel mit "Ehren-"-Präfix)
  {
    kurzform: 'EBI',
    bezeichnung: 'Ehrenbrandinspektor',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 410,
  },
  {
    kurzform: 'EOBI',
    bezeichnung: 'Ehren-Oberbrandinspektor',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 420,
  },
  {
    kurzform: 'EHBI',
    bezeichnung: 'Ehren-Hauptbrandinspektor',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 430,
  },
  {
    kurzform: 'EABI',
    bezeichnung: 'Ehren-Abschnittsbrandinspektor',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 440,
  },
  { kurzform: 'EBR', bezeichnung: 'Ehrenbrandrat', kategorie: DienstgradKategorie.EHRENDIENSTGRAD, sortOrder: 450 },
  {
    kurzform: 'EOBR',
    bezeichnung: 'Ehren-Oberbrandrat',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 460,
  },
  {
    kurzform: 'EOV',
    bezeichnung: 'Ehren-Oberverwalter',
    kategorie: DienstgradKategorie.EHRENDIENSTGRAD,
    sortOrder: 470,
  },
];

/**
 * Legt die 6 neuen Abschnitte (171-176) und alle 124 Feuerwehren/BTF aus der Excel-Quelldatei an.
 * Abschnitt 177 (Purkersdorf) existiert bereits (siehe main()) und wird hier übersprungen - seine 9
 * Feuerwehren werden trotzdem per nummer-Match aktualisiert (parentId ergänzt), nicht dupliziert. Die
 * Excel-Daten (AFK_NUMMER/AFK_NAME) haben keine eigene Abschnittskommando-nummer (nur Feuerwehren haben
 * eine) - die hier konstruierte nummer folgt der bereits an Purkersdorf sichtbaren Konvention
 * ({Abschnittsnummer}00, z. B. Purkersdorfs bestehende '17700'). Gibt eine Map von AFK_NUMMER ->
 * Organization.id zurück, die seedDrohnengruppen für die Abschnitts-Verankerung nutzt.
 */
async function seedAbschnitteUndFeuerwehren(purkersdorfOrgId: string): Promise<Map<string, string>> {
  const district = await prisma.district.findUniqueOrThrow({ where: { number: '17' } });

  const abschnittIdByNummer = new Map<string, string>([['177', purkersdorfOrgId]]);

  for (const { nummer, name } of NEUE_ABSCHNITTE) {
    const orgName = `Abschnittsfeuerwehrkommando ${name}`;
    const org = await prisma.organization.upsert({
      where: { name: orgName },
      update: { districtId: district.id },
      create: {
        name: orgName,
        shortName: `AFKDO ${name}`,
        nummer: `${nummer}00`,
        type: OrganizationType.ABSCHNITTSKOMMANDO,
        districtId: district.id,
      },
    });
    abschnittIdByNummer.set(nummer, org.id);
  }

  const rows = feuerwehrenData.rows as {
    AFK_NUMMER: string;
    FW_ART: string;
    FW_NAME: string;
    FW_NUMMER: string;
  }[];

  for (const row of rows) {
    const parentId = abschnittIdByNummer.get(row.AFK_NUMMER);
    if (!parentId) continue;
    const name = row.FW_ART === 'BTF' ? row.FW_NAME : `FF ${row.FW_NAME}`;
    await prisma.organization.upsert({
      where: { nummer: row.FW_NUMMER },
      update: { parentId },
      create: {
        name,
        shortName: row.FW_NAME,
        nummer: row.FW_NUMMER,
        type: OrganizationType.FEUERWEHR,
        parentId,
      },
    });
  }

  return abschnittIdByNummer;
}

/** Legt die 3 neuen Drohnengruppen an (die 4. existiert bereits seit der Backfill-Migration). */
async function seedDrohnengruppen(abschnittIdByNummer: Map<string, string>): Promise<void> {
  for (const { name, abschnittNummer } of NEUE_DROHNENGRUPPEN) {
    const organizationId = abschnittIdByNummer.get(abschnittNummer);
    if (!organizationId) {
      throw new Error(`Abschnitt ${abschnittNummer} für Drohnengruppe "${name}" nicht gefunden.`);
    }
    await prisma.droneGroup.upsert({
      where: { name },
      update: { organizationId },
      create: { name, organizationId },
    });
  }
}

async function main() {
  // Der Bezirk selbst wird von der Migration 20260809010000_hierarchie_backfill angelegt, nicht hier -
  // deshalb nur gelesen. Purkersdorf braucht die districtId genauso wie die 6 neuen Abschnitte: auf
  // einer frisch migrierten Datenbank setzt die Migration sie zwar bereits, auf einer per
  // `migrate deploy` + `db:seed` von Null aufgebauten Datenbank legt aber dieser Upsert die Zeile an -
  // ohne districtId wäre Purkersdorf der einzige Abschnitt ohne Bezirk.
  const district = await prisma.district.findUniqueOrThrow({ where: { number: '17' } });

  const abschnittskommando = await prisma.organization.upsert({
    where: { name: 'Abschnittsfeuerwehrkommando Purkersdorf' },
    update: { nummer: '17700', districtId: district.id },
    create: {
      name: 'Abschnittsfeuerwehrkommando Purkersdorf',
      shortName: 'AFKDO Purkersdorf',
      nummer: '17700',
      type: OrganizationType.ABSCHNITTSKOMMANDO,
      districtId: district.id,
    },
  });

  const { id: purkersdorfOrgId } = abschnittskommando;
  const abschnittIdByNummer = await seedAbschnitteUndFeuerwehren(purkersdorfOrgId);
  await seedDrohnengruppen(abschnittIdByNummer);

  for (const { name, nummer } of FEUERWEHR_NAMEN) {
    await prisma.organization.upsert({
      where: { name },
      update: { nummer },
      create: {
        name,
        shortName: name.replace(/^FF /, ''),
        nummer,
        type: OrganizationType.FEUERWEHR,
      },
    });
  }

  // Die Drohnengruppe "AFKDO Purkersdorf" - die 4. der 4 Drohnengruppen im Bezirk, die anderen 3
  // werden oben bereits über seedDrohnengruppen() angelegt (siehe Task 3). Dieser Upsert bleibt hier
  // bestehen (statt in NEUE_DROHNENGRUPPEN aufzugehen), weil er an abschnittskommando.id hängt, das
  // an dieser Stelle im Code bereits vorliegt, und weil Drone.droneGroupId (seit Task 2 verpflichtend)
  // hier einen gültigen Wert braucht.
  const droneGroup = await prisma.droneGroup.upsert({
    where: { name: 'AFKDO Purkersdorf' },
    update: {},
    create: { name: 'AFKDO Purkersdorf', organizationId: abschnittskommando.id },
  });

  for (const [index, name] of DROHNEN_NAMEN.entries()) {
    // Eindeutigkeit ist seit Task 9 (Review-Fix) PRO Gruppe (Drone.@@unique([droneGroupId, name])),
    // nicht mehr global - der Upsert-Schlüssel muss deshalb beide Felder tragen.
    await prisma.drone.upsert({
      where: { droneGroupId_name: { droneGroupId: droneGroup.id, name } },
      update: {},
      create: { name, sortOrder: index, droneGroupId: droneGroup.id },
    });
  }

  for (const { kurzform, bezeichnung, kategorie, sortOrder } of DIENSTGRADE) {
    await prisma.dienstgrad.upsert({
      where: { kurzform },
      update: { bezeichnung, kategorie, sortOrder },
      create: { kurzform, bezeichnung, kategorie, sortOrder },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@abschnitt-purkersdorf.at';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-after-first-login';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      firstName: 'Abschnitt',
      lastName: 'Admin',
      homeOrganizationId: abschnittskommando.id,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId_role: {
        userId: admin.id,
        organizationId: abschnittskommando.id,
        role: MembershipRole.ADMIN,
      },
    },
    update: {},
    create: {
      userId: admin.id,
      organizationId: abschnittskommando.id,
      role: MembershipRole.ADMIN,
    },
  });

  await prisma.user.update({
    where: { id: admin.id },
    data: { isBezirksAdmin: true },
  });

  console.log(`Seed abgeschlossen. Bootstrap-Admin: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
