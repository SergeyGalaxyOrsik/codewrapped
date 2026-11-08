import Link from "next/link";
import { site } from "@codewrapped/brand";
import { BoardTable } from "@/components/BoardTable";
import { Card } from "@/components/Card";
import { Footer, Header } from "@/components/Chrome";
import { CopyCommand } from "@/components/CopyCommand";
import { SignInButton } from "@/components/SignInButton";
import { getBoard, getProfile, SITE_URL } from "@/lib/api";
import { exampleSummary } from "@codewrapped/card/element";

export const revalidate = 300;

async function heroCard() {
  const handle = process.env.NEXT_PUBLIC_HERO_HANDLE;
  if (handle) {
    const profile = await getProfile(handle, "30d").catch(() => null);
    if (profile && profile.allTime.firstDay) return { summary: profile.summary, handle: profile.profile.handle, standing: profile.standing ?? null, example: false };
  }
  return { summary: exampleSummary(new Date().toISOString().slice(0, 10)), handle: null, standing: null, example: true };
}

const onTheCard = [
  "Tokens, without cache reads",
  "Hours with agents",
  "Peak parallel sessions",
  "What it would cost at API prices",
  "Top repositories",
  "Favorite tools",
  "When you work",
  "Your archetype",
];

const privacy: Array<[string, string]> = [
  ["What it reads", "session logs in ~/.claude and ~/.codex, and .git/config to name each repository."],
  ["What it counts", "time, tokens, tool calls, file and repository names."],
  ["What it never keeps", "your prompts, your code, full paths."],
  ["Without an account", "it makes zero network requests."],
];

const faq: Array<[string, React.ReactNode]> = [
  [
    "Is my code uploaded?",
    <>
      No. Without an account, nothing leaves your computer. If you sign in and sync, only daily counts go up, plus tool and model names, file names
      without paths and repository names without owners. Run <code className="font-mono text-fg">npx codewrapped sync --dry-run</code> to see the
      exact upload.
    </>,
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
    "Does it work with Cursor?",
    <>Not yet. It reads Claude Code logs, including Claude Code in VS Code, and Codex logs from the CLI and the desktop app.</>,
  ],
  [
    "Are you affiliated with Anthropic or OpenAI?",
    <>No. codewrapped is an independent open source project. Claude and Claude Code are trademarks of Anthropic, Codex of OpenAI.</>,
  ],
];

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[28px] font-semibold tracking-[-0.02em]">{children}</h2>;
}

export default async function Home() {
  const [hero, board] = await Promise.all([heroCard(), getBoard("week", "hours")]);
  return (
    <>
      <Header right={<SignInButton quiet label="Sign in" returnTo={`${SITE_URL}/settings`} />} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-4 sm:px-6">
        <section className="grid items-center gap-10 pt-10 md:grid-cols-[1fr_1.35fr] md:pt-16">
          <div className="flex flex-col gap-6">
            <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">Your month with coding agents, on one card.</h1>
            <p className="text-[17px] leading-relaxed text-muted">
              Tokens, hours and repositories from your Claude Code and Codex sessions. Reads local logs. Nothing is uploaded unless you sign in.
            </p>
            <CopyCommand />
          </div>
          <div className="flex flex-col gap-2">
            <Card summary={hero.summary} handle={hero.handle} standing={hero.standing} label={hero.example ? "Example card" : `Card of @${hero.handle}`} />
            {hero.example && <p className="text-[13px] text-muted">Example card. Yours comes from your own logs.</p>}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <Title>What is on the card</Title>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-3 text-[16px] sm:grid-cols-2 md:grid-cols-4">
            {onTheCard.map((x) => (
              <li key={x} className="border-t border-border pt-3">
                {x}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-6">
          <Title>Private by default</Title>
          <dl className="flex flex-col">
            {privacy.map(([k, v]) => (
              <div key={k} className="grid gap-1 border-t border-border py-4 sm:grid-cols-[220px_1fr]">
                <dt className="text-[16px] font-medium">{k}:</dt>
                <dd className="text-[16px] text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Title>Why sign in</Title>
            <p className="text-[16px] leading-relaxed text-muted">
              Claude Code deletes logs after 30 days. Sign in and sync, and your history keeps growing. You also get a public page at{" "}
              <span className="text-fg">{site.host}/@you</span> and a spot on the leaderboard if you want one.
            </p>
            <ol className="flex flex-col gap-1 font-mono text-[14px]">
              <li>
                <span className="text-muted">1 </span>Sign in with GitHub
              </li>
              <li>
                <span className="text-muted">2 </span>npx codewrapped login
              </li>
              <li>
                <span className="text-muted">3 </span>npx codewrapped sync
              </li>
            </ol>
            <div>
              <SignInButton returnTo={`${SITE_URL}/settings`} />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <Title>This week</Title>
              <Link href="/leaderboard" className="rounded-[8px] text-[14px] text-muted hover:text-fg">
                Full leaderboard
              </Link>
            </div>
            {board && board.entries.length > 0 ? (
              <>
                <BoardTable board={board} limit={5} />
                <p className="text-[13px] text-muted">Hours with agents. Self-reported from local logs.</p>
              </>
            ) : (
              <p className="rounded-[12px] border border-border p-6 text-[15px] text-muted">
                The first board starts this week. Sign in, sync, and turn on the leaderboard in settings.
              </p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <Title>Questions</Title>
          <div className="flex flex-col">
            {faq.map(([q, a]) => (
              <details key={q} className="group border-t border-border py-4">
                <summary className="cursor-pointer list-none rounded-[8px] text-[17px] font-medium marker:hidden">
                  <span className="mr-2 inline-block font-mono text-muted transition-transform group-open:rotate-45">+</span>
                  {q}
                </summary>
                <p className="mt-3 max-w-2xl pl-6 text-[15px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
