/**
 * Erlaubte Rücksprungadressen für Connector-Clients - ALLE Regeln stehen in dieser einen Tabelle.
 *
 * Host-genau (kein Suffix-Abgleich, kein "www."), nur https, Standard-Port, kein Fragment, keine Zugangsdaten in der
 * Adresse. Zusätzlich ist der PFAD festgelegt: `exactPaths` müssen exakt passen (auch kein Schrägstrich am Ende),
 * `pathPrefixes` müssen am Anfang des Pfads stehen. Eine Query ist erlaubt, sie kann den Pfad nicht verändern.
 *
 * Pfade bei echter Verbindung auf DEV bestätigen: Stand der Planung nutzt claude.ai den Pfad
 * /api/mcp/auth_callback und ChatGPT einen Pfad unter /connector/oauth/ bzw. /connector_platform_oauth_redirect.
 * Weichen die echten Adressen ab, wird nur diese Tabelle angepasst (Quellen: support.claude.com "custom connectors",
 * developers.openai.com "developer mode").
 */
export const HTTPS_REDIRECT_RULES: ReadonlyArray<{
  host: string;
  exactPaths?: readonly string[];
  pathPrefixes?: readonly string[];
}> = [
  { host: 'claude.ai', exactPaths: ['/api/mcp/auth_callback'] },
  { host: 'claude.com', exactPaths: ['/api/mcp/auth_callback'] },
  { host: 'chatgpt.com', exactPaths: ['/connector_platform_oauth_redirect'], pathPrefixes: ['/connector/oauth/'] },
];

/** Lokale Werkzeuge (z. B. MCP Inspector): http, beliebiger Port und Pfad. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' || url.port) return false;
  const rule = HTTPS_REDIRECT_RULES.find((r) => r.host === url.hostname);
  if (!rule) return false;
  return (
    (rule.exactPaths ?? []).includes(url.pathname) || (rule.pathPrefixes ?? []).some((prefix) => url.pathname.startsWith(prefix))
  );
}

/** Hängt Parameter an die Rücksprungadresse (vorhandene Query bleibt erhalten), undefinierte Werte entfallen. */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
