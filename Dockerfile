# One image, one process: the Node server that serves the landing page, the
# lobby, the game tables, chat and bots. Run exactly ONE container of it.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# PUBLIC_URL is baked into the static SEO pages (canonical links, sitemap).
ARG PUBLIC_URL=""
ENV PUBLIC_URL=$PUBLIC_URL
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8000
CMD ["node", "build/server.cjs"]
