import { PrismaClient, OrganizationType, MembershipRole } from '@prisma/client';
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
