# NetWars: the built game and its online server (one Node process on port 8787). Run it with compose.yaml.

FROM node:24.22.1-alpine AS base
WORKDIR /app
RUN npm install --global pnpm@9.12.3
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
# the server runs these TypeScript files as they are (Node strips the types)
COPY server ./server
COPY src ./src
COPY public/models ./public/models
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "server/main.ts"]
