#!/usr/bin/env bash
# Bramka przed commitem (CLAUDE.md): serwer (fmt, clippy, testy, wydanie), stos testowy (smoke + dane), e2e UI.
# Kod wyjścia 0 = zielono. Playwright: PLAYWRIGHT_DIR albo tests/local.env.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step "serwer: cargo fmt --check, clippy, test, build --release"
(cd server && cargo fmt --check && cargo clippy --all-targets -q -- -D warnings && cargo test -q && cargo build --release -q)

step "stos testowy: up (smoke mostu i panelu)"
tests/stack.sh up

step "stos testowy: seed"
tests/stack.sh seed

step "e2e UI"
tests/stack.sh test

printf '\nbramka: zielono\n'
