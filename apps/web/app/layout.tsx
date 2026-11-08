import type { Metadata, Viewport } from "next";
import { SUPPORTED_HARNESSES } from "@codewrapped/stats";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/api";
import "./globals.css";

// og:title and twitter:title follow each page's title, so the landing gets this one.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "codewrapped: a Wrapped for your coding agents", template: "%s -- codewrapped" },
  description: `One command turns your coding agent logs into a card: hours, tokens, repositories and tools. Works with ${SUPPORTED_HARNESSES}.`,
  openGraph: { siteName: "codewrapped", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/Geist-Regular.ttf" as="font" type="font/ttf" crossOrigin="" />
        <link rel="preload" href="/fonts/CommitMono-400-Regular.ttf" as="font" type="font/ttf" crossOrigin="" />
      </head>
      <body className="min-h-dvh bg-bg text-fg">{children}</body>
    </html>
  );
}
