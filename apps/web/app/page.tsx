import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { site } from "@codewrapped/brand";
import { SUPPORTED_HARNESSES } from "@codewrapped/stats";
import { AccountCta } from "@/components/Account";
import { BoardTable } from "@/components/BoardTable";
import { Card } from "@/components/Card";
import { Footer, Header } from "@/components/Chrome";
import { CopyCommand } from "@/components/CopyCommand";
import { SignInButton } from "@/components/SignInButton";
import { getBoard, getProfile } from "@/lib/api";
import { exampleSummary } from "@codewrapped/card/element";

export const revalidate = 300;

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** The weekly board stays off the landing until it has this many people. */
const MIN_BOARD_PEOPLE = 10;

async function heroCard() {
  const handle = process.env.NEXT_PUBLIC_HERO_HANDLE?.replace(/^@/, "");
  if (handle) {
    const profile = await getProfile(handle, "30d", { revalidate: 300 }).catch(() => null);
    const t = profile?.summary.totals;
    if (profile && t && t.activeMinutes + t.tokens.headline > 0) {
      return { summary: profile.summary, handle: profile.profile.handle, standing: profile.standing ?? null, example: false };
    }
  }
  return { summary: exampleSummary(new Date().toISOString().slice(0, 10)), handle: null, standing: null, example: true };
}

const onTheCard: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "The numbers",
    items: [
      ["Tokens", "without cache reads"],
      ["Hours with agents", "wall-clock, overlaps counted once"],
      ["Peak parallel sessions", "the most agents at once"],
      ["Cost at API prices", "an estimate, never a bill"],
    ],
  },
  {
    title: "The patterns",
    items: [
      ["Top repositories", "by tokens"],
      ["Favorite tools", "Bash, Edit, Read and the rest"],
      ["When you work", "hour by weekday"],
      ["Your archetype", "one line about how you work"],
    ],
  },
];

const c = (s: string) => <code className="font-mono text-fg">{s}</code>;

const privacy: Array<[string, ReactNode]> = [
  [
    "Where it looks",
    <>
      {c("~/.claude")}, {c("~/.codex")}, {c("CLAUDE_CONFIG_DIR")} and {c("CODEX_HOME")}, plus folders one level deep in {c("~")} and{" "}
      {c("~/.config")} named {c(".claude*")}, {c(".codex*")}, {c("claude*")} or {c("codex*")} that hold logs. From your shell config files it reads
      only those two variables.{" "}
      <a href={`${site.repo}/blob/main/SECURITY.md`} className="rounded-[8px] text-fg underline decoration-border underline-offset-4 hover:decoration-fg">
        Exactly what it scans
      </a>
    </>,
  ],
  [
    "What it reads",
    <>
      Session logs in those folders, and from {c(".git/config")} the repository name from the remote URL, never credentials.
    </>,
  ],
  ["What it counts", "Time, tokens, tool calls, file and repository names."],
  ["What it never keeps", "Your prompts, your code, full paths."],
  ["Without an account", "It makes zero network requests."],
];

const steps: Array<{ label: string; code?: boolean }> = [
  { label: "Sign in with GitHub" },
  { label: "npx codewrapped login", code: true },
  { label: "npx codewrapped sync", code: true },
];

