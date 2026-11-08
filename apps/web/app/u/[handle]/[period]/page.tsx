import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCompact, formatHours, formatInt, formatShare, formatUsd, PERIODS, type Period, type PublicProfile } from "@codewrapped/stats";
import { formatRange, periodLabel } from "@codewrapped/card/element";
import { Calendar } from "@/components/Calendar";
import { Card } from "@/components/Card";
import { buttonPrimary, Footer, Header } from "@/components/Chrome";
import { CopyCommand } from "@/components/CopyCommand";
import { getProfile, PERIOD_LABELS } from "@/lib/api";

export const revalidate = 60;
// Profiles render on first request and are then cached (ISR).
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ handle: string; period: string }> };

async function load(params: Params["params"]): Promise<{ data: PublicProfile; period: Period } | null> {
  const { handle, period } = await params;
  if (!PERIODS.includes(period as Period)) return null;
  const data = await getProfile(decodeURIComponent(handle).replace(/^@/, ""), period as Period);
  return data ? { data, period: period as Period } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return { title: "Not found" };
  const { data, period } = loaded;
  const h = data.profile.handle;
  const s = data.summary;
  const description = `${formatCompact(s.totals.tokens.headline)} tokens and ${formatHours(s.totals.activeMinutes)} with coding agents, ${periodLabel(s)}.`;
  const image = `/api/og/${h}?period=${period}`;
  return {
    title: `@${h}`,
    description,
    alternates: { canonical: period === "30d" ? `/@${h}` : `/@${h}/${period}` },
    openGraph: { title: `@${h} on codewrapped`, description, images: [{ url: image, width: 1200, height: 675 }] },
    twitter: { card: "summary_large_image", title: `@${h} on codewrapped`, description, images: [image] },
  };
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[22px]">{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <h2 className="text-[18px] font-medium tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProfilePage({ params }: Params) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { data, period } = loaded;
  const { profile, summary: s, allTime } = data;
  const t = s.totals;
  const sourceTotal = s.bySource.claude.activeMinutes + s.bySource.codex.activeMinutes;
  const share = (m: number) => (sourceTotal > 0 ? Math.round((m / sourceTotal) * 100) : 0);

  return (
    <>
      <Header
        right={
          <Link href="/" className={buttonPrimary}>
            Make your own
          </Link>
        }
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 sm:px-6">
        <div className="flex flex-col gap-5 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-4">
            {profile.avatarUrl && <img src={profile.avatarUrl} alt="" width={56} height={56} className="size-14 rounded-full border border-border" />}
            <div className="flex flex-col">
              <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{profile.displayName ?? `@${profile.handle}`}</h1>
              <span className="text-[15px] text-muted">@{profile.handle}</span>
            </div>
          </div>
          {allTime.firstDay && (
            <p className="text-[14px] text-muted">
              Since {formatRange(allTime.firstDay, allTime.firstDay)}: <span className="text-fg">{formatCompact(allTime.tokens)} tokens</span>,{" "}
              {formatHours(allTime.activeMinutes)}, {formatInt(allTime.sessions)} sessions
              {allTime.costUsd !== null && allTime.costUsd > 0 ? `, ${formatUsd(allTime.costUsd)} at API prices (est.)` : ""}
            </p>
          )}
        </div>

        <nav aria-label="Period" className="-mt-4 flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={p === "30d" ? `/@${profile.handle}` : `/@${profile.handle}/${p}`}
              aria-current={p === period ? "page" : undefined}
              className={`rounded-[8px] px-3 py-1.5 text-[14px] ${p === period ? "bg-fg text-bg" : "text-muted hover:bg-surface hover:text-fg"}`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </nav>

        {allTime.firstDay === null ? (
          <div className="flex flex-col items-start gap-4 rounded-[12px] border border-border p-8">
            <p className="text-[16px]">@{profile.handle} has not synced any days yet.</p>
            <p className="text-[14px] text-muted">
              After <code className="font-mono text-fg">npx codewrapped login</code>, run <code className="font-mono text-fg">npx codewrapped sync</code> and the card shows up here.
            </p>
          </div>
        ) : (
          <Card summary={s} handle={profile.handle} standing={data.standing} animate label={`Card of @${profile.handle}, ${periodLabel(s)}`} />
        )}

        {data.calendar && (
          <Section title="Every synced day">
            <Calendar days={data.calendar} today={s.range.end} />
          </Section>
        )}

        {t.activeMinutes + t.tokens.headline > 0 && (
          <Section title="Claude Code and Codex">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-border" aria-hidden>
              <div className="h-full bg-fg" style={{ width: `${share(s.bySource.claude.activeMinutes)}%` }} />
              <div className="h-full bg-muted" style={{ width: `${share(s.bySource.codex.activeMinutes)}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat value={`${share(s.bySource.claude.activeMinutes)}%`} label={`Claude Code, ${formatHours(s.bySource.claude.activeMinutes)}`} />
              <Stat value={formatCompact(s.bySource.claude.tokens)} label="Claude Code tokens" />
              <Stat value={`${share(s.bySource.codex.activeMinutes)}%`} label={`Codex, ${formatHours(s.bySource.codex.activeMinutes)}`} />
              <Stat value={formatCompact(s.bySource.codex.tokens)} label="Codex tokens" />
            </div>
          </Section>
        )}

        {t.tokens.headline > 0 && (
          <Section title="Details">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat value={formatCompact(t.tokens.input)} label="Input tokens" />
              <Stat value={formatCompact(t.tokens.output)} label="Output tokens" />
              <Stat value={formatCompact(t.tokens.cacheWrite)} label="Cache writes" />
              <Stat value={formatCompact(t.tokens.cacheRead)} label="Cache reads, not in the headline" />
              <Stat value={formatHours(t.agentMinutes)} label="Agent time, parallel sessions each count" />
              <Stat value={formatInt(t.peakSessions)} label="Most sessions at once" />
              <Stat value={formatInt(t.messages)} label="Prompts" />
              <Stat value={`${s.longestStreakDays} days`} label="Longest streak" />
            </div>
            {t.automated.sessions > 0 && (
              <p className="text-[14px] text-muted">
                Not in hours: +{formatHours(t.automated.addedMinutes)} of automated runs from {formatInt(t.automated.sessions)} sessions (claude -p, Agent SDK, codex exec).
              </p>
            )}
            {s.models && s.models.length > 0 && (
              <table className="w-full text-left text-[14px]">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 font-normal">Model</th>
                    <th className="py-2 text-right font-normal">Tokens</th>
                    <th className="hidden py-2 text-right font-normal sm:table-cell">Share</th>
                    {t.costUsd !== null && <th className="py-2 text-right font-normal">At API prices (est.)</th>}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {s.models.slice(0, 8).map((m) => (
                    <tr key={m.model} className="border-t border-border">
                      <td className="py-2 font-sans">{m.model}</td>
                      <td className="py-2 text-right">{formatCompact(m.tokens)}</td>
                      <td className="hidden py-2 text-right sm:table-cell">{formatShare(m.share)}</td>
                      {t.costUsd !== null && <td className="py-2 text-right">{m.costUsd === null ? "--" : formatUsd(m.costUsd)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        )}

        <section className="mt-6 flex flex-col items-start gap-4 rounded-[12px] border border-border bg-surface p-8">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Make your own</h2>
          <p className="text-[15px] text-muted">One command. It reads your Claude Code and Codex logs on your computer and makes this card.</p>
          <CopyCommand />
        </section>
      </main>
      <Footer />
    </>
  );
}
