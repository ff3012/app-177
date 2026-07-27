import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verifyPassword } from '@/lib/password';
import { buildSessionUser, findUserWithRelationsByEmail } from '@/lib/auth/build-session-user';
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
        if (!user || !user.isActive) {
          return null;
        }

        const passwordValid = await verifyPassword(password, user.passwordHash);
        if (!passwordValid) {
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
      }
      return token;
    },
    async session({ session, token }) {
      Object.assign(session.user, token as unknown as SessionUser);
      return session;
    },
  },
});
