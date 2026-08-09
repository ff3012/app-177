import { prisma } from '@/lib/db/prisma';

export interface OrganizationFeatures {
  atemschutz: boolean;
  facebook: boolean;
}

/**
 * Einzige Lesequelle für die beiden Funktions-Flags (Funktionsschalter-Brief.md) - für Server
 * Actions/Routen, die die Organisation noch nicht ohnehin per `select` geladen haben. Seiten, die die
 * Organisation bereits laden (admin/heimatfeuerwehr, meine-feuerwehr, dashboard/[token]), ergänzen
 * stattdessen ihr bestehendes `select` um featureAtemschutz/featureFacebook und lesen direkt - ein
 * zusätzlicher Query-Roundtrip wäre dort unnötig.
 */
export async function getOrganizationFeatures(organizationId: string): Promise<OrganizationFeatures> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { featureAtemschutz: true, featureFacebook: true },
  });
  return { atemschutz: org.featureAtemschutz, facebook: org.featureFacebook };
}
