FROM node:24-alpine AS build
WORKDIR /src/app
ARG VITE_TIANDITU_TOKEN
ARG VITE_PLATFORM_URL
ENV VITE_TIANDITU_TOKEN=$VITE_TIANDITU_TOKEN
ENV VITE_PLATFORM_URL=$VITE_PLATFORM_URL
COPY app/package.json app/package-lock.json ./
COPY app/apps ./apps
COPY app/packages ./packages
COPY app/tsconfig.json app/tsconfig.base.json app/postcss.config.js app/tailwind.config.ts app/vitest.config.ts ./
COPY docs /src/docs
RUN npm ci
RUN npm run generate:api \
    && npm run build --workspace @thcpn/platform \
    && npm run build --workspace @thcpn/admin

FROM nginx:1.29-alpine AS platform
COPY --from=build /src/app/apps/platform/dist /usr/share/nginx/html
COPY app/deploy/nginx-platform.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM nginx:1.29-alpine AS admin
RUN mkdir -p /usr/share/nginx/html/admin
COPY --from=build /src/app/apps/admin/dist /usr/share/nginx/html/admin
COPY app/deploy/nginx-admin.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
