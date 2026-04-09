FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/server/package.json ./packages/server/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @opencalendar/shared && npm run build -w @opencalendar/server

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY packages/server/package.json ./packages/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
EXPOSE 4000
CMD ["node", "packages/server/dist/index.js"]
