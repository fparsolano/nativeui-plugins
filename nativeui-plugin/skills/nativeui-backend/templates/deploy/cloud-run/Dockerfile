# syntax=docker/dockerfile:1
# NativeUI backend — Cloud Run container (Node/Hono stack).
# Cloud Run sends traffic to $PORT (default 8080) and health-checks the listening socket.
# The server reads PORT from env — never hardcode it. See DEPLOY.md.
#
# ── Python (FastAPI) variant ────────────────────────────────────────────────
# Replace both stages with a single stage:
#   FROM python:3.13-slim
#   WORKDIR /app
#   COPY requirements.txt .            # or pyproject.toml + poetry export
#   RUN pip install --no-cache-dir -r requirements.txt
#   COPY . .
#   ENV PORT=8080
#   CMD ["sh","-c","uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
# ─────────────────────────────────────────────────────────────────────────────

# ---- build: install deps + compile (no-op for plain JS, real for TS) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present

# ---- runtime: prod deps only, non-root, slim ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app .
# Cloud Run injects PORT (8080). The server must listen on 0.0.0.0:$PORT.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
