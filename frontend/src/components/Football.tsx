import ballImage from "../assets/ball.png";

/**
 * 足球视觉组件集。足球图片使用品牌自带的素材；其余图形全部为内联 SVG，
 * 可以自由缩放并跟随主题换色。
 */

/**
 * 项目的足球 Logo。它以位图形式提供，因为自带的 .svg 文件实际上是把 PNG
 * 包在 <svg> 标签里（没有矢量路径），体积还多出约 33%。导出尺寸为 256px，
 * 是屏幕最大用法的 2 倍。
 */
export function SoccerBall({ className = "h-10 w-10" }: { className?: string }) {
  return <img src={ballImage} alt="" className={`select-none object-contain ${className}`} />;
}

/** 完整的球场标线，用作主视觉区域背后的背景水印。 */
export function PitchMarkings({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 600 380"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect x="12" y="12" width="576" height="356" rx="2" />
      <path d="M300 12v356" />
      <circle cx="300" cy="190" r="66" />
      <circle cx="300" cy="190" r="4" fill="currentColor" stroke="none" />
      {/* 禁区 */}
      <rect x="12" y="86" width="96" height="208" />
      <rect x="492" y="86" width="96" height="208" />
      <rect x="12" y="140" width="36" height="100" />
      <rect x="552" y="140" width="36" height="100" />
      <path d="M108 148a66 66 0 0 0 0 84" />
      <path d="M492 148a66 66 0 0 1 0 84" />
      {/* 角球弧 */}
      <path d="M12 30a18 18 0 0 0 18-18" />
      <path d="M588 30a18 18 0 0 1-18-18" />
      <path d="M12 350a18 18 0 0 1 18 18" />
      <path d="M588 350a18 18 0 0 0-18 18" />
    </svg>
  );
}

/** 球网纹理，用作卡片和页头的底纹。 */
export function NetPattern({
  id,
  className = "",
  spacing = 14,
}: {
  id: string;
  className?: string;
  spacing?: number;
}) {
  return (
    // width/height 必不可少：两者都缺失的 <svg> 会回退到 300x150 的固有尺寸，
    // 只靠 absolute inset-0 无法把它拉伸铺满。
    <svg className={className} width="100%" height="100%" aria-hidden>
      <defs>
        <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          <path
            d={`M0 0 L${spacing} ${spacing} M${spacing} 0 L0 ${spacing}`}
            stroke="currentColor"
            strokeWidth="0.8"
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** 风格化的球员射门图形，参考设计中的横幅主图案。 */
export function PlayerKick({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 220 200" fill="none">
      <g
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* 躯干 */}
        <path d="M112 62 L96 106" />
        {/* 前臂向前摆，后臂向后甩 */}
        <path d="M110 72 L142 60 L152 44" />
        <path d="M104 76 L74 86 L62 76" />
        {/* 支撑腿 */}
        <path d="M96 106 L88 146 L74 156" />
        {/* 摆腿踢向足球 */}
        <path d="M100 106 L140 122 L158 136" />
      </g>
      <circle cx="118" cy="44" r="16" fill="currentColor" />
      <circle cx="184" cy="150" r="21" fill="currentColor" opacity="0.55" />
      {/* 射门动作后方的运动弧线 */}
      <g stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.35">
        <path d="M44 118 h30" />
        <path d="M30 138 h44" />
        <path d="M50 158 h26" />
      </g>
    </svg>
  );
}

/** 弹跳的足球与压扁的阴影，用于“分析中”状态的加载动画。 */
export function BouncingBall({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="flex h-20 items-end justify-center">
        <SoccerBall className="ball-bounce h-12 w-12" />
      </div>
      <div className="ball-shadow mx-auto h-2 w-12 rounded-[50%] bg-slate-900/15" />
    </div>
  );
}

/** 细条球场纹样带，用来给普通卡片增添草坪质感。 */
export function TurfStripes({ className = "" }: { className?: string }) {
  return (
    <div className={`flex ${className}`} aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`flex-1 ${i % 2 === 0 ? "bg-emerald-500/[0.07]" : "bg-transparent"}`}
        />
      ))}
    </div>
  );
}
