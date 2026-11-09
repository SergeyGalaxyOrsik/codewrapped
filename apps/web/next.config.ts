import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { API_URL } from "./lib/api";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dev = process.env.NODE_ENV !== "production";

// 'unsafe-inline' scripts: Next streams its payload in inline scripts, and nonces would make every page dynamic.
const csp: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "https://avatars.githubusercontent.com"],
  "font-src": ["'self'"],
  "connect-src": ["'self'", new URL(API_URL).origin],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "form-action": ["'self'"],
};

const securityHeaders = [
  { key: "Content-Security-Policy", value: Object.entries(csp).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ") },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// The canonical host is the apex (codewrapped.app); www answers with a 301 to it.
// The Vercel domain settings must not redirect the apex to www, or the two redirects loop.
const canonical = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://codewrapped.app");
const wwwTwin = canonical.hostname === "localhost" || canonical.hostname.startsWith("www.") ? null : `www.${canonical.hostname}`;

const config: NextConfig = {
  poweredByHeader: false,
  // Bounds how long a cached profile or board may be served stale, so periods of one profile never drift far apart.
  expireTime: 600,
  // Workspace packages ship as TypeScript source.
  transpilePackages: ["@codewrapped/brand", "@codewrapped/card", "@codewrapped/stats"],
  turbopack: { root },
  outputFileTracingRoot: root,
  // The OG image routes read the card fonts from disk.
  outputFileTracingIncludes: {
    "/api/og/[handle]": ["./public/fonts/**/*"],
    "/opengraph-image": ["./public/fonts/**/*"],
    "/opengraph-image.png": ["./public/fonts/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    if (!wwwTwin) return [];
    return [{ source: "/:path*", has: [{ type: "host", value: wwwTwin }], destination: `https://${canonical.hostname}/:path*`, statusCode: 301 }];
  },
  async rewrites() {
    // An "@" folder means a parallel route in the App Router, so profiles live at /u/... behind /@handle.
    return [
      { source: "/@:handle", destination: "/u/:handle/30d" },
      { source: "/@:handle/:period", destination: "/u/:handle/:period" },
      { source: "/leaderboard", destination: "/leaderboard/week/hours" },
    ];
  },
};

export default config;
