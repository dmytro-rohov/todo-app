# syntax=docker/dockerfile:1
#
# Mytko Tasks: Express API + static frontend in one image.
# Build:  docker build --build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest> -t mytko-tasks:<git-sha> .
# The same image runs the app (default CMD) and migrations (node backend/migrate.js).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- frontend stylesheet ----------------------------------------------------
FROM ${NODE_IMAGE} AS css
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/styles/ ./styles/
RUN npm run build:css

# ---- backend production dependencies ----------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- assemble read-only application tree ------------------------------------
FROM ${NODE_IMAGE} AS assemble
WORKDIR /out
COPY backend/package.json backend/*.js backend/
COPY backend/routes/ backend/routes/
COPY backend/drizzle/ backend/drizzle/
COPY backend/scripts/ backend/scripts/
COPY --from=deps /build/backend/node_modules/ backend/node_modules/
COPY frontend/index.html frontend/
COPY frontend/js/ frontend/js/
COPY frontend/icons/ frontend/icons/
COPY frontend/manifest.webmanifest frontend/sw.js frontend/
COPY --from=css /build/frontend/dist/ frontend/dist/
# Owned by root, readable by everyone, writable by nobody else: the runtime
# user cannot modify application code.
RUN chown -R root:root /out && chmod -R u=rwX,go=rX /out

# ---- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.title="mytko-tasks" \
      org.opencontainers.image.revision="${GIT_REVISION}"

# Package managers are not needed at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/frontend

WORKDIR /app
COPY --from=assemble /out/ /app/

# Built-in unprivileged user of the official Node image (uid/gid 1000).
USER node

EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "backend/scripts/healthcheck.js"]

CMD ["node", "backend/server.js"]
