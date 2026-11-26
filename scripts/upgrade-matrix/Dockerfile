# Upgrade fixture matrix (issue #143).
# Built from a staged context that contains the monorepo packages (no host
# node_modules). Needs network at runtime for the npm registry.
FROM node:22-bookworm-slim

WORKDIR /w

# System tools used by npm pack / install
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the staged monorepo slice (see scripts/upgrade-matrix.sh).
COPY . /w/

ENV STAGEPASS_SKIP_PLATFORM_CHECK=1 \
    CI=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

# Install workspace deps and build loader/modules so local `npm pack` matches CI.
RUN npm ci \
  && npm run build

ENTRYPOINT ["node", "scripts/upgrade-matrix/run.mjs"]
CMD ["--target", "local"]
