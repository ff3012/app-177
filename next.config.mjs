const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js injects its own inline bootstrap/hydration scripts, so 'unsafe-inline' is needed here
  // unless a nonce-based CSP is set up (bigger change - not done here).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // https://*.exo.io: Exoscale SOS (S3-compatible object storage) - Einsatzfoto-Vorschauen/
  // -Thumbnails werden über eine session-geprüfte Route ausgeliefert, die auf eine kurzlebige
  // presigned S3-URL redirected (siehe api/incidents/[incidentId]/photos/[photoId]/route.ts) -
  // Browser werten img-src auch gegen die REDIRECT-Ziel-URL aus, nicht nur die ursprüngliche
  // gleiche-Origin-Anfrage. Bewusst eine statische Wildcard auf die Exoscale-Domain, nicht aus
  // process.env.S3_ENDPOINT_URL zur Config-Ladezeit abgeleitet - siehe root CLAUDE.md, dieses
  // Projekt wurde schon zweimal von "Env-Var zur Laufzeit vorhanden, aber an anderer Stelle nicht
  // durchgereicht" gebissen; ein Header, der aus einer Env-Var zur next.config.mjs-Ladezeit gebaut
  // wird, wäre eine dritte Variante genau dieses Fehlerbilds für praktisch keinen Sicherheitsgewinn
  // (die Domain ändert sich nur, wenn Exoscale selbst seine Domain ändert).
  "img-src 'self' data: https://*.exo.io",
  "font-src 'self' data:",
  // https://*.exo.io: derselbe Exoscale-SOS-Bucket - die Upload-Warteschlange (lib/upload-queue/
  // queue.ts) lädt Originale per presigned PUT direkt vom Client zu S3 hoch, kein Server-Proxy.
  "connect-src 'self' https://*.exo.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

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
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        ],
      },
    ];
  },
};

export default nextConfig;
