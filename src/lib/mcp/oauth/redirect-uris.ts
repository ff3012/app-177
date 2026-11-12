/**
 * Erlaubte Rücksprungadressen für Connector-Clients. Host-genau (kein Suffix-Abgleich), nur https - ausgenommen
 * Loopback für lokale Werkzeuge (z. B. MCP Inspector). VOR dem Livegang gegen die aktuellen Dokumentationen von
 * Claude (support.claude.com, "custom connectors") und OpenAI (developers.openai.com, "developer mode") prüfen -
 * Stand der Planung: claude.ai nutzt https://claude.ai/api/mcp/auth_callback, ChatGPT einen Pfad unter chatgpt.com.
 */
const ALLOWED_HTTPS_HOSTS = new Set(['claude.ai', 'www.claude.ai', 'claude.com', 'chatgpt.com', 'www.chatgpt.com']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return ALLOWED_HTTPS_HOSTS.has(url.hostname);
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

/** Hängt Parameter an die Rücksprungadresse (vorhandene Query bleibt erhalten), undefinierte Werte entfallen. */
export function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
