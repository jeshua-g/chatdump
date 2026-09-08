FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY app ./app
COPY components ./components
COPY next.config.ts tsconfig.json next-env.d.ts ./
RUN npm install && npm run build && npm prune --omit=dev
ENV DATA_DIR=/data
ENV PORT=3000
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.mjs"]
