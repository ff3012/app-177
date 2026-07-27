import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth.edge';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/kalender/ics',
  '/aktivieren',
  '/passwort-vergessen',
  '/passwort-zuruecksetzen',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Nur ein grober Gate hier (edge-taugliche Instanz, kein DB-Zugriff): "ist überhaupt ein Token da".
  // Die feingranulare, DB-aktuelle Rechteprüfung (inkl. deaktivierter Benutzer) passiert in
  // requireUser()/getOptionalUser() via auth.config.ts, die im Node-Runtime laufen.
  if (!req.auth?.user?.id && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt)$).*)'],
};
