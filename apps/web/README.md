# codewrapped web

Next.js (App Router) and Tailwind. Pages:

| Path | What it is |
|---|---|
| `/` | Landing. The hero card is `NEXT_PUBLIC_HERO_HANDLE`'s live card, or a labelled example. |
| `/@handle`, `/@handle/7d` | Public profile. Rewritten to `/u/[handle]/[period]` because an `@` folder means a parallel route in the App Router. Rendered on first request and cached for 60 seconds (ISR). `expireTime` in `next.config.ts` caps how long a stale copy can be served, so the periods of one profile never drift far apart. |
| `/leaderboard`, `/leaderboard/month/tokens` | Weekly and monthly boards, cached for 60 seconds (ISR). Your own rank above the table is fetched in the browser. |
| `/settings` | Visibility toggles, connected computers, delete data, delete account. Client-side, calls the API with the session cookie. |
| `/device?code=ABCD-1234` | Approves a CLI login. |
| `/api/og/[handle]?period=30d` | The card as a PNG for link previews, rendered with `next/og` from `packages/card`. Any other query string redirects (308) to that one URL, so the CDN keeps one copy per card. |

Colors, fonts and the mark come from `packages/brand`. `pnpm prepare-brand` copies them into `public/fonts`, `app/brand.css` and `app/icon.svg`; it runs before `dev` and `build`, and those files are not committed.

On phones the profile shows the story card (1080x1920); from the `sm` breakpoint up it shows the landscape card.

## Local development

Run the API first (see `apps/api/README.md`), then:

```sh
NEXT_PUBLIC_API_URL=http://localhost:3000 NEXT_PUBLIC_SITE_URL=http://localhost:3001 pnpm --filter @codewrapped/web dev
```

Cookies are per host, not per port, so a session from `localhost:3000` works on `localhost:3001`.

## Deploy on Vercel

1. Import the repository. Set **Root Directory** to `apps/web`. Vercel detects Next.js and pnpm.
2. Leave the build and install commands as detected. The build runs `pnpm prepare-brand && next build`.
3. Environment variables, for Production and Preview:
   - `NEXT_PUBLIC_API_URL=https://api.codewrapped.app`
   - `NEXT_PUBLIC_SITE_URL=https://codewrapped.app`
   - `NEXT_PUBLIC_HERO_HANDLE=` your handle, once your profile has data (optional)
   - `NEXT_PUBLIC_AUTHOR_X_HANDLE=` your X handle, for the footer link (optional)
4. Add the domains `codewrapped.app` and `www.codewrapped.app`. Make the apex the primary domain and set `www` to **No redirect**: the app itself answers `www` with a 301 to `codewrapped.app`. If Vercel still redirects the apex to `www`, the two redirects loop.

Preview deployments run on `*.vercel.app`, which does not share cookies with `api.codewrapped.app`, so sign-in only works on the production domain. Public pages and OG images work everywhere.
