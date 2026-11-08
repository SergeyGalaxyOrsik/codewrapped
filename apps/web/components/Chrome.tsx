import Link from "next/link";
import type { ReactNode } from "react";
import { markDataUri, site } from "@codewrapped/brand";
import { AccountNav } from "./Account";

/**
 * The mark and the name. When the header is too narrow for the name, it wraps onto a second
 * line that the fixed height clips, so only the mark shows, at whatever width that happens.
 */
function Wordmark() {
  return (
    <Link
      href="/"
      className="flex h-8 min-w-0 flex-wrap content-start items-center gap-x-2 overflow-hidden rounded-[8px]"
      aria-label="codewrapped home"
    >
      <img src={markDataUri(23, "light")} alt="" width={23} height={23} className="h-8 w-[23px] max-w-none object-contain dark:hidden" />
      <img src={markDataUri(23, "dark")} alt="" width={23} height={23} className="hidden h-8 w-[23px] max-w-none object-contain dark:block" />
      <span className="text-[18px] font-medium leading-8 tracking-[-0.02em] sm:text-[20px]">codewrapped</span>
    </Link>
  );
}

/** `right` is what signed-out visitors see; signed-in people get a link to their own page there. */
export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 py-5 sm:gap-3 sm:px-6">
      <Wordmark />
      <nav className="flex shrink-0 items-center text-[14px] sm:gap-1">
        <Link href="/leaderboard" className="rounded-[8px] px-2 py-2 text-muted hover:text-fg sm:px-3">
          Leaderboard
        </Link>
        <AccountNav signedOut={right} />
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
        <nav className="-my-1 flex gap-4">
          <Link href="/leaderboard" className="rounded-[8px] py-1 hover:text-fg">
            Leaderboard
          </Link>
          <Link href="/settings" className="rounded-[8px] py-1 hover:text-fg">
            Settings
          </Link>
          <a href={site.repo} className="rounded-[8px] py-1 hover:text-fg">
            Source
          </a>
        </nav>
        <span>Not affiliated with Anthropic or OpenAI.</span>
      </div>
    </footer>
  );
}

export { buttonPrimary, buttonSecondary } from "./buttons";
