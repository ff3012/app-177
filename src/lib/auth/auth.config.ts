import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getDummyPasswordHash, verifyPassword } from '@/lib/password';
import { buildSessionUser, findUserWithRelationsByEmail, findUserWithRelationsById } from '@/lib/auth/build-session-user';
import { consumeToken, consumeLoginTokenByShortCode } from '@/lib/auth/tokens';
import { checkLoginThrottle, recordFailedLogin, resetLoginAttempts } from '@/lib/auth/login-throttle';
import type { SessionUser } from '@/types/next-auth';

// Throttle für die "Zuletzt aktiv"-Aktualisierung im jwt()-Callback (siehe dort) - bewusst keine
// Rate-Limit-Grenze wie RESET_RATE_LIMIT_WINDOW_MS, nur ein Mindestabstand zwischen zwei Writes.
const LAST_ACTIVE_THROTTLE_MS = 60 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-Mail', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null;
        }
        const normalizedEmail = email.toLowerCase().trim();

        // Security-Review S1/N1: dies ist die tatsächliche Sicherheitsgrenze, nicht nur die
        // Vorab-Prüfung in login/actions.ts's loginAction. Auth.js stellt mit
        // /api/auth/callback/credentials einen eigenen, öffentlichen Endpunkt bereit, der
        // authorize() direkt aufruft und dabei loginAction/checkLoginThrottle komplett umgeht -
        // ohne die Prüfung hier war die gesamte LoginAttempt-Drosselung über diesen Weg
        // wirkungslos. loginAction's eigener Vorab-Check bleibt zusätzlich bestehen (frühere,
        // freundlichere Fehlermeldung mit Minutenangabe), ist aber ab jetzt nur noch Komfort.
        const throttle = await checkLoginThrottle(normalizedEmail);
        if (throttle.locked) {
          return null;
        }

        const user = await findUserWithRelationsByEmail(normalizedEmail);
        // Always run a real bcrypt.compare, against the user's hash if found or a dummy hash
        // otherwise, so a nonexistent email doesn't return measurably faster (timing/enumeration).
        const hashToCompare = user?.passwordHash ?? (await getDummyPasswordHash());
        const passwordValid = await verifyPassword(password, hashToCompare);

        if (!user || !user.isActive || !passwordValid) {
          await recordFailedLogin(normalizedEmail);
          return null;
        }

        await resetLoginAttempts(normalizedEmail);
        return await buildSessionUser(user);
      },
    }),
    // Zweiter Anmeldeweg neben Passwort: ein per E-Mail verschickter Einmal-Link ODER ein
    // 6-stelliger Code (siehe app/(auth)/login/token/[token] bzw. login/actions.ts -
    // confirmLoginWithToken). Bewusst ein eigener Provider statt eines Zweigs im
    // credentials-Provider oben, damit beide Wege sauber getrennt bleiben. Beide Formen sind
    // dieselbe Anmeldeart (email-token), nur zwei Eingabewege für denselben Token-Datensatz -
    // daher hier zusammengefasst statt eines dritten Providers.
    Credentials({
      id: 'email-token',
      name: 'E-Mail Token',
      credentials: {
        token: { label: 'Token', type: 'text' },
        email: { label: 'E-Mail', type: 'email' },
        shortCode: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const rawToken = credentials?.token;
        const email = credentials?.email;
        const shortCode = credentials?.shortCode;

        let consumedUser: { id: string } | null = null;
        if (typeof rawToken === 'string' && rawToken) {
          // Der lange Token ist selbst die hochentropische Absicherung (SHA-256-Lookup gegen einen
          // 32+ Byte langen Zufallswert) - unbrauchbar für Brute-Force, daher hier bewusst keine
          // E-Mail-Drosselung nötig, analog zur bestehenden Begründung in login/token/[token]/actions.ts.
          consumedUser = await consumeToken(rawToken, TokenPurpose.LOGIN);
        } else if (typeof email === 'string' && email && typeof shortCode === 'string' && shortCode) {
          const normalizedEmail = email.toLowerCase().trim();
          // Security-Review S1/N1: derselbe Bypass wie beim Passwort-Provider oben, hier sogar
          // schärfer - der 6-stellige Code hat nur 10^6 Kombinationen. Ohne diese Prüfung ließ sich
          // /api/auth/callback/email-token direkt und parallel für 000000-999999 aufrufen, ganz ohne
          // die Drosselung aus confirmLoginWithToken zu durchlaufen.
          const throttle = await checkLoginThrottle(normalizedEmail);
          if (throttle.locked) {
            return null;
          }
          consumedUser = await consumeLoginTokenByShortCode(normalizedEmail, shortCode);
          if (!consumedUser) {
            await recordFailedLogin(normalizedEmail);
            return null;
          }
          await resetLoginAttempts(normalizedEmail);
        }
        if (!consumedUser) {
          return null;
        }

        // Beide consume-Funktionen liefern den Benutzer ohne die für buildSessionUser nötigen
        // Relationen (homeOrganization, memberships, droneMembership) - deshalb hier erneut
        // vollständig laden.
        const user = await findUserWithRelationsById(consumedUser.id);
        if (!user || !user.isActive) {
          return null;
        }

        return await buildSessionUser(user);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        Object.assign(token, user as SessionUser);
        // Bei einem frischen Login immer gesetzt, ungethrottelt (ein Login ist ohnehin ein
        // seltenes Ereignis, kein Grund zu drosseln) - Benutzerverwaltung-Brief.md §2: "Zuletzt
        // angemeldet"/"Zuletzt aktiv" im Sheet-Kopf/der Tabelle. Der "kein frischer Login"-Zweig
        // unten aktualisiert denselben Wert zusätzlich (gedrosselt) bei jeder echten Nutzung - siehe
        // dortigen Kommentar. updateMany ohne select, damit der Login-Pfad nicht durch einen
        // zusätzlichen Roundtrip länger wird; ein Fehler hier darf die Anmeldung nie blockieren.
        prisma.user
          .updateMany({ where: { id: (user as SessionUser).id }, data: { lastLoginAt: new Date() } })
          .catch((error) => console.error('lastLoginAt konnte nicht aktualisiert werden:', error));
        return token;
      }

      // Kein frischer Login: Rechte (Rollen, Drohnengruppe, Admin-Mitgliedschaften, isActive) auf jedem
      // Request neu aus der DB laden, statt die beim Login geladenen Claims unbegrenzt weiterzuverwenden.
      // Sonst würde z.B. ein Entzug der Drohnengruppen-Mitgliedschaft erst beim nächsten Login wirksam.
      const userId = token.id as string | undefined;
      if (!userId) {
        return token;
      }

      const dbUser = await findUserWithRelationsById(userId);
      if (!dbUser || !dbUser.isActive) {
        // Benutzer existiert nicht mehr oder wurde deaktiviert: id leeren, damit getOptionalUser()
        // dies als "nicht angemeldet" behandelt, statt die alten (ggf. veralteten) Rechte weiterzureichen.
        token.id = undefined;
        return token;
      }

      Object.assign(token, await buildSessionUser(dbUser));

      // "Zuletzt aktiv" in der Benutzerverwaltung soll echte Nutzung zeigen, nicht nur einen
      // frischen Login - bei der langen Session-/JWT-Gültigkeit (next-auth-Standard) meldet sich
      // ein Benutzer, der die App täglich nutzt, oft monatelang nicht neu an, sodass lastLoginAt
      // sonst ewig auf dem Stand des letzten echten Logins einfriert. Dieser Zweig läuft laut
      // middleware.ts's Matcher auf praktisch jedem Request - ein ungethrotteltes Update hier würde
      // die Schreiblast auf jeden einzelnen Request verdoppeln, daher nur, wenn der vorhandene Wert
      // älter als LAST_ACTIVE_THROTTLE_MS ist (dieselbe "throttlen statt jeden Request schreiben"-
      // Idee wie das bestehende Passwort-Reset-Rate-Limit, nur ohne harte Grenze - hier soll es
      // einfach nicht schneller als nötig aktualisiert werden). Der Spaltenname `lastLoginAt` bleibt
      // unverändert (keine Migration nötig für eine reine Bedeutungserweiterung), auch wenn er jetzt
      // nicht mehr ausschließlich einen Login-Zeitpunkt trägt.
      const lastActiveIsStale =
        !dbUser.lastLoginAt || Date.now() - dbUser.lastLoginAt.getTime() > LAST_ACTIVE_THROTTLE_MS;
      if (lastActiveIsStale) {
        prisma.user
          .updateMany({ where: { id: userId }, data: { lastLoginAt: new Date() } })
          .catch((error) => console.error('lastLoginAt (Zuletzt aktiv) konnte nicht aktualisiert werden:', error));
      }

      return token;
    },
    async session({ session, token }) {
      Object.assign(session.user, token as unknown as SessionUser);
      return session;
    },
  },
});
