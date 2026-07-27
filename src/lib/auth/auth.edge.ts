import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

/**
 * Edge-taugliche NextAuth-Instanz NUR für middleware.ts. Next.js-Middleware läuft im Edge-Runtime,
 * in dem Prisma nicht funktioniert ("PrismaClientValidationError: ... edge runtime"). Diese Instanz
 * teilt sich per AUTH_SECRET denselben JWT wie die volle Konfiguration in auth.config.ts, prüft aber
 * nur "ist überhaupt ein gültiges Token da" — ohne die Rechte pro Request aus der DB neu zu laden.
 * Die DB-gestützte Rechteprüfung passiert weiterhin in requireUser()/getOptionalUser() (Node-Runtime).
 */
export const { auth } = NextAuth({
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
      // Wird in dieser Instanz nie aufgerufen (middleware ruft nie signIn()) — nur zum Erfüllen der Konfiguration.
      async authorize() {
        return null;
      },
    }),
  ],
});
