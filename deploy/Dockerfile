# Chog World Order: Chog Cult, Chog City and Chog Soul in one Node process (cult/), with City's code and UI
# from city/. Build context: the repository root (see compose.yaml). No secrets are baked in: settings come
# from deploy/.env at run time.
FROM node:24.19.0-bookworm-slim

WORKDIR /app

# Dependencies first, so a code change reuses this layer. Dev dependencies are needed to typecheck and build.
COPY cult/package.json cult/package-lock.json cult/
COPY city/package.json city/package-lock.json city/
RUN npm ci --prefix cult --no-audit --no-fund && npm ci --prefix city --no-audit --no-fund

COPY cult cult
COPY city city
COPY deployments/manifests/monad-mainnet.json deployments/manifests/monad-mainnet.json

# Typecheck the server with City's code, then build the UIs: / and /cult/ (cult/web) and /city/ (City's server build).
RUN npm --prefix cult run typecheck \
  && npm --prefix cult run web:build \
  && npm --prefix city run build:server

USER node
WORKDIR /app/cult
ENV CULT_HOST=0.0.0.0 \
    PORT=8787 \
    CULT_MANIFEST_PATH=/app/deployments/manifests/monad-mainnet.json
EXPOSE 8787

# The first start reads ownership from the adapter's activation block onward, so give it time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15m --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "--import", "tsx", "src/cli/serveLive.ts"]
