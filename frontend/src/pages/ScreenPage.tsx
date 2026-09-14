import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ballImage from "../assets/ball.png";
import { SoccerBall } from "../components/Football";
import { IconArrowLeft, IconExpand } from "../components/Icons";
import { Spinner } from "../components/ui";
import { api } from "../lib/api";
import { classLabel } from "../lib/classes";
import type { NameCount, ScreenClass, ScreenMoment, ScreenStats } from "../types";

/*
 * 数据大屏：全屏展示全校足球训练数据，适合在会议室、校园大屏上播放。
 * 数据每分钟自动刷新一次；所有数字都来自真实记录。
 */

/** 深色背景上的四档表现色，比浅色页面上的同色系亮一档。 */
const LEVEL_COLORS: Record<string, string> = { 优秀: "#34d399", 良好: "#60a5fa", 一般: "#fbbf24", 待提升: "#fb923c" };
const NO_RECORD = "#475569";
const WEEKDAYS = "日一二三四五六";
const TOOLTIP_STYLE = {
  background: "rgba(8,15,32,0.92)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  color: "#e2e8f0",
  fontSize: 12,
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** 数字从 0 滚动到目标值。 */
function useCountUp(target: number, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

const pad = (n: number) => String(n).padStart(2, "0");

export default function ScreenPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ScreenStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useClock();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .screenStats()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : "加载失败"));
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#050b18] text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-brand-600/25 blur-[120px]" />
        <div className="absolute right-1/4 -bottom-40 h-[30rem] w-[30rem] rounded-full bg-emerald-500/15 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black, transparent 75%)",
          }}
        />
      </div>

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4 lg:px-10">
        <div className="flex items-center gap-3">
          <SoccerBall className="spin-slow h-10 w-10" />
          <div>
            <p className="text-[11px] tracking-[0.35em] text-emerald-300/80">VERTEX 跃界</p>
            <h1 className="display-tight bg-gradient-to-r from-white via-sky-100 to-emerald-200 bg-clip-text text-[20px] font-semibold text-transparent lg:text-[28px]">
              校园足球训练数据大屏
            </h1>
          </div>
        </div>
        <div className="order-3 w-full text-center md:order-none md:w-auto">
          <p className="text-[26px] font-semibold tracking-wider text-sky-100 tabular-nums lg:text-[32px]">
            {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
          </p>
          <p className="text-[12px] text-slate-400">
            {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 星期{WEEKDAYS[now.getDay()]}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-[13px] text-slate-200 transition hover:bg-white/[0.12]"
          >
            <IconExpand className="h-4 w-4" />
            全屏
          </button>
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-2 text-[13px] text-slate-200 transition hover:bg-white/[0.12]"
          >
            <IconArrowLeft className="h-4 w-4" />
            返回工作台
          </button>
        </div>
      </header>

      {!data ? (
        <div className="relative z-10 flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
          {error ? <p>{error}</p> : <Spinner className="h-8 w-8" />}
        </div>
      ) : (
        <main className="relative z-10 mx-auto max-w-[1920px] space-y-4 px-4 pt-4 pb-6 lg:px-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="在册学生" value={data.totals.students} unit="人" color="#34d399" />
            <KpiTile label="班级" value={data.totals.classes} unit="个" color="#38bdf8" />
            <KpiTile label="训练视频" value={data.totals.videos} unit="段" color="#60a5fa" />
            <KpiTile label="AI 分析报告" value={data.totals.reports} unit="份" color="#a78bfa" />
            <KpiTile label="评价表" value={data.totals.sheets} unit="张" color="#fbbf24" />
            <KpiTile label="AI 评语" value={data.totals.comments} unit="条" color="#f472b6" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Panel title="近 14 天训练趋势">
                <TrendChart data={data.trend} />
              </Panel>
              <Panel title="训练项目排行" aside="按 AI 识别的训练项目">
                <DarkBars items={data.training_types} color="#38bdf8" unit="次" empty="还没有训练记录" />
              </Panel>
            </div>
            <Panel title="班级星图" aside={`${data.totals.classes} 个班 · ${data.totals.students} 名学生`}>
              <ClassConstellation classes={data.classes} />
            </Panel>
            <div className="space-y-4">
              <Panel title="表现等级分布" aside="来自 AI 视频分析">
                <LevelDonut levels={data.levels} />
              </Panel>
              <Panel title={data.stars_label} aside="按最好的一次表现排序">
                <StarList stars={data.stars} />
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
            <Panel title="场上位置分布">
              <DarkBars items={data.positions} color="#a78bfa" unit="人" empty="还没有学生" />
            </Panel>
            <Panel title="精彩瞬间" aside="最近的 AI 视频分析亮点，点开可以看完整报告">
              <Ticker moments={data.moments} />
            </Panel>
          </div>
        </main>
      )}
    </div>
  );
}

