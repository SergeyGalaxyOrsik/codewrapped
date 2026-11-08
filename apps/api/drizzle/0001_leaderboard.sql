ALTER TABLE "daily_stats" ADD COLUMN "flag" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "leaderboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "x_handle" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "leaderboard_trusted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_created_at" timestamp with time zone;