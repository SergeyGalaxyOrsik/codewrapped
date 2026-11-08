import Link from "next/link";
import type { ReactNode } from "react";
import { markDataUri } from "@codewrapped/brand";

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
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
      <Wordmark />
      <nav className="flex items-center gap-2 text-[14px]">{right}</nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto mt-24 flex w-full max-w-5xl flex-col gap-2 border-t border-border px-4 py-8 text-[14px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <span>
        <code className="font-mono text-fg">npx codewrapped</code> runs on your computer. Sync is optional.
      </span>
      <Link href="/settings" className="rounded-[8px] hover:text-fg">
        Settings
      </Link>
    </footer>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-[8px] bg-fg px-4 py-2 text-[14px] font-medium text-bg transition-opacity hover:opacity-85 disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center whitespace-nowrap rounded-[8px] border border-border px-4 py-2 text-[14px] font-medium text-fg hover:bg-surface disabled:opacity-50";
