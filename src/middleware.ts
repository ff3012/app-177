import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth.config';

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

  // token.id wird im jwt()-Callback von auth.config.ts geleert, wenn der Benutzer nicht mehr existiert/aktiv ist.
  if (!req.auth?.user?.id && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt)$).*)'],
};