function Panel({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="relative rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm lg:p-5">
      <span className="absolute top-0 left-6 h-px w-24 bg-gradient-to-r from-emerald-400/0 via-emerald-300/80 to-emerald-400/0" />
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-100">
          <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-emerald-300 to-sky-400" />
          {title}
        </h2>
        {aside && <span className="text-right text-[11.5px] text-slate-400">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

function KpiTile({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  const shown = useCountUp(value);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5 backdrop-blur-sm">
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <p className="text-[12px] text-slate-400">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className="text-[30px] leading-none font-semibold tabular-nums lg:text-[36px]"
          style={{ color, textShadow: `0 0 24px ${color}66` }}
        >
          {shown}
        </span>
        <span className="text-[12px] text-slate-400">{unit}</span>
      </p>
    </div>
  );
}

function TrendChart({ data }: { data: ScreenStats["trend"] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-[12px] text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sky-400" />
          上传视频
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          完成分析
        </span>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
            <defs>
              <linearGradient id="scr-videos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#38bdf8" stopOpacity={0.45} />
                <stop offset="1" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="scr-reports" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#34d399" stopOpacity={0.35} />
                <stop offset="1" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} interval={1} />
            <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="videos" name="上传视频" stroke="#38bdf8" strokeWidth={2} fill="url(#scr-videos)" />
            <Area type="monotone" dataKey="reports" name="完成分析" stroke="#34d399" strokeWidth={2} fill="url(#scr-reports)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DarkBars({ items, color, unit, empty }: { items: NameCount[]; color: string; unit: string; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.some((i) => i.count > 0)) return <p className="py-6 text-center text-[13px] text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.name} className="grid grid-cols-[6rem_minmax(0,1fr)_2.75rem] items-center gap-3 text-[13px]">
          <span className="truncate text-slate-300" title={i.name}>
            {i.name}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(i.count / max) * 100}%`,
                background: `linear-gradient(90deg, ${color}66, ${color})`,
                boxShadow: `0 0 12px ${color}88`,
              }}
            />
          </span>
          <span className="text-right font-semibold text-slate-100 tabular-nums">
            {i.count}
            <span className="ml-0.5 text-[11px] font-normal text-slate-500">{unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function LevelDonut({ levels }: { levels: NameCount[] }) {
  const total = levels.reduce((n, l) => n + l.count, 0);
  const data = levels.filter((l) => l.count > 0);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-[140px] w-[140px] shrink-0">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="name"
                innerRadius={46}
                outerRadius={66}
                startAngle={90}
                endAngle={-270}
                paddingAngle={data.length > 1 ? 3 : 0}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((l) => (
                  <Cell key={l.name} fill={LEVEL_COLORS[l.name] ?? NO_RECORD} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [`${v} 份`, String(n)]} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-[7px] rounded-full border-[20px] border-white/[0.06]" />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[24px] font-semibold tabular-nums">{total}</span>
          <span className="text-[11px] text-slate-500">份报告</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {levels.map((l) => (
          <li key={l.name} className="flex items-center gap-2 text-[13px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: LEVEL_COLORS[l.name], boxShadow: `0 0 8px ${LEVEL_COLORS[l.name]}` }}
            />
            <span className="text-slate-300">{l.name}</span>
            <span className="ml-auto text-slate-400 tabular-nums">
              {l.count} · {total ? Math.round((l.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MEDALS = ["#fbbf24", "#cbd5e1", "#d97706"];

function StarList({ stars }: { stars: ScreenMoment[] }) {
  if (!stars.length) return <p className="py-6 text-center text-[13px] text-slate-500">还没有训练记录</p>;
  return (
    <ol className="space-y-2">
      {stars.map((s, i) => (
        <li key={s.student_id}>
          <Link
            to={`/result/${s.video_id}`}
            className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 transition hover:bg-white/[0.07]"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
              style={{
                background: i < 3 ? `${MEDALS[i]}26` : "rgba(255,255,255,0.06)",
                color: i < 3 ? MEDALS[i] : "#94a3b8",
              }}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-slate-100">
                {s.student}
                <span className="ml-2 text-[12px] font-normal text-slate-500">{classLabel(s.class_name)}</span>
              </span>
              <span className="block truncate text-[12px] text-slate-400">{s.training_type}</span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold" style={{ color: LEVEL_COLORS[s.level] ?? "#e2e8f0" }}>
              {s.level}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Ticker({ moments }: { moments: ScreenMoment[] }) {
  if (!moments.length) return <p className="py-4 text-center text-[13px] text-slate-500">还没有训练视频分析</p>;
  // 内容复制一份首尾相接，滚动时看不到断口。
  const items = [...moments, ...moments];
  return (
    <div
      className="relative overflow-hidden"
      style={{ maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)" }}
    >
      <div className="ticker flex w-max gap-3" style={{ animationDuration: `${Math.max(30, moments.length * 9)}s` }}>
        {items.map((m, i) => {
          const duplicate = i >= moments.length;
          const color = LEVEL_COLORS[m.level] ?? NO_RECORD;
          return (
            <Link
              key={`${m.video_id}-${i}`}
              to={`/result/${m.video_id}`}
              aria-hidden={duplicate}
              tabIndex={duplicate ? -1 : undefined}
              className="flex w-[380px] shrink-0 items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 transition hover:bg-white/[0.07]"
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-slate-100">
                  {m.student} · {classLabel(m.class_name)} · {m.training_type}
                  <span className="ml-1.5" style={{ color }}>
                    {m.level}
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-slate-400">{m.text}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** 班级星图：每个班级是一颗星，大小随人数变化；绕着它转的小点是学生，颜色是这名学生最好一次的表现。 */
function ClassConstellation({ classes }: { classes: ScreenClass[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 500;
  const cx = 320;
  const cy = 232;
  const n = classes.length;
  const rx = n <= 2 ? 175 : Math.min(235, 150 + n * 12);
  const ry = n <= 2 ? 120 : Math.min(150, 105 + n * 8);
  const nodes = classes.map((c, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n) + (n === 2 ? Math.PI / 2 : 0);
    return { c, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), r: 18 + Math.sqrt(c.students.length) * 4.5 };
  });
  const hovered = hover !== null ? nodes[hover] : null;

  if (!n) return <p className="py-16 text-center text-[13px] text-slate-500">还没有学生，先在「学生管理」里添加</p>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="班级星图">
        <defs>
          <radialGradient id="cls-node">
            <stop offset="0" stopColor="#1e3a8a" />
            <stop offset="1" stopColor="#0b1530" />
          </radialGradient>
          <filter id="cls-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {[1, 0.66, 0.33].map((f) => (
          <ellipse
            key={f}
            cx={cx}
            cy={cy}
            rx={rx * f + 10}
            ry={ry * f + 8}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 7"
          />
        ))}
        {nodes.map((node, i) => {
          const d = `M${cx},${cy} L${node.x},${node.y}`;
          return (
            <g key={`edge-${node.c.name}`} opacity={hover === null || hover === i ? 1 : 0.25}>
              <path d={d} stroke="rgba(96,165,250,0.35)" strokeWidth={1.2} />
              <circle r={2.6} fill="#a7f3d0">
                <animateMotion dur={`${2.6 + i * 0.35}s`} repeatCount="indefinite" path={d} />
              </circle>
            </g>
          );
        })}
        <circle
          cx={cx}
          cy={cy}
          r={46}
          fill="rgba(52,211,153,0.06)"
          stroke="rgba(52,211,153,0.45)"
          className="galaxy-pulse"
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}
        />
        <circle cx={cx} cy={cy} r={40} fill="rgba(15,23,42,0.85)" stroke="rgba(255,255,255,0.15)" />
        <image
          href={ballImage}
          x={cx - 28}
          y={cy - 28}
          width={56}
          height={56}
          className="spin-slow"
          style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}
        />
        {nodes.map((node, i) => {
          const { c, x, y, r } = node;
          const k = Math.max(1, c.students.length);
          return (
            <g
              key={c.name || "__none"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              opacity={hover === null || hover === i ? 1 : 0.4}
            >
              <g className="orbit" style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box", animationDuration: `${36 + i * 9}s` }}>
                {c.students.map((s, j) => {
                  const a = (2 * Math.PI * j) / k;
                  return (
                    <circle
                      key={s.id}
                      cx={x + (r + 12) * Math.cos(a)}
                      cy={y + (r + 12) * Math.sin(a)}
                      r={3.4}
                      fill={LEVEL_COLORS[s.level] ?? NO_RECORD}
                    />
                  );
                })}
              </g>
              <circle
                cx={x}
                cy={y}
                r={r}
                fill="url(#cls-node)"
                stroke={hover === i ? "#7dd3fc" : "rgba(125,211,252,0.5)"}
                strokeWidth={hover === i ? 2 : 1.2}
                filter="url(#cls-glow)"
              />
              <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={600} fill="#f1f5f9">
                {c.students.length}
              </text>
              <text x={x} y={y + r + 32} textAnchor="middle" fontSize={13} fontWeight={500} fill="#e2e8f0">
                {classLabel(c.name)}
              </text>
              <text x={x} y={y + r + 48} textAnchor="middle" fontSize={11} fill="#64748b">
                视频 {c.videos} · 优秀 {c.excellent}
              </text>
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-white/10 bg-[#081023]/95 px-3.5 py-2.5 text-[12px] shadow-xl"
          style={{ left: `${(hovered.x / W) * 100}%`, top: `${((hovered.y - hovered.r - 22) / H) * 100}%` }}
        >
          <p className="text-[13px] font-semibold text-white">{classLabel(hovered.c.name)}</p>
          <p className="mt-0.5 text-slate-400">
            {hovered.c.students.length} 名学生 · 训练视频 {hovered.c.videos} 段
          </p>
          <p className="text-slate-400">
            优秀 {hovered.c.excellent} 次 · 平均 {hovered.c.avg_rating ? `${hovered.c.avg_rating} 星` : "—"}
          </p>
        </div>
      )}

      <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11.5px] text-slate-400">
        {Object.entries(LEVEL_COLORS).map(([level, color]) => (
          <li key={level} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {level}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: NO_RECORD }} />
          还没有视频
        </li>
        <li className="text-slate-500">· 小点是学生，颜色是最好的一次表现</li>
      </ul>
    </div>
  );
}
