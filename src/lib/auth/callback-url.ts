/**
 * callbackUrl für die Login-Weiterleitung der Middleware. Normalerweise nur der Pfad (bisheriges Verhalten); für
 * /oauth/authorize zusätzlich die Query - ohne die gingen client_id, redirect_uri, code_challenge und state beim
 * Login verloren, und die Zustimmung wäre nach der Anmeldung nicht mehr möglich.
 */
export function buildLoginCallbackUrl(pathname: string, search: string): string {
  return pathname === '/oauth/authorize' ? pathname + search : pathname;
}
