import { PERIODS, type Period } from "@codewrapped/stats";
import { getProfile } from "@/lib/api";
import { cardImage } from "@/lib/og";

export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const period = (new URL(req.url).searchParams.get("period") ?? "30d") as Period;
  if (!PERIODS.includes(period)) return new Response("Unknown period", { status: 400 });
  const profile = await getProfile(handle.replace(/^@/, ""), period);
  if (!profile) return new Response("Not found", { status: 404 });
  return cardImage(profile.summary, profile.profile.handle, profile.standing ?? null);
}
