import { useMemo, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PitchMarkings, SoccerBall } from "./Football";
import { IconClipboard, IconRadar, IconReport, IconScreen, IconUsers, IconVideo } from "./Icons";

/*
 * 首页「功能星图」：每个亮点是一个功能，外圈的小标签是常用操作，虚线是数据流向。
 * 老师第一次用时不知道功能在哪，看一眼这张图、点一下就能直达。
 * 节点是普通按钮（可以用键盘操作、读屏可读），连线画在下面的 SVG 里。
 */

type Point = [number, number];

interface Satellite {
  label: string;
  to: string;
  at: Point;
}

interface GalaxyNode {
  id: string;
  label: string;
  to: string;
  desc: string;
  color: string;
  icon: ComponentType<{ className?: string }>;
  /** 桌面画布（1200×540）里的位置 */
  at: Point;
  /** 手机画布（360×440）里的位置 */
  mobileAt: Point;
  satellites: Satellite[];
}

interface Canvas {
  w: number;
  h: number;
  hub: Point;
}

const DESKTOP: Canvas = { w: 1200, h: 540, hub: [600, 270] };
const MOBILE: Canvas = { w: 360, h: 440, hub: [180, 218] };

const NODES: GalaxyNode[] = [
  {
    id: "students",
    label: "学生管理",
    to: "/students",
    color: "#34d399",
    icon: IconUsers,
    desc: "按班级管理学生名单，Excel 一次导入全班，给每个学生设好场上位置",
    at: [250, 165],
    mobileAt: [180, 58],
    satellites: [
      { label: "分班管理", to: "/students", at: [108, 100] },
      { label: "Excel 导入名单", to: "/students?import=1", at: [100, 212] },
      { label: "场上位置", to: "/students", at: [330, 68] },
    ],
  },
  {
    id: "analyze",
    label: "视频分析",
    to: "/analyze",
    color: "#38bdf8",
    icon: IconVideo,
    desc: "上传一段训练视频，AI 自动认出练的是什么，指出做得好的和要改进的地方，还会重点看位置专项动作",
    at: [600, 110],
    mobileAt: [292, 140],
    satellites: [
      { label: "AI 识别训练项目", to: "/analyze", at: [436, 50] },
      { label: "位置专项观察", to: "/analyze", at: [764, 50] },
    ],
  },
  {
    id: "reports",
    label: "训练报告",
    to: "/reports",
    color: "#60a5fa",
    icon: IconReport,
    desc: "每一次视频分析的结果都在这里，按班级、学生查看，导出 Excel 或单份 PDF",
    at: [950, 165],
    mobileAt: [292, 296],
    satellites: [
      { label: "按班级查看", to: "/reports", at: [1092, 100] },
      { label: "导出 Excel", to: "/reports", at: [1098, 212] },
      { label: "单份 PDF", to: "/reports", at: [872, 68] },
    ],
  },
  {
    id: "players",
    label: "球员能力",
    to: "/players",
    color: "#a78bfa",
    icon: IconRadar,
    desc: "把一个学生多次训练和课堂评价汇总起来，看能力雷达和成长曲线，导出能力档案",
    at: [950, 395],
    mobileAt: [180, 372],
    satellites: [
      { label: "六维雷达", to: "/players", at: [1092, 330] },
      { label: "成长变化", to: "/players", at: [1100, 425] },
      { label: "能力档案 PDF", to: "/players", at: [1030, 505] },
    ],
  },
  {
    id: "evaluations",
    label: "智能评价",
    to: "/evaluations",
    color: "#fbbf24",
    icon: IconClipboard,
    desc: "常规、分层、期中、期末、赛事五种评价，打完星 AI 帮你写评语和课堂总评",
    at: [600, 430],
    mobileAt: [68, 296],
    satellites: [
      { label: "常规评价", to: "/evaluations?new=routine", at: [392, 440] },
      { label: "分层评价", to: "/evaluations?new=layered", at: [410, 505] },
      { label: "期中评价", to: "/evaluations?new=midterm", at: [512, 522] },
      { label: "期末评价", to: "/evaluations?new=final", at: [688, 522] },
      { label: "赛事评价", to: "/evaluations?new=match", at: [790, 505] },
      { label: "AI 写评语", to: "/evaluations", at: [808, 440] },
    ],
  },
  {
    id: "screen",
    label: "数据大屏",
    to: "/screen",
    color: "#f472b6",
    icon: IconScreen,
    desc: "全屏展示全校训练数据：班级星图、精彩瞬间、本周之星，适合开会和校园大屏播放",
    at: [250, 395],
    mobileAt: [68, 140],
    satellites: [
      { label: "班级星图", to: "/screen", at: [108, 335] },
      { label: "精彩瞬间", to: "/screen", at: [100, 440] },
      { label: "本周之星", to: "/screen", at: [140, 505] },
    ],
  },
];

