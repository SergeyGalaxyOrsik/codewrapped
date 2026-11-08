import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = fileURLToPath(new URL("../..", import.meta.url));

// The canonical host is the apex (codewrapped.app); www answers with a 301 to it.
// The Vercel domain settings must not redirect the apex to www, or the two redirects loop.
const canonical = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://codewrapped.app");
const wwwTwin = canonical.hostname === "localhost" || canonical.hostname.startsWith("www.") ? null : `www.${canonical.hostname}`;

const config: NextConfig = {
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
