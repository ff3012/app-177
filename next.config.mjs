const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js injects its own inline bootstrap/hydration scripts, so 'unsafe-inline' is needed here
  // unless a nonce-based CSP is set up (bigger change - not done here).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // React 19's Strict Mode double-invokes render/ref/effect in `next dev` only (never in a
  // production build, regardless of this flag) - that double-mount breaks react-hook-form's
  // uncontrolled-input defaultValues application and the <form onSubmit> handler for every
  // register()-based form (edit forms silently fall back to a native GET submission instead of
  // calling the server action). Confirmed via a local production build that this never affects
  // the deployed app; disabled here purely so local `npm run dev` form-testing works.
  reactStrictMode: false,
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
