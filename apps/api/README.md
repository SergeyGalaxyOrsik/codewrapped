# codewrapped API

Hono on Node 22, Postgres with Drizzle, Better Auth with GitHub sign-in. Serves device login for the CLI, sync, public profiles and account settings.

## Endpoints

| Method | Path | Auth | What it does |
|---|---|---|---|
| GET | `/health` | none | Checks the database. Used by Dokploy. |
| GET, POST | `/auth/*` | none | Better Auth: GitHub sign-in, sessions, sign-out. |
| POST | `/cli/device` | none | Starts a CLI login. Returns `deviceCode`, `userCode`, `verifyUrl`, `interval`. 10 per 10 minutes per address. |
| POST | `/cli/token` | none | CLI polls with `deviceCode`. RFC 8628 errors until approved, then a token once. |
| GET | `/cli/device/:code` | session | Shows a pending login on the approval page. |
| POST | `/cli/device/:code/approve`, `/deny` | session | "Connect this computer", or decline. |
| DELETE | `/cli/token` | token | The CLI revokes its own token on logout. |
| POST | `/sync` | token | Upserts daily rows. 1 MB per request, 30 requests per 10 minutes per account, data from at most 10 computers and 20 harnesses per account. |
| GET | `/u/:handle?period=30d` | none | Public summary, filtered by the owner's visibility settings. Cached 5 minutes, dropped on sync and settings changes. |
| GET | `/me` | session | Profile, visibility, synced range. |
| PATCH | `/me/profile` | session | Display name; handle once. |
| PATCH | `/me/visibility` | session | `files`, `repos`, `cost`, `models`, `tools`, `heatmap`. |
| GET, DELETE | `/me/tokens`, `/me/tokens/:id` | session | Connected computers; revoke one. |
| DELETE | `/me/data` | session | Deletes all synced days. |
| DELETE | `/me` | session | Deletes the account and everything in it. |

Tokens are 256-bit random strings. Only their SHA-256 is stored. Device codes are stored the same way. An account keeps its 10 newest tokens: logging in on an eleventh computer disconnects the oldest. Expired device codes are deleted a day after they expire.

## Local development

```sh
docker run -d --name cw-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=codewrapped -p 5432:5432 postgres:16-alpine
cp apps/api/.env.example apps/api/.env   # fill in the values, see below
pnpm --filter @codewrapped/api dev
```

For localhost, set `WEB_URL=http://localhost:3001`, `API_URL=http://localhost:3000` and leave `COOKIE_DOMAIN` empty. Point the CLI at it with `CODEWRAPPED_API_URL=http://localhost:3000`.

Tests run on PGlite, an in-process Postgres, so they need no database: `pnpm --filter @codewrapped/api test`.

After changing `src/db/schema.ts`, run `pnpm --filter @codewrapped/api db:generate` and commit the new file in `drizzle/`.

## Deploy on Dokploy

First, a **GitHub OAuth App** at github.com/settings/developers -> New OAuth App:
- Homepage URL: `https://codewrapped.app`
- Authorization callback URL: `https://api.codewrapped.app/auth/callback/github`

Then point the DNS A record of `api.codewrapped.app` at the Dokploy server, and pick one of the two setups below.

### Option A: Docker Compose (API and Postgres together)

`docker-compose.yml` in this folder runs the API and Postgres 16 as one stack. Postgres is only on the stack's internal network; the API is reachable through Dokploy's Traefik.

1. In a Dokploy project, create a **Compose** service from this repository. Compose type: Docker Compose. Compose Path: `./apps/api/docker-compose.yml`.
2. **Environment** tab: paste `.env.compose.example` and fill in the values. Dokploy writes them to a `.env` file next to the compose file; the compose file passes them to the containers. A missing value stops the deploy with a message naming it.
3. **Domains** tab: add `api.codewrapped.app`, service `api`, container port `3000`, HTTPS on.
4. **Deploy.** The API waits for Postgres to be healthy, runs migrations and starts.
5. **Backups:** add a Volume Backup for the `pgdata` volume.

### Option B: separate Postgres service and Application

1. **Database.** In the Dokploy project, create a Postgres service (16 or newer). Copy its internal connection URL.
2. **Application.** Create an Application from this repository.
   - Build type: Dockerfile. Dockerfile path: `apps/api/Dockerfile`. Build context: the repository root (`.`).
   - Environment: every variable in `.env.example`. Generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32`.
   - Domain: `api.codewrapped.app`, container port `3000`, HTTPS on.
   - Health check path: `/health`.
3. **Deploy.** Migrations run on every start before the server listens. They are safe to run again.

Run one replica. The public summary cache and the sync rate limit live in memory; with more replicas they would need Redis.

### What the cookies look like

Sessions are set by `api.codewrapped.app` with `Domain=.codewrapped.app; Secure; HttpOnly; SameSite=Lax`, so the site at `codewrapped.app` sends them to the API. CORS allows only `WEB_URL`, with credentials.
