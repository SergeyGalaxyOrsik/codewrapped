import { site } from "@codewrapped/brand";
import { Card } from "@/components/Card";
import { Footer, Header } from "@/components/Chrome";
import { CopyCommand } from "@/components/CopyCommand";
import { SignInButton } from "@/components/SignInButton";
import { getProfile, SITE_URL } from "@/lib/api";
import { exampleSummary } from "@/lib/sample";

export const revalidate = 3600;

async function heroCard() {
  const handle = process.env.NEXT_PUBLIC_HERO_HANDLE;
  if (handle) {
    const profile = await getProfile(handle, "30d").catch(() => null);
    if (profile) return { summary: profile.summary, handle: profile.profile.handle, example: false };
  }
  return { summary: exampleSummary(new Date().toISOString().slice(0, 10)), handle: null, example: true };
}

const uploaded = [
  "Daily counts: sessions, prompts, active minutes, tokens, cost estimates",
  "Tool and model names",
  "File names, without paths",
  "Repository names, without owners",
  "Your timezone, so days start at your midnight",
];

const notUploaded = [
  "Prompts and messages",
  "Code, diffs and command output",
  "Full paths and git remotes",
  "Anything, until you run sync",
];

export default async function Home() {
  const hero = await heroCard();
  return (
    <>
      <Header right={<SignInButton quiet label="Sign in" returnTo={`${SITE_URL}/settings`} />} />
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <section className="grid items-center gap-10 pt-10 md:grid-cols-[1fr_1.35fr] md:pt-16">
          <div className="flex flex-col gap-6">
            <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">A Wrapped for your coding agents.</h1>
            <p className="text-[17px] leading-relaxed text-muted">
              One command reads your Claude Code and Codex logs and makes a card: tokens, hours, repositories, tools and when you work.
            </p>
            <CopyCommand />
            <p className="text-[14px] text-muted">No account needed. The default run makes no network calls.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Card summary={hero.summary} handle={hero.handle} label={hero.example ? "Example card" : `Card of @${hero.handle}`} />
            {hero.example && <p className="text-[13px] text-muted">Example card. Yours comes from your own logs.</p>}
          </div>
        </section>

        <section className="mt-24 grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-[12px] border border-border p-6">
            <h2 className="text-[20px] font-medium tracking-[-0.01em]">On your computer</h2>
            <p className="text-[15px] leading-relaxed text-muted">
              Run the command. You get a PNG card and a summary in the terminal. Your logs never leave your computer.
            </p>
            <code className="mt-auto font-mono text-[14px]">npx codewrapped</code>
          </div>
          <div className="flex flex-col gap-3 rounded-[12px] border border-border p-6">
            <h2 className="text-[20px] font-medium tracking-[-0.01em]">With an account</h2>
            <p className="text-[15px] leading-relaxed text-muted">
              Claude Code deletes its logs after 30 days. Sync daily totals and your history keeps growing past that. You also get a public page at{" "}
              <span className="text-fg">{site.host}/@you</span>.
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
            <div className="mt-2">
              <SignInButton returnTo={`${SITE_URL}/settings`} />
            </div>
          </div>
        </section>

        <section className="mt-24 flex flex-col gap-6">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em]">What is uploaded, and what is not</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[12px] border border-border p-6">
              <h3 className="mb-3 text-[15px] font-medium">Uploaded when you run sync</h3>
              <ul className="flex flex-col gap-2 text-[15px] text-muted">
                {uploaded.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-[12px] border border-border p-6">
              <h3 className="mb-3 text-[15px] font-medium">Never uploaded</h3>
              <ul className="flex flex-col gap-2 text-[15px] text-muted">
                {notUploaded.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-[15px] text-muted">
            File and repository names stay off your public page until you turn them on. Run <code className="font-mono text-fg">npx codewrapped sync --dry-run</code> to
            see the exact upload first.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
