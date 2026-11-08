"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_VISIBILITY, formatInt, type Visibility } from "@codewrapped/stats";
import { buttonPrimary, buttonSecondary } from "@/components/Chrome";
import { setAccount } from "@/components/Account";
import { SignInButton } from "@/components/SignInButton";
import { apiCall, signOut } from "@/lib/api";

type Me = {
  name: string;
  email: string;
  profile: {
    handle: string;
    canChangeHandle: boolean;
    displayName: string | null;
    avatarUrl: string | null;
    timeZone: string;
    visibility: Visibility;
    leaderboard: boolean;
    xHandle: string | null;
  };
  synced: { days: number; firstDay: string | null; lastDay: string | null };
};
type Token = { id: string; machineLabel: string; createdAt: string; lastUsedAt: string | null };

const TOGGLES: Array<{ key: keyof Visibility; label: string; help: string }> = [
  { key: "repos", label: "Repository names", help: "Top repositories by tokens." },
  { key: "files", label: "File names", help: "Most edited files, names only." },
  { key: "cost", label: "Cost estimates", help: "What your usage would cost at API prices." },
  { key: "models", label: "Models", help: "Which models you used and how much." },
  { key: "tools", label: "Tools", help: "Most used tools, like Bash or Edit." },
  { key: "heatmap", label: "Heatmap", help: "When you work, and every synced day." },
];

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-8">
      <h2 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

