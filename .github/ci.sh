#!/usr/bin/env bash
# The Marquee CLI's secret-free suite, run from the tree's root: the mirror's CI and a local check run exactly this.
# pnpm-lock.yaml is derived from the private workspace's lockfile (scripts/marquee-cli-lockfile.mjs), so both resolve the same versions.
set -euo pipefail
cd "$(dirname "$0")/.."

cp mirror-pnpm-workspace.yaml pnpm-workspace.yaml
pnpm install --frozen-lockfile
pnpm test
