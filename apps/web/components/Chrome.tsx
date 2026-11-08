import Link from "next/link";
import type { ReactNode } from "react";
import { markDataUri, site } from "@codewrapped/brand";

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-[8px]" aria-label="codewrapped home">
      <img src={markDataUri(Math.round(size * 1.15), "light")} alt="" width={Math.round(size * 1.15)} height={Math.round(size * 1.15)} className="dark:hidden" />
      <img src={markDataUri(Math.round(size * 1.15), "dark")} alt="" width={Math.round(size * 1.15)} height={Math.round(size * 1.15)} className="hidden dark:block" />
      <span className="font-medium tracking-[-0.02em]" style={{ fontSize: size }}>
        codewrapped
      </span>
    </Link>
  );
}

export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <Wordmark />
      <nav className="flex items-center gap-1 text-[14px]">
        <Link href="/leaderboard" className="rounded-[8px] px-3 py-2 text-muted hover:text-fg">
          Leaderboard
        </Link>
        {right}
      </nav>
    </header>
  );
}

/** The author's X handle, from NEXT_PUBLIC_AUTHOR_X_HANDLE, without the @. */
const AUTHOR_X = process.env.NEXT_PUBLIC_AUTHOR_X_HANDLE?.replace(/^@/, "") || null;

export function Footer() {
  return (
    <footer className="mx-auto mt-24 flex w-full max-w-5xl flex-col gap-6 border-t border-border px-4 py-10 text-[14px] text-muted sm:px-6">
      <p className="max-w-xl text-[16px] leading-relaxed text-fg">
        I build one small tool a week and share how it goes. codewrapped is week 1.
        {AUTHOR_X && (
          <>
            {" "}
            <a href={`https://x.com/${AUTHOR_X}`} className="rounded-[8px] underline decoration-border underline-offset-4 transition-colors hover:decoration-fg">
              Follow @{AUTHOR_X} on X
            </a>
          </>
        )}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex gap-4">
          <Link href="/leaderboard" className="rounded-[8px] hover:text-fg">
            Leaderboard
          </Link>
          <Link href="/settings" className="rounded-[8px] hover:text-fg">
            Settings
          </Link>
          <a href={site.repo} className="rounded-[8px] hover:text-fg">
            Source
          </a>
        </nav>
        <span>Not affiliated with Anthropic or OpenAI.</span>
      </div>
    </footer>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-[8px] bg-fg px-4 py-2 text-[14px] font-medium text-bg transition-opacity hover:opacity-85 disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-[8px] border border-border px-4 py-2 text-[14px] font-medium text-fg hover:bg-surface disabled:opacity-50";
