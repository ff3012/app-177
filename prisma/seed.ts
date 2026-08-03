import { PrismaClient, OrganizationType, MembershipRole, DienstgradKategorie } from '@prisma/client';
import bcrypt from 'bcryptjs';

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
];

async function main() {
  const abschnittskommando = await prisma.organization.upsert({
    where: { name: 'Abschnittsfeuerwehrkommando Purkersdorf' },
    update: { nummer: '17700' },
    create: {
      name: 'Abschnittsfeuerwehrkommando Purkersdorf',
      shortName: 'AFKDO Purkersdorf',
      nummer: '17700',
      type: OrganizationType.ABSCHNITTSKOMMANDO,
    },
  });

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

  for (const [index, name] of DROHNEN_NAMEN.entries()) {
    await prisma.drone.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index },
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
