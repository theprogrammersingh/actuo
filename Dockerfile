# The deploy image — one process serving /api (Nest) and everything else
# (Angular SSR), exactly as `server.mjs` composes them locally.
#
# WHY A DOCKERFILE AND NOT A BUILDPACK. Firebase App Hosting could not build this
# repository three times over, each for a different reason inside its Node
# buildpack and none reproducible locally:
#
#   1. It reads `engines.pnpm` as a RANGE and installs the highest match while
#      ignoring `packageManager`, so `">=10"` selected pnpm 12 — whose branch in
#      the buildpack launches the standalone binary from `bin/dist/pnpm.mjs`, a
#      path that exists only in the npm package layout. MODULE_NOT_FOUND.
#   2. Capped at pnpm 9, `pnpm install` died with "Cannot convert undefined or
#      null to object" in ~314ms, before any network fetch — firebase-tools#10435,
#      filed for pnpm monorepos and CLOSED AS NOT PLANNED.
#   3. Migrated to npm, the install finally succeeded and the *build* failed:
#      `npm run build --workspace=@actuo/shared` reported "No workspaces found"
#      in the builder's tree, though it resolves everywhere else.
#
# All three are the builder disagreeing with a workspace monorepo. A Dockerfile
# ends the category: the build is the same commands that run locally, on an image
# we pin. `server.mjs` needed no change for any of this — it is a plain Node
# server that reads $PORT and binds 0.0.0.0, which is why it runs unmodified on
# Render (see render.yaml), Cloud Run, Fly, or anything else that takes an image.

# ---------------------------------------------------------------------------
# builder — full image on purpose: argon2 and @swc/core are native, and the slim
# image has no python3/make/g++ to fall back on when a prebuild is missing.
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS builder

WORKDIR /app
ENV CI=true

# corepack installs the exact pnpm named in package.json `packageManager`,
# integrity hash included. Pinning it here as well is how the two drift.
RUN corepack enable

# Manifests before sources: this layer is the slow one (a full dependency
# install) and it must not be invalidated by an edit to a component.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json   shared/
COPY backend/package.json  backend/
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile

COPY . .

# PUBLIC_ORIGIN is BUILD-time, not runtime: the public pages are prerendered, so
# `<loc>`, `og:image` and `canonical` are decided before this layer finishes.
# Unset, scripts/stamp-seo.mjs leaves every URL root-relative and still valid.
# On Render this arrives without a --build-arg flag: Render translates a service
# environment variable of the same name into a build argument, which is why
# render.yaml can declare it alongside the runtime ones.
ARG PUBLIC_ORIGIN=""
ENV PUBLIC_ORIGIN=${PUBLIC_ORIGIN}

# shared -> backend -> frontend, then the SEO stamp. A missing shared/dist shows
# up as TS2307 in both consumers at once.
RUN pnpm run build

# NO `pnpm prune --prod` HERE, deliberately. It was tried: in a workspace it
# prompts ("modules directories will be removed and reinstalled from scratch")
# and then leaves @angular/cli and typescript in place anyway, so it costs a
# rebuild and buys nothing. The runtime stage therefore copies the full tree.
# That is a larger image in exchange for a step that cannot silently half-work —
# the wrong trade only if image size starts to matter, which for a single
# always-on web service it does not.

# ---------------------------------------------------------------------------
# runner — slim, no toolchain, no sources.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# NODE_ENV=production is read by EnvService.converterUrl, which drops its
# development default here. A deploy names the converter it trusts through
# CONVERTER_URL rather than inheriting one; unset, the converter surfaces say
# so instead of framing a third party nobody chose.
ENV NODE_ENV=production
ENV PORT=8080

# Angular 21 checks the Host header against an allowlist (SSRF protection) and
# off the list it does NOT error — it silently falls back to client-side
# rendering, discarding the SSR and structured-data work in PRD §8.5. This is a
# fallback for running the image bare; the deploy sets the real list (render.yaml
# does). Verify with: the HTML for `/` contains `ng-server-context`.
ENV NG_ALLOWED_HOSTS="*.onrender.com,*.run.app,localhost"

# pnpm's node_modules is a tree of symlinks into node_modules/.pnpm, so the
# store has to come across whole and with links preserved. shared/ is copied in
# full because node_modules/@actuo/shared is a symlink to it.
COPY --from=builder /app/node_modules          ./node_modules
COPY --from=builder /app/shared                ./shared
COPY --from=builder /app/backend/dist          ./backend/dist
COPY --from=builder /app/backend/node_modules  ./backend/node_modules
COPY --from=builder /app/frontend/dist         ./frontend/dist
COPY --from=builder /app/package.json          ./package.json
COPY --from=builder /app/server.mjs            ./server.mjs

# frontend/node_modules is deliberately absent: the built Angular SSR bundle is
# self-contained (only `node:` imports, Express bundled in) and serves
# dist/browser itself.

USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