const faq: Array<[string, ReactNode]> = [
  [
    "Is my code uploaded?",
    <>
      No. Without an account, nothing leaves your computer. If you sign in and sync, only daily counts go up, plus tool and model names, file names
      without paths and repository names without owners. Run <code className="font-mono text-fg">npx codewrapped sync --dry-run</code> to see the
      exact upload.
    </>,
  ],
  [
    "Who can see my repository and file names?",
    <>
      Only you, by default. Your public page hides repository and file names until you turn them on in settings. The card the CLI makes on your
      computer shows them, since it stays with you unless you share it.
    </>,
  ],
  [
    "How is it different from ccusage?",
    <>
      ccusage is a detailed usage report for your terminal: tokens and cost by day, month, session and model. It is the better tool for tracking
      spend. codewrapped is a look back you can share: wall-clock hours, parallel sessions, repositories and tools on one card, with history past
      the 30-day log cleanup if you sign in.
    </>,
  ],
  [
    "I use two Claude accounts",
    <>
      Both are found and added up automatically when their folders are in your home directory, such as {c("~/.claude")} and{" "}
      {c("~/.claude-work")}, or when {c("CLAUDE_CONFIG_DIR")} points to them in your shell config. Anywhere else, pass each one with{" "}
      {c("--claude-dir")}. The first run lists every folder it found.
    </>,
  ],
  [
    "I work on several machines",
    <>Sign in and run {c("npx codewrapped sync")} on each one. Every machine uploads its own daily totals, and they add up on your profile.</>,
  ],
  [
    "Why does my card show 23 days?",
    <>
      Claude Code deletes session logs after 30 days, so the card covers the days your logs still have. Raise{" "}
      <code className="font-mono text-fg">cleanupPeriodDays</code> in <code className="font-mono text-fg">~/.claude/settings.json</code>, or sign
      in and sync to keep daily totals past that.
    </>,
  ],
  [
    "Which coding agents does it read?",
    <>
      {SUPPORTED_HARNESSES}: Claude Code in the terminal and in VS Code, Codex from the CLI and the desktop app, Pi, opencode, ZCode from the CLI and
      the desktop app, Cursor's agent chats, and oh-my-pi. Pi, opencode, ZCode, Cursor and oh-my-pi are in beta until more people have checked their numbers. Each agent is a small adapter, added once it is checked against real
      logs. To ask for yours or report a wrong number,{" "}
      <a
        href={`${site.repo}/issues/new?template=harness.yml`}
        className="text-fg underline decoration-border underline-offset-4 hover:decoration-fg"
      >
        open an issue
      </a>{" "}
      with where it keeps its logs.
    </>,
  ],
  [
    "Are you affiliated with Anthropic or OpenAI?",
    <>No. codewrapped is an independent open source project. Claude and Claude Code are trademarks of Anthropic, Codex of OpenAI.</>,
  ],
];

function Title({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[32px]">
      {children}
    </h2>
  );
}

