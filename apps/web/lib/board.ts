import { formatCompact, formatHours, plural } from "@codewrapped/stats";
import type { BoardMetric } from "./api";

export function formatBoardValue(metric: BoardMetric, value: number): string {
  if (metric === "hours") return formatHours(value);
  if (metric === "streak") return plural(value, "day");
  return formatCompact(value);
}
