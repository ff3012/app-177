import { AuthError } from 'next-auth';

/**
 * Next.js can bundle a Server Action's code into a separate chunk from the one that threw the
 * error, which sometimes makes `instanceof AuthError` fail even for a genuine sign-in error
 * (each chunk can end up with its own module instance of `next-auth`). Falling back to duck-typing
 * on `.name`/`.type` means a wrong password degrades to a friendly form error instead of an
 * unhandled exception. Doesn't match Next.js's NEXT_REDIRECT control-flow errors (thrown on a
 * successful sign-in), so those still propagate normally.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof AuthError) {
    return true;
  }
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    const type = (error as { type?: unknown }).type;
    if (typeof name === 'string' && (name === 'AuthError' || name.includes('CredentialsSignin'))) {
      return true;
    }
    if (typeof type === 'string' && type.includes('CredentialsSignin')) {
      return true;
    }
  }
  return false;
}

/**
 * Next.js's redirect() throws a control-flow error whose `digest` starts with "NEXT_REDIRECT"
 * (the exact digest string also encodes the target/type, e.g. "NEXT_REDIRECT;push;/kalender;307;").
 * That's what a successful signIn() with redirectTo looks like from the caller's side.
 */
export function isNextRedirectError(error: unknown): boolean {
  const digest = error && typeof error === 'object' ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}
