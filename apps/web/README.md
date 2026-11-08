# codewrapped web

Next.js (App Router) and Tailwind. Pages:

| Path | What it is |
|---|---|
| `/` | Landing. The hero card is `NEXT_PUBLIC_HERO_HANDLE`'s live card, or a labelled example. |
| `/@handle`, `/@handle/7d` | Public profile. Rewritten to `/u/[handle]/[period]` because an `@` folder means a parallel route in the App Router. Rendered on first request and cached for 60 seconds (ISR). |
| `/settings` | Visibility toggles, connected computers, delete data, delete account. Client-side, calls the API with the session cookie. |
| `/device?code=ABCD-1234` | Approves a CLI login. |
| `/api/og/[handle]?period=30d` | The card as a PNG for link previews, rendered with `next/og` from `packages/card`. |

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
4. Add the domain `codewrapped.app`.

Preview deployments run on `*.vercel.app`, which does not share cookies with `api.codewrapped.app`, so sign-in only works on the production domain. Public pages and OG images work everywhere.
