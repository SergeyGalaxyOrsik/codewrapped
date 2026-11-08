import { addDays, formatHours, weekdayOf } from "@codewrapped/stats";
import { heatSteps } from "@codewrapped/card/element";

const ALPHA = [0, 0.2, 0.4, 0.65, 1];

/** Every synced day as a calendar grid, one column per week, Monday on top. */
export function Calendar({ days, today }: { days: Array<{ day: string; minutes: number }>; today: string }) {
  if (days.length === 0) return <p className="text-[14px] text-muted">No synced days yet.</p>;
  const byDay = new Map(days.map((d) => [d.day, d.minutes]));
  // Start on the Monday on or before the first day, at least 26 weeks back so the grid reads as a calendar.
  const first = days[0]!.day < addDays(today, -181) ? days[0]!.day : addDays(today, -181);
  const start = addDays(first, -weekdayOf(first));
  const weeks: string[][] = [];
  for (let d = start; d <= today; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  const steps = heatSteps([weeks.flat().map((d) => byDay.get(d) ?? 0)])[0]!;
  return (
    // rtl on the scroller starts it at the newest weeks on narrow screens; the grid itself stays ltr.
    <div className="overflow-x-auto pb-2" dir="rtl">
      <div className="flex w-max gap-[3px]" dir="ltr" role="img" aria-label={`Activity on ${days.length} days`}>
        {weeks.map((week, w) => (
          <div key={week[0]} className="flex flex-col gap-[3px]">
            {week.map((d, i) => {
              const step = d > today ? -1 : steps[w * 7 + i]!;
              const minutes = byDay.get(d) ?? 0;
              return (
                <div
                  key={d}
                  title={step < 0 ? undefined : `${d}: ${minutes > 0 ? formatHours(minutes) : "no activity"}`}
                  className="size-[11px] rounded-[2px]"
                  style={{
                    background: step < 0 ? "transparent" : step === 0 ? "var(--cw-border)" : `color-mix(in srgb, var(--cw-fg) ${ALPHA[step]! * 100}%, transparent)`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
