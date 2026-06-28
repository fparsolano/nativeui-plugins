# syntax=docker/dockerfile:1
# NativeUI backend — self-hosted on a VPS (Node/Hono). Identical to ../cloud-run/Dockerfile.
# Python variant: see the note in ../cloud-run/Dockerfile.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app .
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "src/index.js"]
