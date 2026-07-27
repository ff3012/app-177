import { PrismaClient, OrganizationType, MembershipRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// TODO: durch die echten Namen der 9 Feuerwehren im Abschnitt Purkersdorf ersetzen.
const FEUERWEHR_NAMEN = [
  'FF Purkersdorf',
  'FF Musterort 2',
  'FF Musterort 3',
  'FF Musterort 4',
  'FF Musterort 5',
  'FF Musterort 6',
  'FF Musterort 7',
  'FF Musterort 8',
  'FF Musterort 9',
];

const DROHNEN_NAMEN = ['Drohne 1', 'Drohne 2'];

async function main() {
  const abschnittskommando = await prisma.organization.upsert({
    where: { name: 'Abschnittsfeuerwehrkommando Purkersdorf' },
    update: {},
    create: {
      name: 'Abschnittsfeuerwehrkommando Purkersdorf',
      shortName: 'AFKDO Purkersdorf',
      type: OrganizationType.ABSCHNITTSKOMMANDO,
    },
  });

  for (const name of FEUERWEHR_NAMEN) {
    await prisma.organization.upsert({
      where: { name },
      update: {},
      create: {
        name,
        shortName: name.replace(/^FF /, ''),
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
