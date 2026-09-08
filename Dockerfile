FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
RUN npm ci && npx esbuild src/server.ts --bundle --platform=node --format=esm --outfile=server.mjs --packages=external && npm prune --omit=dev
ENV DATA_DIR=/data
ENV PORT=3000
ENV CORS_ORIGIN=https://chat.jdump.com
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.mjs"]
