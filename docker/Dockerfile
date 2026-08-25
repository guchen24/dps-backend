FROM node:24-bookworm-slim AS build

ARG DSH_CLIENT_COMMIT_HASH=b150a55

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
# The official build embeds this pinned upstream baseline in browser artifacts.
# Passing an explicit value keeps source images reproducible without copying
# Git metadata into the build context.
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

WORKDIR /opt/dps

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.7.0 --activate

COPY . .

RUN --mount=type=cache,id=dps-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

# Loader plugins are selected dynamically from the composed Host tree. pnpm's
# isolated workspace links are package-local, so expose the official workspace
# packages at the root resolution boundary used by that dynamic loader.
RUN node docker/support/link-runtime-workspaces.mjs

# This produces Host artifacts first, then generated Client/Typert contracts,
# then the Vite Web UI. It is deliberately not replaced by a Vite-only build.
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssh-client \
    python3 \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV DSH_HOME=/home/dsh/.dsh
ENV HOME=/workspace
ENV NODE_ENV=production

# Preserve the upstream node UID/GID (1000) so the existing named volume stays
# writable while exposing a deployment-specific, non-root service account.
RUN usermod -l dsh -d /home/dsh -m node \
  && groupmod -n dsh node \
  && mkdir -p "${DSH_HOME}" \
  && chown -R dsh:dsh /home/dsh

WORKDIR /opt/dps
COPY --from=build --chown=dsh:dsh /opt/dps /opt/dps
COPY --chmod=755 docker/support/entrypoint.sh /usr/local/bin/dps-entrypoint

WORKDIR /workspace
USER dsh

EXPOSE 3080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dps-entrypoint"]
CMD ["web", "--patch", "/opt/dps/docker/support/web.cordis.patch.yml", "--no-open", "--port", "3080"]
