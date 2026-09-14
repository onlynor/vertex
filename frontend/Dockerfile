# syntax=docker/dockerfile:1
# 前端镜像：Bun 构建静态文件，Nginx 提供页面并把 /api 转给后端。
FROM oven/bun:1 AS build
# npm 源换成国内镜像，bun install 不用连 registry.npmjs.org；
# 不在国内网络时可以 --build-arg NPM_REGISTRY=https://registry.npmjs.org 切回官方源。
# 锁文件按包名+版本号记录完整性哈希、不绑定具体源地址，换源不影响版本一致性。
ARG NPM_REGISTRY=https://registry.npmmirror.com/
WORKDIR /src
COPY package.json bun.lock ./
# 缓存挂载：下载过的包缓存独立存在构建缓存里，改前端代码重新构建时不用重新下载依赖。
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --registry=${NPM_REGISTRY}
COPY . .
RUN bun run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
