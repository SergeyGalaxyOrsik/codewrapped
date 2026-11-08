import { getProfile } from "@/lib/api";
import { cardImage } from "@/lib/og";
import { exampleSummary } from "@/lib/sample";

export const alt = "A codewrapped card: tokens, hours, repositories and tools from coding agent logs";
export const size = { width: 1200, height: 675 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  const handle = process.env.NEXT_PUBLIC_HERO_HANDLE;
  const profile = handle ? await getProfile(handle, "30d").catch(() => null) : null;
  if (profile) return cardImage(profile.summary, profile.profile.handle);
  return cardImage(exampleSummary(new Date().toISOString().slice(0, 10)), null);
}
