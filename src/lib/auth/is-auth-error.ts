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
