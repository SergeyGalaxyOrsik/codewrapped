import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { DEFAULT_VISIBILITY, type DailyAggregate, type Visibility } from "@codewrapped/stats";

export { DEFAULT_VISIBILITY, type Visibility };

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---- Better Auth tables. Field names follow Better Auth's model. ----

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** GitHub login at sign up, used for the first handle. */
  githubLogin: text("github_login"),
  ...timestamps,
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

// ---- codewrapped tables ----

export const profiles = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lowercase. Starts as the GitHub login and can be changed once. */
    handle: text("handle").notNull(),
    handleChangedAt: timestamp("handle_changed_at", { withTimezone: true }),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    /** IANA timezone of the last sync, so "last 30 days" ends on the user's today. */
    timeZone: text("time_zone").notNull().default("UTC"),
    visibility: jsonb("visibility").$type<Visibility>().notNull().default(DEFAULT_VISIBILITY),
    ...timestamps,
  },
  (t) => [uniqueIndex("profiles_handle_unique").on(sql`lower(${t.handle})`)],
);

export const cliTokens = pgTable(
  "cli_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    machineLabel: text("machine_label").notNull(),
    machineId: text("machine_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("cli_tokens_user").on(t.userId)],
);

export type DeviceStatus = "pending" | "approved" | "denied" | "consumed";

export const deviceCodes = pgTable("device_codes", {
  /** SHA-256 of the device code the CLI polls with. */
  deviceCodeHash: text("device_code_hash").primaryKey(),
  /** Shown to the user, ABCD-1234. */
  userCode: text("user_code").notNull().unique(),
  status: text("status").$type<DeviceStatus>().notNull().default("pending"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  machineLabel: text("machine_label").notNull(),
  machineId: text("machine_id"),
  intervalSeconds: integer("interval_seconds").notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyStats = pgTable(
  "daily_stats",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    machineId: text("machine_id").notNull(),
    source: text("source").$type<DailyAggregate["source"]>().notNull(),
    day: date("day").notNull(),
    data: jsonb("data").$type<DailyAggregate>().notNull(),
    schemaVersion: integer("schema_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.machineId, t.source, t.day] }), index("daily_stats_user_day").on(t.userId, t.day)],
);

export const authSchema = { user: users, session: sessions, account: accounts, verification: verifications };
