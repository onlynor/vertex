import { SoccerBall } from "./Football";

/**
 * 品牌标识组合，定义一次，保证侧边栏、移动端页头与登录主视觉之间
 * 的文字标识不会走样。
 *
 * VERTEX（拉丁字母标识）· 跃界（中文名）· AI Football Performance Analysis
 */

export const BRAND = {
  latin: "VERTEX",
  chinese: "跃界",
  tagline: "AI Football Performance Analysis",
  taglineZh: "AI 足球训练分析",
} as const;

/** 仅文字标识，用于旁边已经放了足球图标的场景。 */
export function Wordmark({
  className = "",
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const latin = tone === "light" ? "text-white" : "text-slate-900";
  const cn = tone === "light" ? "text-slate-300" : "text-slate-500";
  return (
    <span className={`flex items-baseline gap-1.5 ${className}`}>
      <span className={`font-semibold tracking-[0.14em] ${latin}`}>{BRAND.latin}</span>
      <span className={`text-[0.82em] ${cn}`}>{BRAND.chinese}</span>
    </span>
  );
}

/** 足球 + 文字标识，页头与侧边栏的标准组合。 */
export function BrandLockup({
  size = "md",
  tone = "light",
  className = "",
}: {
  size?: "sm" | "md";
  tone?: "light" | "dark";
  className?: string;
}) {
  const ball = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const text = size === "sm" ? "text-[13.5px]" : "text-[15px]";
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <SoccerBall className={ball} />
      <Wordmark className={`display-tight ${text}`} tone={tone} />
    </span>
  );
}
