import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { schema, type Db } from "./db";
import { githubCreatedAt } from "./lib/github";

const config = loadConfig();
const client = postgres(config.databaseUrl, { max: 10 });
const db = drizzle(client, { schema }) as unknown as Db;

// Migrations run on every start; they are idempotent.
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
await migrate(drizzle(client), { migrationsFolder });

const auth = createAuth(db, config);
const app = createApp({
  db,
  webUrl: config.webUrl,
  authHandler: (req) => auth.handler(req),
  getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
  githubCreatedAt: (userId) => githubCreatedAt(db, userId),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`codewrapped api on :${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void client.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
