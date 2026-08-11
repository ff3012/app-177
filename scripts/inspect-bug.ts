import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'florian.krebs@feuerwehr.gv.at' },
    include: { memberships: { include: { organization: true } }, homeOrganization: true },
  });

  if (!user) {
    console.log('USER NOT FOUND');
    return;
  }

  console.log('User:', {
    id: user.id,
    email: user.email,
    isBezirksAdmin: user.isBezirksAdmin,
    isActive: user.isActive,
    homeOrg: user.homeOrganization.name,
    homeOrgId: user.homeOrganizationId,
    homeOrgType: user.homeOrganization.type,
  });
  console.log('Memberships:');
  for (const m of user.memberships) {
    console.log('  -', {
      orgId: m.organizationId,
      orgName: m.organization.name,
      orgType: m.organization.type,
      role: m.role,
      parentId: m.organization.parentId,
    });
  }

  const wolfsgraben = await prisma.organization.findMany({ where: { name: { contains: 'Wolfsgraben' } } });
  console.log('Organizations matching "Wolfsgraben":');
  for (const o of wolfsgraben) {
    console.log('  -', { id: o.id, name: o.name, type: o.type, parentId: o.parentId, shortName: o.shortName });
  }
}

main().finally(() => prisma.$disconnect());
