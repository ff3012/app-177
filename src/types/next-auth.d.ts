import type { DefaultSession } from 'next-auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  homeOrganizationId: string;
  homeOrganizationType: 'FEUERWEHR' | 'ABSCHNITTSKOMMANDO';
  feuerwehrAdminOrgIds: string[];
  isAbschnittsAdmin: boolean;
  isAbschnittskommandoMitglied: boolean;
  isDrohnengruppeMember: boolean;
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
