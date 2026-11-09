import { PERIODS, type Period } from "@codewrapped/stats";
import { getProfile, parseHandle } from "@/lib/api";
import { cardImage } from "@/lib/og";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=0, s-maxage=60" } });

// One URL per card, so extra or repeated query params cannot bypass the CDN cache.
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const handle = parseHandle((await params).handle);
  if (!handle) return notFound();
  const url = new URL(req.url);
  const requested = url.searchParams.get("period") as Period;
  const period = PERIODS.includes(requested) ? requested : "30d";
  const canonical = `/api/og/${handle}?period=${period}`;
  if (url.pathname + url.search !== canonical) {
    return new Response(null, { status: 308, headers: { location: canonical, "cache-control": "public, max-age=3600, s-maxage=86400" } });
  }
  const profile = await getProfile(handle, period);
  if (!profile) return notFound();
  return cardImage(profile.summary, profile.profile.handle, profile.standing ?? null);
}
