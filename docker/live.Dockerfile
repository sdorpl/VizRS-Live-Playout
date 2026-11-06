# Panel VizRS Live: statyczna binarka musl w obrazie scratch (jak VizRS CG System).
# Budowa (z katalogu repozytorium): docker build -f docker/live.Dockerfile -t vizrs-live .
FROM rust:1-alpine AS build
WORKDIR /src
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/web ./web
RUN cargo build --release --locked && cp target/release/vizrs-live /vizrs-live && /vizrs-live --version

FROM scratch
COPY --from=build /vizrs-live /vizrs-live
USER 10001:10001
ENV VIZRS_LIVE_BIND=0.0.0.0 \
    VIZRS_LIVE_PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 CMD ["/vizrs-live", "--healthcheck"]
ENTRYPOINT ["/vizrs-live"]
