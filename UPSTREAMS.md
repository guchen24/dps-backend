# Upstream policy

`dps-backend` is a public dps overlay over the MIT-licensed
`deepseek-ai/deepseek-harness` source tree.

| Role | Source | Pinned revision |
| --- | --- | --- |
| Product source | `deepseek-ai/deepseek-harness` | `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Docker reference | `runzhliu/deepseek-harness-docker` | `42c44a9c618ccb121e2f836856e05922b2633474` |

The Docker project is a community reference, not an official DeepSeek image or
Compose distribution. This repository builds the image from its own source.

When upgrading Harness, refresh `apps/`, `packages/`, and the pnpm lockfile from
the selected upstream baseline, preserve the `docker/` deployment overlay, run
the complete build/typecheck/test gates, and verify the local Docker health
endpoint before publishing.

The companion Tauri shell is maintained separately at
https://github.com/guchen24/dps-frontend.
