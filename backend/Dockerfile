# 后端镜像：编译成单个静态可执行文件，运行镜像里只额外装 ffmpeg（抽帧）和时区数据。
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.20
# ffmpeg：从训练视频里抽帧；tzdata：让 TZ=Asia/Shanghai 生效，评价和报告按本地日期统计。
RUN apk add --no-cache ffmpeg tzdata
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