export default async function Home() {
  const [hero, board] = await Promise.all([heroCard(), getBoard("week", "hours", { revalidate: 300 })]);
  const showBoard = board !== null && board.participants >= MIN_BOARD_PEOPLE && board.entries.length > 0;

  return (
    <>
      <Header right={<SignInButton quiet label="Sign in" returnTo="/settings" />} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-4 sm:px-6 md:gap-32">
        {/* Hero: the message on the left, the real card on the right. */}
        <section className="grid items-center gap-10 pt-8 md:grid-cols-[1fr_1.35fr] md:gap-12 md:pt-16">
          <div className="flex flex-col gap-6">
            <h1 className="cw-enter text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[52px]">
              Your month with coding agents, on one card.
            </h1>
            <p className="cw-enter max-w-[42ch] text-[17px] leading-relaxed text-muted" style={{ "--i": 1 } as React.CSSProperties}>
              Hours, tokens and repositories from your coding agents. Read locally, uploaded only if you sign in.
            </p>
            <p className="cw-enter text-[14px] text-muted" style={{ "--i": 1 } as React.CSSProperties}>
              Works with {SUPPORTED_HARNESSES}.
            </p>
            <div className="cw-enter" style={{ "--i": 2 } as React.CSSProperties}>
              <CopyCommand />
            </div>
          </div>
          <div className="cw-enter flex flex-col gap-3" style={{ "--i": 2 } as React.CSSProperties}>
            <Card summary={hero.summary} handle={hero.handle} standing={hero.standing} label={hero.example ? "Example card" : `Card of @${hero.handle}`} />
            <p className="text-[13px] text-muted">
              {hero.example ? (
                "Example card. Yours comes from your own logs."
              ) : (
                <>
                  <Link href={`/@${hero.handle}`} className="rounded-[8px] text-fg underline decoration-border underline-offset-4 hover:decoration-fg">
                    My last 30 days.
                  </Link>{" "}
                  Yours comes from your own logs.
                </>
              )}
            </p>
          </div>
        </section>

        {/* What is on the card: two groups, numbers and patterns. */}
        <section className="cw-reveal flex flex-col gap-8" aria-labelledby="on-the-card">
          <Title id="on-the-card">What is on the card</Title>
          <div className="grid gap-4 md:grid-cols-2">
            {onTheCard.map((group, gi) => (
              <div key={group.title} className={`flex flex-col gap-5 rounded-[12px] border border-border p-6 sm:p-8 ${gi === 0 ? "bg-surface" : ""}`}>
                <h3 className="font-mono text-[13px] text-muted">{group.title}</h3>
                <ul className="flex flex-col gap-4">
                  {group.items.map(([name, hint]) => (
                    <li key={name} className="flex flex-col gap-0.5">
                      <span className="text-[17px] font-medium tracking-[-0.01em]">{name}</span>
                      <span className="text-[14px] text-muted">{hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy: a ruled definition list. */}
        <section className="cw-reveal grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12" aria-labelledby="privacy">
          <Title id="privacy">Private by default</Title>
          <dl className="flex flex-col border-b border-border">
            {privacy.map(([k, v]) => (
              <div key={k} className="grid gap-1 border-t border-border py-5 sm:grid-cols-[180px_1fr] sm:gap-6">
                <dt className="text-[16px] font-medium">{k}</dt>
                <dd className="text-[16px] leading-relaxed text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Sign in: the reason on the left, the three steps on the right. */}
        <section className="cw-reveal grid items-start gap-10 md:grid-cols-2 md:gap-12" aria-labelledby="keep-history">
          <div className="flex flex-col gap-5">
            <Title id="keep-history">Keep your history</Title>
            <p className="max-w-[46ch] text-[16px] leading-relaxed text-muted">
              Claude Code deletes logs after 30 days. Sign in and sync, and your history keeps growing. You also get a public page at{" "}
              <span className="text-fg">{site.host}/@you</span> and a spot on the leaderboard if you want one.
            </p>
            <div>
              <AccountCta signedOut={<SignInButton returnTo="/settings" />} />
            </div>
          </div>
          <ol className="flex flex-col rounded-[12px] border border-border">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-4 border-t border-border px-5 py-4 first:border-t-0 sm:px-6">
                {/* The list already numbers the steps for screen readers. */}
                <span aria-hidden="true" className="w-4 shrink-0 font-mono text-[14px] text-muted">
                  {i + 1}
                </span>
                {s.code ? <code className="font-mono text-[15px]">{s.label}</code> : <span className="text-[15px]">{s.label}</span>}
              </li>
            ))}
          </ol>
        </section>

        {/* The weekly board, once enough people are on it. */}
        {showBoard && (
          <section className="cw-reveal flex flex-col gap-6" aria-labelledby="this-week">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div className="flex items-baseline gap-4">
                <Title id="this-week">This week</Title>
                <span className="font-mono text-[14px] text-muted">{board.participants} people</span>
              </div>
              <Link href="/leaderboard" className="rounded-[8px] text-[14px] text-muted hover:text-fg">
                Full leaderboard
              </Link>
            </div>
            <BoardTable board={board} limit={5} />
            <p className="text-[13px] text-muted">Hours with agents. Self-reported from local logs.</p>
          </section>
        )}

        {/* Questions: heading on the left, accordion on the right. */}
        <section className="cw-reveal grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12" aria-labelledby="questions">
          <Title id="questions">Questions</Title>
          <div className="flex flex-col border-t border-border">
            {faq.map(([q, a]) => (
              <details key={q} className="group border-b border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-[8px] py-5 text-[17px] font-medium tracking-[-0.01em] marker:hidden [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden="true" className="shrink-0 font-mono text-[18px] leading-none text-muted">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">&minus;</span>
                  </span>
                </summary>
                <p className="max-w-[62ch] pb-6 text-[15px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* The same command as the hero, for whoever read this far. */}
        <section className="cw-reveal flex flex-col items-start gap-6 rounded-[12px] border border-border p-6 sm:p-12">
          <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.025em] sm:text-[32px]">See your month in one command.</h2>
          <CopyCommand />
        </section>
      </main>
      <Footer />
    </>
  );
}
