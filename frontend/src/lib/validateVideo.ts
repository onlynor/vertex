const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi"];
const MAX_SIZE_BYTES = 100 * 1024 * 1024;
const MIN_DURATION_SEC = 3;
const MAX_DURATION_SEC = 60;

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateFormatAndSize(file: File): ValidationResult {
  const name = file.name.toLowerCase();
  const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!hasAllowedExt) {
    return { ok: false, message: "仅支持 MP4 / MOV / AVI / WebM 格式视频" };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, message: "视频文件过大，请上传不超过 100MB 的视频" };
  }
  return { ok: true };
}

export function validateDuration(durationSec: number): ValidationResult {
  if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
    return {
      ok: false,
      message: `视频时长应在 ${MIN_DURATION_SEC} 秒 ~ ${MAX_DURATION_SEC} 秒之间（当前约 ${Math.round(durationSec)} 秒），建议 20~30 秒`,
    };
  }
  return { ok: true };
}

/**
 * 浏览器无法解码所有我们接受的封装格式，尤其是 AVI 在 Chrome 和 Firefox 中
 * 都没有原生播放支持。遇到这种情况解析为 null 而不是直接拒绝：服务端会用
 * ffprobe 探测时长，那才是权威校验，因此一个“浏览器放不了但本身合法”的文件
 * 仍然可以正常通过。
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";

    const finish = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    videoEl.onloadedmetadata = () =>
      finish(Number.isFinite(videoEl.duration) ? videoEl.duration : null);
    videoEl.onerror = () => finish(null);
    // 有些封装格式会卡住而不是报错，超时兜底，避免上传按钮一直转圈。
    setTimeout(() => finish(null), 4000);

    videoEl.src = url;
  });
}

/** 判断浏览器是否大概率能为此文件渲染预览。 */
export function isPreviewable(file: File): boolean {
  const name = file.name.toLowerCase();
  return [".mp4", ".webm", ".mov"].some((ext) => name.endsWith(ext));
}
