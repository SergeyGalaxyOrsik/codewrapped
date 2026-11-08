# Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifests first, so dependency installs are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY packages/brand/package.json packages/brand/
COPY packages/card/package.json packages/card/
COPY packages/parser/package.json packages/parser/
COPY packages/stats/package.json packages/stats/
RUN pnpm install --frozen-lockfile --filter "@codewrapped/api..."

COPY packages/stats packages/stats
COPY apps/api apps/api
RUN pnpm --filter @codewrapped/api build \
 && pnpm --filter @codewrapped/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# Runs database migrations, then serves.
CMD ["node", "dist/main.js"]
