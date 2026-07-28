import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getDummyPasswordHash, verifyPassword } from '@/lib/password';
import { buildSessionUser, findUserWithRelationsByEmail, findUserWithRelationsById } from '@/lib/auth/build-session-user';
import type { SessionUser } from '@/types/next-auth';

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

        const user = await findUserWithRelationsByEmail(email.toLowerCase().trim());
        // Always run a real bcrypt.compare, against the user's hash if found or a dummy hash
        // otherwise, so a nonexistent email doesn't return measurably faster (timing/enumeration).
        const hashToCompare = user?.passwordHash ?? (await getDummyPasswordHash());
        const passwordValid = await verifyPassword(password, hashToCompare);

        if (!user || !user.isActive || !passwordValid) {
          return null;
        }

        return buildSessionUser(user);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        Object.assign(token, user as SessionUser);
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

      Object.assign(token, buildSessionUser(dbUser));
      return token;
    },
    async session({ session, token }) {
      Object.assign(session.user, token as unknown as SessionUser);
      return session;
    },
  },
});
