FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/client/package.json ./packages/client/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @calendar-genie/shared && npm run build -w @calendar-genie/client

FROM nginx:1.27-alpine AS runtime
COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/client/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
