import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CHART } from "../../lib/abilities";
import { nowText } from "../../lib/evaluation";
import { BRAND, BrandLockup } from "../Brand";

export interface PrintJob {
  /** 打印期间的页面标题，Chrome 会把它作为「另存为 PDF」的默认文件名 */
  title: string;
  landscape?: boolean;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function waitForImages(root: HTMLElement | null) {
  if (!root) return;
  const pending = [...root.querySelectorAll("img")].filter((img) => !img.complete);
  await Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 4000);
        }),
    ),
  );
}

/**
 * 导出 PDF：把排好版的文档渲染到 body 下，调用浏览器打印，老师在打印窗口里选「另存为 PDF」。
 * 用浏览器打印而不是在前端拼 PDF：文字是矢量、中文字体不用另外打包，文件也小。
 * ready 为 false 时先不打印（例如封面图还在下载）。
 */
export function PrintPortal({
  job,
  ready = true,
  onDone,
  children,
}: {
  job: PrintJob | null;
  ready?: boolean;
  onDone: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!job || !ready) return;
    const html = document.documentElement;
    const previousTitle = document.title;
    let finished = false;

    function restore() {
      window.removeEventListener("afterprint", finish);
      document.title = previousTitle;
      html.classList.remove("printing");
    }
    function finish() {
      if (finished) return;
      finished = true;
      restore();
      onDoneRef.current();
    }

    document.title = job.title;
    html.classList.add("printing");
    window.addEventListener("afterprint", finish);
    void (async () => {
      await document.fonts?.ready;
      await waitForImages(rootRef.current);
      await nextFrame();
      await nextFrame();
      if (!finished) window.print();
    })();

    return () => {
      if (!finished) {
        finished = true;
        restore();
      }
    };
  }, [job, ready]);

  if (!job) return null;
  return createPortal(
    <div ref={rootRef} className="print-root">
      {job.landscape && <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>}
      {children}
    </div>,
    document.body,
  );
}

export function PrintHeader({
  title,
  subtitle,
  meta,
}: {
  title: string;
  subtitle?: string;
  meta: [string, string][];
}) {
  return (
    <header className="mb-6">
      <div className="flex items-end justify-between gap-6 border-b-2 border-slate-900 pb-3">
        <div>
          <BrandLockup size="sm" tone="dark" />
          <p className="mt-1 pl-[34px] text-[10px] tracking-wide text-slate-400">{BRAND.tagline}</p>
        </div>
        <div className="text-right">
          <h1 className="text-[22px] leading-tight font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-x-6 gap-y-2">
        {meta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] text-slate-400">{label}</dt>
            <dd className="mt-0.5 text-[12.5px] font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export function PrintSection({
  title,
  aside,
  allowBreak = false,
  children,
}: {
  title: string;
  aside?: string;
  /** 内容很长（如全班评语）时允许跨页，否则整块尽量不被分页切开 */
  allowBreak?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`mb-5 ${allowBreak ? "" : "print-avoid-break"}`}>
      <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
        <span className="h-3.5 w-[3px] rounded-full bg-brand-600" />
        {title}
        {aside && <span className="ml-auto text-[10.5px] font-normal text-slate-400">{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

export function PrintList({ items, empty, dot = "bg-slate-400" }: { items: string[]; empty: string; dot?: string }) {
  if (!items.length) return <p className="text-[12px] text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((text, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-700">
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrintFooter({ note }: { note: string }) {
  return (
    <footer className="mt-6 flex justify-between gap-6 border-t border-slate-200 pt-2.5 text-[10px] leading-relaxed text-slate-400">
      <span>{note}</span>
      <span className="shrink-0">
        {BRAND.latin} {BRAND.chinese} · 导出于 {nowText()}
      </span>
    </footer>
  );
}

/** 打印用的六维雷达：纯 SVG、固定尺寸，打印时不依赖图表库的异步布局。 */
export function PrintRadar({
  axes,
  size = 260,
}: {
  axes: { label: string; value: number | undefined }[];
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.3;
  const count = axes.length;
  const at = (i: number, r: number): [number, number] => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const ring = (f: number) => axes.map((_, i) => at(i, radius * f).join(",")).join(" ");
  const clampPct = (v: number | undefined) => Math.max(0, Math.min(100, v ?? 0)) / 100;
  const shape = axes.map((a, i) => at(i, radius * clampPct(a.value)).join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke={CHART.grid} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = at(i, radius);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={CHART.grid} />;
      })}
      <polygon
        points={shape}
        fill={CHART.brand}
        fillOpacity={0.14}
        stroke={CHART.brand}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {axes.map((a, i) => {
        const [x, y] = at(i, radius * clampPct(a.value));
        return <circle key={i} cx={x} cy={y} r={3.5} fill={CHART.brand} stroke="#fff" strokeWidth={1.5} />;
      })}
      {axes.map((a, i) => {
        const [x, y] = at(i, radius + 20);
        const anchor = Math.abs(x - cx) < 4 ? "middle" : x > cx ? "start" : "end";
        const dy = y < cy - 4 ? -14 : y > cy + 4 ? 4 : -2;
        return (
          <text key={i} x={x} y={y + dy} textAnchor={anchor} fontSize={11.5}>
            <tspan fill={CHART.ink} fontWeight={500}>
              {a.label}
            </tspan>
            <tspan x={x} dy="1.2em" fill={CHART.muted} fontSize={11}>
              {a.value ?? "—"}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** 打印用的小折线：实心点是真实训练，空心点是示例训练，与页面上的图一致。 */
export function PrintSparkline({
  values,
  mock,
  domain,
  width = 190,
  height = 46,
}: {
  values: (number | undefined)[];
  mock: boolean[];
  domain: [number, number];
  width?: number;
  height?: number;
}) {
  const pad = 5;
  const span = domain[1] - domain[0] || 1;
  const points: { x: number; y: number; mock: boolean }[] = [];
  values.forEach((v, i) => {
    if (v === undefined) return;
    const x = values.length > 1 ? pad + (i * (width - 2 * pad)) / (values.length - 1) : width / 2;
    const y = pad + (1 - (v - domain[0]) / span) * (height - 2 * pad);
    points.push({ x, y, mock: mock[i] ?? false });
  });
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return <svg width={width} height={height} />;

  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${last.x},${height - pad} L${first.x},${height - pad} Z`;
  return (
    <svg width={width} height={height}>
      <path d={area} fill={CHART.brand} fillOpacity={0.08} />
      <path d={line} fill="none" stroke={CHART.brand} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) =>
        p.mock ? (
          <circle key={i} cx={p.x} cy={p.y} r={2.75} fill="#fff" stroke={CHART.brand} strokeWidth={1.5} />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={3.25} fill={CHART.brand} stroke="#fff" strokeWidth={1.5} />
        ),
      )}
    </svg>
  );
}
