import type { DefaultSession } from 'next-auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  homeOrganizationId: string;
  homeOrganizationType: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  // Der Abschnitt (Organization.id vom Typ ABSCHNITTSKOMMANDO), dem homeOrganization angehört - bei
  // homeOrganizationType === ABSCHNITTSKOMMANDO ist das homeOrganizationId selbst, sonst deren parentId.
  homeAbschnittOrganizationId: string;
  // Enthält jetzt sowohl direkte Feuerwehr-Admin-Mitgliedschaften ALS AUCH jede Feuerwehr unter einem
  // Abschnitt aus abschnittAdminOrgIds (siehe build-session-user.ts) - jede bestehende Prüfung, die
  // dieses Array liest, profitiert automatisch von der Abschnitts-Vererbung ohne eigene Änderung.
  feuerwehrAdminOrgIds: string[];
  abschnittAdminOrgIds: string[];
  isBezirksAdmin: boolean;
  isAbschnittskommandoMitglied: boolean;
  isDrohnengruppeMember: boolean;
  droneGroupId: string | null;
  droneGroupRole: 'PILOT' | 'VIEWER' | 'ADMIN' | null;
}

declare module 'next-auth' {
  interface Session {
    user: SessionUser & DefaultSession['user'];
  }

  interface User extends SessionUser {}
}

declare module 'next-auth/jwt' {
  interface JWT extends SessionUser {}
}
