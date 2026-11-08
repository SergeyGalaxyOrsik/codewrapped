import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "./config";
import type { Db } from "./db";
import { authSchema } from "./db/schema";
import { ensureProfile } from "./lib/profiles";

/** GitHub sign-in only. Sessions are cookies shared by the web and API subdomains. */
export function createAuth(db: Db, config: Config) {
  const secure = config.apiUrl.startsWith("https://");
  return betterAuth({
    baseURL: config.apiUrl,
    basePath: "/auth",
    secret: config.authSecret,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    trustedOrigins: [config.webUrl],
    user: {
      additionalFields: {
        githubLogin: { type: "string", required: false, input: false },
        githubCreatedAt: { type: "date", required: false, input: false },
      },
    },
    socialProviders: {
      github: {
        clientId: config.github.clientId,
        clientSecret: config.github.clientSecret,
        mapProfileToUser: (profile) => ({
          githubLogin: profile.login,
          githubCreatedAt: profile.created_at ? new Date(profile.created_at) : undefined,
        }),
      },
    },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax" },
      ...(config.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: config.cookieDomain } } : {}),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensureProfile(db, {
              id: user.id,
              name: user.name,
              image: user.image ?? null,
              githubLogin: typeof user.githubLogin === "string" ? user.githubLogin : null,
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