/** 数据流向：学生 → 训练视频 → 分析报告 → 能力画像；课堂评价也汇进能力画像。 */
const FLOWS: [string, string][] = [
  ["students", "analyze"],
  ["analyze", "reports"],
  ["reports", "players"],
  ["students", "evaluations"],
  ["evaluations", "players"],
];

const pct = (p: Point, canvas: Canvas): CSSProperties => ({
  left: `${(p[0] / canvas.w) * 100}%`,
  top: `${(p[1] / canvas.h) * 100}%`,
});

/** 两点之间的一条弧线，bend 控制弯曲程度。 */
function curve([x1, y1]: Point, [x2, y2]: Point, bend: number): string {
  const cx = (x1 + x2) / 2 - (y2 - y1) * bend;
  const cy = (y1 + y2) / 2 + (x2 - x1) * bend;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

/** 背景星点：固定种子，每次打开位置都一样。 */
function makeStars(count: number) {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: rand() * 100,
    y: rand() * 100,
    size: rand() < 0.15 ? 3 : rand() < 0.5 ? 2 : 1.5,
    delay: rand() * 4,
    duration: 2.5 + rand() * 3,
  }));
}

export default function FeatureGalaxy({ badges = {} }: { badges?: Record<string, string> }) {
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState("evaluations");
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const stars = useMemo(() => makeStars(80), []);
  const activeNode = NODES.find((n) => n.id === active) ?? null;
  const pickedNode = NODES.find((n) => n.id === picked) ?? NODES[0];
  const linked = (id: string) =>
    active === null || active === id || FLOWS.some(([a, b]) => (a === active && b === id) || (b === active && a === id));

  return (
    <section
      aria-label="功能星图"
      className="animate-fade-up relative overflow-hidden rounded-3xl bg-ink-950 text-white shadow-[0_24px_60px_-30px_rgba(10,22,40,0.85)]"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-28 left-[20%] h-80 w-80 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute right-[18%] -bottom-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute top-[30%] -right-24 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
        <PitchMarkings className="absolute inset-0 h-full w-full text-white/[0.035]" />
        {stars.map((s) => (
          <span
            key={s.id}
            className="twinkle absolute rounded-full bg-white"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.duration}s`,
            }}
          />
        ))}
      </div>

      <header className="relative flex flex-wrap items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-7">
        <div className="max-w-2xl">
          <p className="text-[11.5px] font-medium tracking-[0.3em] text-emerald-300/90">VERTEX 跃界 · 功能星图</p>
          <h2 className="display-tight mt-1.5 text-[22px] font-semibold sm:text-[26px]">一张图看懂全部功能</h2>
          <p className="mt-1.5 min-h-[44px] text-[13.5px] leading-relaxed text-slate-300" aria-live="polite">
            {activeNode ? (
              <>
                <span className="font-semibold" style={{ color: activeNode.color }}>
                  {activeNode.label}
                </span>
                ：{activeNode.desc}
              </>
            ) : (
              "每个亮点是一个功能，虚线是数据怎么流动：学生 → 训练视频 → 分析报告 → 能力画像，课堂评价也会汇进能力画像。把鼠标移到亮点上看看，点一下直接进入。"
            )}
          </p>
        </div>
        <ul className="hidden gap-4 text-[12px] text-slate-400 lg:flex">
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_8px_rgba(125,211,252,0.9)]" />
            主要功能
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-slate-400" />
            常用操作
          </li>
          <li className="flex items-center gap-1.5">
            <span className="w-5 border-t border-dashed border-emerald-300" />
            数据流向
          </li>
        </ul>
      </header>

      <div
        className="relative mx-auto hidden w-full max-w-[1200px] md:block"
        style={{ aspectRatio: `${DESKTOP.w} / ${DESKTOP.h}` }}
        onMouseLeave={() => setActive(null)}
      >
        <Edges canvas={DESKTOP} active={active} reduced={reduced} mobile={false} />
        <Hub canvas={DESKTOP} size={108} />
        {NODES.map((n) => (
          <div key={n.id}>
            <NodeButton
              node={n}
              at={n.at}
              canvas={DESKTOP}
              size={62}
              badge={badges[n.id]}
              dim={!linked(n.id)}
              current={active === n.id}
              onEnter={() => setActive(n.id)}
              onClick={() => navigate(n.to)}
            />
            {n.satellites.map((s) => (
              <button
                key={s.label}
                type="button"
                onMouseEnter={() => setActive(n.id)}
                onFocus={() => setActive(n.id)}
                onClick={() => navigate(s.to)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-white/[0.05] px-3 py-1 text-[12px] whitespace-nowrap text-slate-200 backdrop-blur-sm transition duration-300 outline-none hover:bg-white/[0.14] hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 ${
                  active !== null && active !== n.id ? "opacity-20" : ""
                }`}
                style={{ ...pct(s.at, DESKTOP), borderColor: `${n.color}59` }}
              >
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: n.color }} />
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="md:hidden">
        <div className="relative mx-auto w-full max-w-[420px]" style={{ aspectRatio: `${MOBILE.w} / ${MOBILE.h}` }}>
          <Edges canvas={MOBILE} active={picked} reduced={reduced} mobile />
          <Hub canvas={MOBILE} size={72} />
          {NODES.map((n) => (
            <NodeButton
              key={n.id}
              node={n}
              at={n.mobileAt}
              canvas={MOBILE}
              size={50}
              dim={false}
              current={picked === n.id}
              onEnter={() => undefined}
              onClick={() => setPicked(n.id)}
              compact
            />
          ))}
        </div>
        <div className="relative mx-4 mb-5 rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-sm">
          <p className="text-[15px] font-semibold" style={{ color: pickedNode.color }}>
            {pickedNode.label}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{pickedNode.desc}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pickedNode.satellites.map((s) => (
              <Link
                key={s.label}
                to={s.to}
                className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[12px] text-slate-200"
              >
                {s.label}
              </Link>
            ))}
          </div>
          <Link
            to={pickedNode.to}
            className="mt-4 inline-flex items-center rounded-full bg-white px-4 py-2 text-[13px] font-medium text-ink-950"
          >
            进入{pickedNode.label} →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Edges({
  canvas,
  active,
  reduced,
  mobile,
}: {
  canvas: Canvas;
  active: string | null;
  reduced: boolean;
  mobile: boolean;
}) {
  const where = (n: GalaxyNode) => (mobile ? n.mobileAt : n.at);
  const pos = (id: string) => where(NODES.find((n) => n.id === id) ?? NODES[0]);
  const prefix = mobile ? "gm" : "gd";
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${canvas.w} ${canvas.h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        {NODES.map((n) => (
          <linearGradient
            key={n.id}
            id={`${prefix}-${n.id}`}
            gradientUnits="userSpaceOnUse"
            x1={canvas.hub[0]}
            y1={canvas.hub[1]}
            x2={where(n)[0]}
            y2={where(n)[1]}
          >
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="1" stopColor={n.color} stopOpacity="0.95" />
          </linearGradient>
        ))}
      </defs>
      {NODES.map((n) => {
        const on = active === n.id;
        return (
          <path
            key={n.id}
            d={curve(canvas.hub, where(n), 0.08)}
            fill="none"
            stroke={`url(#${prefix}-${n.id})`}
            strokeWidth={on ? 2.6 : 1.4}
            opacity={active === null || on ? 0.9 : 0.2}
            className="transition-opacity duration-300"
          />
        );
      })}
      {!mobile &&
        NODES.flatMap((n) =>
          n.satellites.map((s) => (
            <line
              key={`${n.id}-${s.label}`}
              x1={n.at[0]}
              y1={n.at[1]}
              x2={s.at[0]}
              y2={s.at[1]}
              stroke={n.color}
              strokeWidth={1}
              strokeDasharray="2 5"
              opacity={active === null ? 0.3 : active === n.id ? 0.75 : 0.06}
              className="transition-opacity duration-300"
            />
          )),
        )}
      {FLOWS.map(([a, b], i) => {
        const d = curve(pos(a), pos(b), 0.16);
        const on = active === null || active === a || active === b;
        return (
          <g key={`${a}-${b}`} opacity={on ? 1 : 0.12} className="transition-opacity duration-300">
            <path d={d} fill="none" stroke="#6ee7b7" strokeWidth={1.4} strokeDasharray="5 9" opacity={0.7} className="dash-flow" />
            {!reduced && (
              <circle r={mobile ? 2.4 : 3.2} fill="#a7f3d0">
                <animateMotion dur={`${3.2 + i * 0.5}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Hub({ canvas, size }: { canvas: Canvas; size: number }) {
  return (
    <div className="pointer-events-none absolute" style={pct(canvas.hub, canvas)}>
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ width: size, height: size }}>
        <span className="galaxy-pulse absolute inset-0 rounded-full border border-emerald-300/50" />
        <span className="galaxy-pulse absolute inset-0 rounded-full border border-sky-300/40" style={{ animationDelay: "1.4s" }} />
        <div className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-b from-white/[0.14] to-white/[0.03] shadow-[0_0_70px_rgba(52,211,153,0.28)] ring-1 ring-white/15">
          <SoccerBall className="spin-slow h-1/2 w-1/2" />
        </div>
        <p
          className="absolute left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] whitespace-nowrap text-emerald-200/80"
          style={{ top: size + 8 }}
        >
          VERTEX
        </p>
      </div>
    </div>
  );
}

function NodeButton({
  node,
  at,
  canvas,
  size,
  badge,
  dim,
  current,
  onEnter,
  onClick,
  compact = false,
}: {
  node: GalaxyNode;
  at: Point;
  canvas: Canvas;
  size: number;
  badge?: string;
  dim: boolean;
  current: boolean;
  onEnter: () => void;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = node.icon;
  return (
    <div className="absolute" style={pct(at, canvas)}>
      <button
        type="button"
        onMouseEnter={onEnter}
        onFocus={onEnter}
        onClick={onClick}
        aria-label={`${node.label}：${node.desc}`}
        className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none transition-opacity duration-300 focus-visible:ring-2 focus-visible:ring-white/70 ${
          dim ? "opacity-30" : ""
        }`}
      >
        <span className="float-y block" style={{ animationDelay: `${(at[0] % 7) * 0.45}s` }}>
          <span
            className="relative flex items-center justify-center rounded-full border border-white/15 bg-white/[0.08] backdrop-blur-sm transition-transform duration-300 group-hover:scale-110"
            style={{
              width: size,
              height: size,
              color: node.color,
              boxShadow: `0 0 0 1px ${node.color}45, 0 0 ${current ? 46 : 24}px ${node.color}${current ? "a6" : "59"}, inset 0 0 20px ${node.color}38`,
            }}
          >
            <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
          </span>
        </span>
        <span className="absolute left-1/2 -translate-x-1/2 text-center whitespace-nowrap" style={{ top: size + (compact ? 5 : 8) }}>
          <span
            className={`block font-semibold text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.75)] ${
              compact ? "text-[12.5px]" : "text-[14px]"
            }`}
          >
            {node.label}
          </span>
          {badge && <span className="mt-0.5 block text-[11.5px] text-slate-400">{badge}</span>}
        </span>
      </button>
    </div>
  );
}
