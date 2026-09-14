import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { getToken } from "../lib/api";
import { IconStar } from "./Icons";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.985] shadow-[0_1px_2px_rgba(37,99,235,0.35)] disabled:bg-brand-300",
    secondary:
      "bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.985]",
    ghost: "text-slate-600 hover:bg-slate-100 active:scale-[0.985]",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.985]",
  };
  const sizes = {
    sm: "px-3.5 py-1.5 text-[13px]",
    md: "px-5 py-2.5 text-sm",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-slate-600">{label}</span>
      )}
      <input
        className={`w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({
  label,
  className = "",
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-slate-600">{label}</span>
      )}
      <select
        className={`w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

const statusStyles: Record<string, { label: string; className: string }> = {
  pending: { label: "排队中", className: "bg-slate-100 text-slate-600" },
  processing: { label: "分析中", className: "bg-blue-50 text-brand-600" },
  done: { label: "已完成", className: "bg-emerald-50 text-emerald-600" },
  failed: { label: "失败", className: "bg-red-50 text-red-600" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? statusStyles.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/** 为各定性档位配颜色，避免出现“绿色代表差”这类误导性的配色。 */
export function levelColor(level: string): string {
  switch (level) {
    case "优秀":
      return "text-emerald-600";
    case "良好":
      return "text-brand-600";
    case "一般":
      return "text-amber-500";
    case "待提升":
      return "text-orange-600";
    default:
      return "text-slate-700";
  }
}

export function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  return (
    <div className={`flex items-center gap-0.5 text-amber-400 ${className}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} className="h-4 w-4" filled={i <= rating} />
      ))}
    </div>
  );
}

/**
 * 封面图位于鉴权中间件之后，直接 <img src> 会返回 401。
 * 改为携带 bearer token 拉取，再渲染成 blob。
 */
export function AuthImage({
  src,
  alt,
  className = "",
  fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    fetch(src, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then((res) => {
        if (!res.ok) throw new Error("no thumb");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed || !url) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className}`}>
        {fallback ?? <span className="text-xs text-slate-400">无封面</span>}
      </div>
    );
  }
  return <img src={url} alt={alt} className={className} />;
}

/** 卡片标题行：左侧图标方块 + 标题，右侧可放数据来源标签等附加信息。 */
export function SectionHeader({
  icon,
  tint,
  title,
  aside,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tint}`}>{icon}</span>
      <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

/**
 * 数据来源标签。能力类数据目前由已有记录推算，要让老师一眼分清哪些是真实分析、
 * 哪些是示例，避免把示例分数当成学生的真实成绩。
 */
export function SourceBadge({ source, label }: { source: "live" | "mock"; label?: string }) {
  const live = source === "live";
  return (
    <span
      title={live ? "来自真实的分析记录" : "暂无真实数据，当前为推算的示例值"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
      {label ?? (live ? "分析记录" : "示例数据")}
    </span>
  );
}

/** 横向条形列表：数值直接写在条形右侧，不必悬停也能读出每一项。 */
export function BarList({
  rows,
  max,
}: {
  rows: { label: string; value: number | null; display?: string; title?: string }[];
  max: number;
}) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const pct = row.value === null || max <= 0 ? 0 : Math.min(100, (row.value / max) * 100);
        return (
          <li
            key={row.label}
            title={row.title}
            className="grid grid-cols-[4.75rem_minmax(0,1fr)_2.75rem] items-center gap-3 text-[13px]"
          >
            <span className="truncate text-slate-700">{row.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-brand-50">
              <span
                className="block h-full rounded-full bg-brand-600 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-right font-semibold text-slate-800 tabular-nums">
              {row.display ?? (row.value === null ? "—" : row.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 完成进度：「已评价 12/15」这类计数加一条细进度条。 */
export function Progress({
  label,
  value,
  total,
  tone = "brand",
}: {
  label: string;
  value: number;
  total: number;
  tone?: "brand" | "emerald";
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium text-slate-700 tabular-nums">
          {value}/{total}
        </span>
      </div>
      <div className={`h-1.5 overflow-hidden rounded-full ${tone === "emerald" ? "bg-emerald-50" : "bg-brand-50"}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            tone === "emerald" ? "bg-emerald-500" : "bg-brand-600"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
        📭
      </div>
      <p className="text-[15px] font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-brand-100 border-t-brand-600 ${className}`}
    />
  );
}

export function Toast({ message, tone = "success" }: { message: string; tone?: "success" | "error" }) {
  return (
    <div
      className={`animate-fade-up fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-lg ${
        tone === "success" ? "bg-slate-900" : "bg-red-600"
      }`}
    >
      {message}
    </div>
  );
}
