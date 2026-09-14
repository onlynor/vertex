# syntax=docker/dockerfile:1
# 后端镜像：编译成单个静态可执行文件，运行镜像里只额外装 ffmpeg（抽帧）和时区数据。
FROM golang:1.27-alpine AS build
# Go 模块代理、校验和数据库换成国内镜像，构建时不用连 proxy.golang.org / sum.golang.org。
# 不在国内网络时可以 --build-arg GOPROXY=https://proxy.golang.org 切回官方源。
ARG GOPROXY=https://goproxy.cn,https://proxy.golang.com.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY} \
    GOSUMDB=${GOSUMDB}
WORKDIR /src
COPY go.mod go.sum ./
# 缓存挂载：模块缓存独立存在构建缓存里，不算进镜像层，改代码重新构建时不用重新下载依赖。
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.20
# Alpine 官方源国内访问不稳定，换成阿里云镜像；同样可以 --build-arg APK_MIRROR=dl-cdn.alpinelinux.org 切回官方源。
ARG APK_MIRROR=mirrors.aliyun.com
RUN sed -i "s/dl-cdn.alpinelinux.org/${APK_MIRROR}/g" /etc/apk/repositories
# ffmpeg：从训练视频里抽帧；tzdata：让 TZ=Asia/Shanghai 生效，评价和报告按本地日期统计。
# ffmpeg 依赖上百个编解码库，第一次装要几分钟；这层在 COPY 源码之前，改代码重新构建本来就会
# 走 Docker 层缓存跳过它——这里的缓存挂载是为了基础镜像更新、`--no-cache` 全量重建这些
# 会让这层失效的情况，下载过的包不用重新拉一遍。
RUN --mount=type=cache,target=/var/cache/apk \
    ln -sf /var/cache/apk /etc/apk/cache && \
    apk update && \
    apk add ffmpeg tzdata
RUN adduser -D -u 10001 appuser
WORKDIR /app
COPY --from=build /out/server ./server
# 先建好目录再切用户：video_data 数据卷会沿用这里的属主，否则容器内写不进去。
RUN mkdir -p /app/tmp /app/data/videos && chown -R appuser:appuser /app
USER appuser
ENV VIDEO_TMP_DIR=/app/tmp \
    VIDEO_STORE_DIR=/app/data/videos \
    PORT=8080
EXPOSE 8080
ENTRYPOINT ["./server"]
