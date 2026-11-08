import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const root = fileURLToPath(new URL("../..", import.meta.url));

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
  async rewrites() {
    // An "@" folder means a parallel route in the App Router, so profiles live at /u/... behind /@handle.
    return [
      { source: "/@:handle", destination: "/u/:handle/30d" },
      { source: "/@:handle/:period", destination: "/u/:handle/:period" },
    ];
  },
};

export default config;