/** Asks inline instead of a browser dialog. */
function Confirm({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" className={buttonSecondary} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-border bg-surface p-4">
      <p className="text-[14px]">{question}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className={buttonPrimary}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
            setOpen(false);
          }}
        >
          {label}
        </button>
        <button type="button" className={buttonSecondary} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [xHandle, setXHandle] = useState("");

  const load = useCallback(async () => {
    const res = await apiCall<Me>("GET", "/me");
    if (!res.ok) {
      if (res.status === 401) {
        setMe("signed-out");
        setAccount(null);
      }
      else setNotice(res.error.message);
      return;
    }
    setMe(res.data);
    setAccount({ handle: res.data.profile.handle, avatarUrl: res.data.profile.avatarUrl });
    setHandle(res.data.profile.handle);
    setDisplayName(res.data.profile.displayName ?? "");
    setXHandle(res.data.profile.xHandle ?? "");
    const t = await apiCall<{ tokens: Token[] }>("GET", "/me/tokens");
    if (t.ok) setTokens(t.data.tokens);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (me === null) return <p className="py-16 text-[14px] text-muted">Loading...</p>;
  if (me === "signed-out")
    return (
      <div className="flex flex-col items-start gap-4 py-16">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="text-[15px] text-muted">Sign in to choose what your public page shows and to manage connected computers.</p>
        {notice && <p className="text-[14px]">{notice}</p>}
        <SignInButton />
      </div>
    );

  const vis = { ...DEFAULT_VISIBILITY, ...me.profile.visibility };
  const setVisibility = async (key: keyof Visibility, value: boolean) => {
    setMe({ ...me, profile: { ...me.profile, visibility: { ...vis, [key]: value } } });
    const res = await apiCall<{ visibility: Visibility }>("PATCH", "/me/visibility", { [key]: value });
    if (!res.ok) {
      setNotice(res.error.message);
      setMe({ ...me });
    }
  };

  return (
    <div className="flex flex-col py-10">
      <div className="flex items-end justify-between gap-4 pb-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Settings</h1>
          <p className="text-[14px] text-muted">{me.email}</p>
        </div>
        <Link href={`/@${me.profile.handle}`} className={buttonSecondary}>
          View your page
        </Link>
      </div>
      {notice && (
        <p role="status" className="mb-6 rounded-[8px] border border-border bg-surface p-3 text-[14px]">
          {notice}
        </p>
      )}

      <Block title="Profile">
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await apiCall<{ handle: string }>("PATCH", "/me/profile", { handle });
            setNotice(res.ok ? `Your page is now at /@${res.data.handle}.` : res.error.message);
            if (res.ok) await load();
          }}
        >
          <label htmlFor="handle" className="text-[14px] font-medium">
            Handle
          </label>
          <div className="flex gap-2">
            <input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              disabled={!me.profile.canChangeHandle}
              className="w-full rounded-[8px] border border-border bg-bg px-3 py-2 font-mono text-[14px] disabled:text-muted"
            />
            {me.profile.canChangeHandle && (
              <button type="submit" className={buttonSecondary} disabled={handle === me.profile.handle}>
                Change handle
              </button>
            )}
          </div>
          <p className="text-[13px] text-muted">
            {me.profile.canChangeHandle ? "You can change your handle once." : "You already changed your handle."}
          </p>
        </form>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await apiCall("PATCH", "/me/profile", { displayName: displayName.trim() || null });
            setNotice(res.ok ? "Saved your name." : res.error.message);
          }}
        >
          <label htmlFor="name" className="text-[14px] font-medium">
            Display name
          </label>
          <div className="flex gap-2">
            <input
              id="name"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-[8px] border border-border bg-bg px-3 py-2 text-[14px]"
            />
            <button type="submit" className={buttonSecondary}>
              Save name
            </button>
          </div>
        </form>
      </Block>

      <Block title="Public page">
        <p className="text-[14px] text-muted">Repository and file names are hidden until you turn them on. Changes show within a minute.</p>
        <ul className="flex flex-col">
          {TOGGLES.map((t) => (
            <li key={t.key} className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0">
              <label htmlFor={`v-${t.key}`} className="flex flex-col">
                <span className="text-[15px]">{t.label}</span>
                <span className="text-[13px] text-muted">{t.help}</span>
              </label>
              <input
                id={`v-${t.key}`}
                type="checkbox"
                role="switch"
                checked={vis[t.key]}
                onChange={(e) => void setVisibility(t.key, e.target.checked)}
                className="size-5 accent-[var(--cw-fg)]"
              />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Leaderboard">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="lb" className="flex flex-col">
            <span className="text-[15px]">Show me on the leaderboard</span>
            <span className="text-[13px] text-muted">Weekly and monthly boards by hours, streak and tokens. Never by cost. Off until you turn it on.</span>
          </label>
          <input
            id="lb"
            type="checkbox"
            role="switch"
            checked={me.profile.leaderboard}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setMe({ ...me, profile: { ...me.profile, leaderboard: enabled } });
              const res = await apiCall("PATCH", "/me/leaderboard", { enabled });
              setNotice(res.ok ? (enabled ? "You are on the leaderboard from the next refresh." : "You are off the leaderboard.") : res.error.message);
            }}
            className="size-5 accent-[var(--cw-fg)]"
          />
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await apiCall("PATCH", "/me/leaderboard", { xHandle: xHandle.trim() || null });
            setNotice(res.ok ? "Saved your X handle." : res.error.message);
          }}
        >
          <label htmlFor="x" className="text-[14px] font-medium">
            X handle
          </label>
          <div className="flex gap-2">
            <input
              id="x"
              value={xHandle}
              placeholder="@you"
              maxLength={16}
              onChange={(e) => setXHandle(e.target.value)}
              className="w-full rounded-[8px] border border-border bg-bg px-3 py-2 font-mono text-[14px]"
            />
            <button type="submit" className={buttonSecondary}>
              Save handle
            </button>
          </div>
          <p className="text-[13px] text-muted">Optional. Used to tag you in the weekly top 10 post on X.</p>
        </form>
        <p className="text-[13px] text-muted">
          Numbers are self-reported from local logs. New GitHub accounts and unusual days are reviewed before they rank.
        </p>
      </Block>

      <Block title="Connected computers">
        {tokens.length === 0 ? (
          <p className="text-[14px] text-muted">
            None yet. Run <code className="font-mono text-fg">npx codewrapped login</code> on a computer to connect it.
          </p>
        ) : (
          <ul className="flex flex-col">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0">
                <div className="flex flex-col">
                  <span className="text-[15px]">{t.machineLabel}</span>
                  <span className="text-[13px] text-muted">
                    Connected {when(t.createdAt)}, last sync {when(t.lastUsedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className={buttonSecondary}
                  onClick={async () => {
                    const res = await apiCall("DELETE", `/me/tokens/${t.id}`);
                    setNotice(res.ok ? `Disconnected ${t.machineLabel}. Its synced days stay.` : res.error.message);
                    if (res.ok) setTokens(tokens.filter((x) => x.id !== t.id));
                  }}
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Your data">
        <p className="text-[14px] text-muted">
          {me.synced.days > 0
            ? `${formatInt(me.synced.days)} daily rows synced, ${me.synced.firstDay} to ${me.synced.lastDay}.`
            : "Nothing synced yet."}
        </p>
        <div className="flex flex-col items-start gap-3">
          {me.synced.days > 0 && (
            <Confirm
              label="Delete my data"
              question="Delete every synced day? Your account and handle stay. This cannot be undone."
              onConfirm={async () => {
                const res = await apiCall<{ deletedDays: number }>("DELETE", "/me/data");
                setNotice(res.ok ? `Deleted ${formatInt(res.data.deletedDays)} daily rows.` : res.error.message);
                await load();
              }}
            />
          )}
          <Confirm
            label="Delete my account"
            question="Delete your account, your public page, connected computers and every synced day? This cannot be undone."
            onConfirm={async () => {
              const res = await apiCall("DELETE", "/me");
              if (res.ok) {
                setNotice("Your account is deleted.");
                setMe("signed-out");
                setAccount(null);
              } else setNotice(res.error.message);
            }}
          />
        </div>
      </Block>

      <div className="border-t border-border pt-8">
        <button
          type="button"
          className={buttonSecondary}
          onClick={async () => {
            await signOut();
            setMe("signed-out");
            setAccount(null);
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
