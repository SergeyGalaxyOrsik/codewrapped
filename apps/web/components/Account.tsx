"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { apiCall } from "@/lib/api";
import { buttonPrimary } from "./buttons";

export type Account = { handle: string; avatarUrl: string | null };

/** undefined: not known yet. null: signed out. */
let current: Account | null | undefined;
let checked = false;
const listeners = new Set<() => void>();
const CACHE_KEY = "cw:account";

/** Updates every account-aware component on the page, and remembers the handle so the next visit renders it at once. */
export function setAccount(account: Account | null) {
  current = account;
  try {
    if (account) localStorage.setItem(CACHE_KEY, JSON.stringify(account));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the API once per page load. Until it answers, the remembered account stands in. */
function check() {
  if (checked) return;
  checked = true;
  if (current === undefined) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Account | null;
      if (cached?.handle) {
        current = cached;
        for (const l of listeners) l();
      }
    } catch {}
  }
  void apiCall<{ profile: Account }>("GET", "/me").then((res) => {
    if (res.ok) setAccount({ handle: res.data.profile.handle, avatarUrl: res.data.profile.avatarUrl });
    // A network failure keeps what we had; 401 or a missing profile means signed out.
    else if (res.status !== 0) setAccount(null);
  });
}

export function useAccount(): Account | null | undefined {
  useEffect(check, []);
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => undefined,
  );
}

function Avatar({ account }: { account: Account }) {
  if (account.avatarUrl) return <img src={account.avatarUrl} alt="" width={24} height={24} className="size-6 shrink-0 rounded-full border border-border" />;
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-[12px] uppercase">
      {account.handle[0]}
    </span>
  );
}

/** The header slot: your avatar and a link to your page when signed in, `signedOut` otherwise. */
export function AccountNav({ signedOut }: { signedOut?: ReactNode }) {
  const account = useAccount();
  const pathname = usePathname();
  if (!account) return <>{signedOut}</>;
  const own = `/@${account.handle}`;
  const onOwnPage = pathname === own || pathname.startsWith(`${own}/`) || pathname.startsWith(`/u/${account.handle}/`);
  const [href, label] = onOwnPage ? ["/settings", "Edit page"] : [own, "Your page"];
  return (
    <Link
      href={href}
      aria-label={`${label}, signed in as @${account.handle}`}
      className="ml-1 inline-flex items-center gap-2 whitespace-nowrap rounded-[8px] border border-border p-1 text-[14px] font-medium transition-colors hover:bg-surface active:scale-[0.98] sm:pr-3"
    >
      <Avatar account={account} />
      {/* Phones get the avatar alone so the header stays on one line. */}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

/** A call to action that sends signed-in people to their page instead of asking them to sign in again. */
export function AccountCta({ signedOut }: { signedOut: ReactNode }) {
  const account = useAccount();
  if (!account) return <>{signedOut}</>;
  return (
    <Link href={`/@${account.handle}`} className={buttonPrimary}>
      Open your page
    </Link>
  );
}
