// Seiten, die ein Fremdsystem einbetten darf: nur das schreibgeschützte Feuerwehrhaus-Dashboard
// (/dashboard/[token], Link-geschützt, keine Aktionen auf der Seite) darf in einem iFrame von BlaulichtSMS
// erscheinen ("HTML/iFrame-Integration" im BlaulichtSMS-Dashboard). Alle übrigen Seiten bleiben gegen
// Einbettung gesperrt (Clickjacking-Schutz).
const DASHBOARD_FRAME_ANCESTORS = "frame-ancestors 'self' https://blaulichtsms.net https://*.blaulichtsms.net";

const contentSecurityPolicy = (frameAncestors) => [
  "default-src 'self'",
  // Next.js injects its own inline bootstrap/hydration scripts, so 'unsafe-inline' is needed here
  // unless a nonce-based CSP is set up (bigger change - not done here).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // https://*.exo.io: Exoscale SOS (S3-compatible object storage) - Einsatzfoto-Vorschauen/
  // -Thumbnails werden über eine session-geprüfte Route ausgeliefert, die auf eine kurzlebige
  // presigned S3-URL redirected (siehe api/photo-uploads/[photoUploadId]/photos/[photoId]/route.ts) -
  // Browser werten img-src auch gegen die REDIRECT-Ziel-URL aus, nicht nur die ursprüngliche
  // gleiche-Origin-Anfrage. Bewusst eine statische Wildcard auf die Exoscale-Domain, nicht aus
  // process.env.S3_ENDPOINT_URL zur Config-Ladezeit abgeleitet - siehe root CLAUDE.md, dieses
  // Projekt wurde schon zweimal von "Env-Var zur Laufzeit vorhanden, aber an anderer Stelle nicht
  // durchgereicht" gebissen; ein Header, der aus einer Env-Var zur next.config.mjs-Ladezeit gebaut
  // wird, wäre eine dritte Variante genau dieses Fehlerbilds für praktisch keinen Sicherheitsgewinn
  // (die Domain ändert sich nur, wenn Exoscale selbst seine Domain ändert).
  "img-src 'self' data: https://*.exo.io",
  "font-src 'self' data:",
  // https://*.exo.io: derselbe Exoscale-SOS-Bucket - der Foto-Upload (lib/photo-upload/
  // foreground-upload.ts) lädt Originale per presigned PUT direkt vom Client zu S3 hoch, kein Server-Proxy.
  "connect-src 'self' https://*.exo.io",
  frameAncestors,
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const COMMON_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Default Server Action body limit is 1MB - too small for the Drohnengruppe-Unterlagen PDF
    // upload (admin/drohnen). Raised for the whole app since Server Actions don't have a
    // per-route config.
    serverActions: { bodySizeLimit: '10mb' },
  },
  async headers() {
    return [
      {
        // Alles außer /dashboard/...: Einbettung in fremde Seiten verboten.
        source: '/((?!dashboard(?:/|$)).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          ...COMMON_HEADERS,
          { key: 'Content-Security-Policy', value: contentSecurityPolicy("frame-ancestors 'none'") },
        ],
      },
      {
        // /dashboard/...: bewusst OHNE X-Frame-Options (das würde frame-ancestors aushebeln), Einbettung nur
        // durch die eigene Seite und BlaulichtSMS.
        source: '/dashboard/:path*',
        headers: [...COMMON_HEADERS, { key: 'Content-Security-Policy', value: contentSecurityPolicy(DASHBOARD_FRAME_ANCESTORS) }],
      },
    ];
  },
};

export default nextConfig;
