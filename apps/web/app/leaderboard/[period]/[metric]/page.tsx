import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardTable } from "@/components/BoardTable";
import { Footer, Header } from "@/components/Chrome";
import { MyRank } from "@/components/MyRank";
import { BOARD_METRIC_LABELS, BOARD_PERIOD_LABELS, getBoard, type BoardMetric, type BoardPeriod } from "@/lib/api";

export const revalidate = 60;

type Params = { params: Promise<{ period: string; metric: string }> };

const PERIODS = Object.keys(BOARD_PERIOD_LABELS) as BoardPeriod[];
const METRICS = Object.keys(BOARD_METRIC_LABELS) as BoardMetric[];
const href = (p: BoardPeriod, m: BoardMetric) => (p === "week" && m === "hours" ? "/leaderboard" : `/leaderboard/${p}/${m}`);

export function generateStaticParams(): Array<{ period: string; metric: string }> {
  return [];
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { period, metric } = (await params) as { period: BoardPeriod; metric: BoardMetric };
  const valid = PERIODS.includes(period) && METRICS.includes(metric);
  return {
    title: "Leaderboard",
    description: "Who spent the most hours with coding agents this week. Self-reported from local logs.",
    alternates: valid ? { canonical: href(period, metric) } : undefined,
  };
}

function Switch<T extends string>({ items, current, label, link }: { items: T[]; current: T; label: (x: T) => string; link: (x: T) => string }) {
  return (
    <div className="flex gap-1">
      {items.map((x) => (
        <Link
          key={x}
          href={link(x)}
          aria-current={x === current ? "page" : undefined}
          className={`rounded-[8px] px-3 py-1.5 text-[14px] ${x === current ? "bg-fg text-bg" : "text-muted hover:bg-surface hover:text-fg"}`}
        >
          {label(x)}
        </Link>
      ))}
    </div>
  );
}

export default async function LeaderboardPage({ params }: Params) {
  const { period, metric } = (await params) as { period: BoardPeriod; metric: BoardMetric };
  if (!PERIODS.includes(period) || !METRICS.includes(metric)) notFound();
  const board = await getBoard(period, metric);
  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-8 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Leaderboard</h1>
          <p className="text-[15px] text-muted">
            Self-reported from local logs. {period === "week" ? "Resets every Monday." : "Resets on the 1st of each month."} Ranked by wall-clock
            hours, longest streak or tokens. Never by cost.
          </p>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Switch items={PERIODS} current={period} label={(p) => BOARD_PERIOD_LABELS[p]} link={(p) => href(p, metric)} />
          <Switch items={METRICS} current={metric} label={(m) => BOARD_METRIC_LABELS[m]} link={(m) => href(period, m)} />
        </div>
        <MyRank period={period} metric={metric} />
        {!board ? (
          <p className="text-[15px] text-muted">The leaderboard could not load. Try again in a minute.</p>
        ) : board.entries.length === 0 ? (
          <p className="rounded-[12px] border border-border p-6 text-[15px] text-muted">
            No one on this board yet. Turn on the leaderboard in settings, then run <code className="font-mono text-fg">npx codewrapped sync</code>.
          </p>
        ) : (
          <>
            <BoardTable board={board} />
            <p className="text-[13px] text-muted">
              Top {Math.min(100, board.participants)} of {board.participants}. {board.range.start} to {board.range.end}.
            </p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
