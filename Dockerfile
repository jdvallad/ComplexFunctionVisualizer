# =============================================================================
# Multi-stage hardened Docker image for Complex & Real Function Visualizer
#
# Default build (public-safe for Unraid / public web — NO clang in final image):
#   docker build -t complex-visualizer:latest .
#
# Optional build with token-protected Live C Compiler enabled:
#   docker build --build-arg WITH_CLANG=1 -t complex-visualizer:compiler .
# =============================================================================

# --- Stage 1: Native C11 Builder ---
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    clang \
    make \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY Makefile *.c *.h ./
RUN make visualizer && make test

# --- Stage 2: Minimal Hardened Runtime ---
FROM debian:bookworm-slim AS runtime

ARG WITH_CLANG=0

RUN if [ "$WITH_CLANG" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends clang libc6-dev curl && \
      rm -rf /var/lib/apt/lists/*; \
    else \
      apt-get update && apt-get install -y --no-install-recommends curl && \
      rm -rf /var/lib/apt/lists/*; \
    fi \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin cfv

WORKDIR /app
COPY --from=builder /src/visualizer /app/visualizer
COPY web/ /app/web/
# Copy public headers so optional WITH_CLANG=1 hot-compilation can #include them
COPY complex_math.h real_math.h /app/

RUN chown -R cfv:cfv /app

USER cfv

ENV CFV_HOST=0.0.0.0 \
    CFV_PORT=1738 \
    CFV_WEB_DIR=/app/web \
    CFV_ENABLE_COMPILE=0

EXPOSE 1738

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${CFV_PORT}/healthz || exit 1

ENTRYPOINT ["/app/visualizer"]
