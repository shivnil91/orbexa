# syntax=docker/dockerfile:1
# Multi-arch (linux/amd64 and linux/arm64). No secrets are build arguments.

FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY services/api/package.json services/api/package.json
RUN pnpm install --frozen-lockfile --filter @orbexa/web...

FROM deps AS build
COPY apps/web apps/web
COPY packages/db packages/db
RUN pnpm --filter @orbexa/web build

# pg is pure JavaScript. 8.23.1 is the version pinned in pnpm-lock.yaml.
FROM node:22-bookworm-slim AS pgdeps
WORKDIR /opt/pg
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts pg@8.23.1

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=43124
WORKDIR /app
RUN groupadd --gid 10001 orbexa \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin orbexa
COPY --from=build --chown=orbexa:orbexa /app/apps/web/.next/standalone ./
COPY --from=build --chown=orbexa:orbexa /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=orbexa:orbexa /app/apps/web/public ./apps/web/public
COPY --from=build --chown=orbexa:orbexa /app/apps/web/src/data ./apps/web/src/data
COPY --chown=orbexa:orbexa apps/web/docker ./apps/web/docker
# Node ESM does not consult NODE_PATH. pg has to sit next to the entrypoint.
COPY --from=pgdeps --chown=orbexa:orbexa /opt/pg/node_modules ./apps/web/docker/node_modules
COPY --chown=orbexa:orbexa apps/web/src/lib/database-url.ts apps/web/src/lib/live-key.ts ./apps/web/src/lib/
COPY --chown=orbexa:orbexa packages/db/src/apply-migrations.ts packages/db/src/migrations.ts ./packages/db/src/
COPY --chown=orbexa:orbexa packages/db/migrations ./packages/db/migrations
USER orbexa
EXPOSE 43124
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||43124)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/apps/web/docker/container-main.mjs"]
CMD ["serve"]
