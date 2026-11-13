'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { isMcpEnabled } from '@/lib/mcp/enabled';
import { OauthError } from '@/lib/mcp/oauth/errors';
import { buildRedirect } from '@/lib/mcp/oauth/redirect-uris';
import { AUTHORIZE_PARAM_NAMES, createAuthorizationCode, validateAuthorizeRequest } from '@/lib/mcp/oauth/service';

function readParams(formData: FormData): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const name of AUTHORIZE_PARAM_NAMES) {
    const value = formData.get(name);
    params[name] = typeof value === 'string' && value !== '' ? value : undefined;
  }
  return params;
}

/** Die versteckten Formularfelder werden nie vertraut: alles wird hier erneut geprüft. */
async function validated(formData: FormData) {
  if (!(await isMcpEnabled())) throw new Error('Nicht verfügbar.');
  const result = await validateAuthorizeRequest(readParams(formData));
  if (!result.ok) {
    if (result.fatal) throw new Error(result.message);
    redirect(buildRedirect(result.redirectUri, { error: result.error, error_description: result.errorDescription, state: result.state }));
  }
  return result.request;
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const user = await requireUser();
  const request = await validated(formData);
  let code: string;
  try {
    ({ code } = await createAuthorizationCode({ userId: user.id, request }));
  } catch (error) {
    if (error instanceof OauthError) {
      redirect(buildRedirect(request.redirectUri, { error: error.code, error_description: error.message, state: request.state }));
    }
    throw error;
  }
  redirect(buildRedirect(request.redirectUri, { code, state: request.state }));
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  await requireUser();
  const request = await validated(formData);
  redirect(buildRedirect(request.redirectUri, { error: 'access_denied', error_description: 'Der Benutzer hat den Zugriff abgelehnt.', state: request.state }));
}
