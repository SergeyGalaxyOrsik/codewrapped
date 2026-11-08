import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Public site, for CORS and links. https://codewrapped.app */
  WEB_URL: z.url(),
  /** This API's public URL, for auth callbacks. https://api.codewrapped.app */
  API_URL: z.url(),
  /** Cookie domain shared by web and API, with a leading dot: .codewrapped.app. Empty for localhost. */
  COOKIE_DOMAIN: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
});

export type Config = {
  databaseUrl: string;
  port: number;
  webUrl: string;
  apiUrl: string;
  cookieDomain: string | null;
  authSecret: string;
  github: { clientId: string; clientSecret: string };
};

/** The site's origin plus its www or bare twin, so codewrapped.app and www.codewrapped.app both work. */
export function webOrigins(webUrl: string): string[] {
  const u = new URL(webUrl);
  if (u.hostname === "localhost" || /^[\d.]+$/.test(u.hostname)) return [u.origin];
  const twin = new URL(u.origin);
  twin.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
  return [u.origin, twin.origin];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Missing or invalid environment variables. See apps/api/.env.example.\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    webUrl: e.WEB_URL.replace(/\/$/, ""),
    apiUrl: e.API_URL.replace(/\/$/, ""),
    cookieDomain: e.COOKIE_DOMAIN?.trim() || null,
    authSecret: e.BETTER_AUTH_SECRET,
    github: { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET },
  };
}
