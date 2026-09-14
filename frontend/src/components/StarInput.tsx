import { useState } from "react";
import { IconStar } from "./Icons";

const DEFAULT_LEVELS = ["需加强", "较弱", "中等", "良好", "优秀"];

/**
 * 1~5 星打分，再点一次当前星级即清空。星星下方直接写出该档含义，老师不用记每一档代表什么；
 * compact 模式用在位置专项这类一格里放好几项的地方，不显示含义文字（悬停可见）。
 */
export default function StarInput({
  value,
  onChange,
  levels = DEFAULT_LEVELS,
  label,
  compact = false,
  allowZero = false,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  levels?: string[];
  label: string;
  compact?: boolean;
  /** 多一个「未参与」选项（记为 0），旧版分层任务表用 */
  allowZero?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? value ?? 0;
  const describe = (n: number) => (n === 0 ? "未参与" : (levels[n - 1] ?? ""));
  const caption = hover !== null ? describe(hover) : value === undefined ? "未评" : describe(value);
  const size = compact ? "h-[15px] w-[15px]" : "h-[17px] w-[17px]";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="flex items-center" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= active;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${label} ${n} 星：${describe(n)}`}
              title={`${n} 星 · ${describe(n)}`}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => onChange(value === n ? undefined : n)}
              className="rounded-md p-[2px] transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <IconStar
                filled={on}
                className={`${size} ${on ? (hover !== null ? "text-amber-300" : "text-amber-400") : "text-slate-300"}`}
              />
            </button>
          );
        })}
        {allowZero && (
          <button
            type="button"
            role="radio"
            aria-checked={value === 0}
            onClick={() => onChange(value === 0 ? undefined : 0)}
            className={`ml-1 rounded-full px-1.5 py-[3px] text-[11px] leading-none whitespace-nowrap transition ${
              value === 0 ? "bg-slate-700 text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            }`}
          >
            未参与
          </button>
        )}
      </div>
      {!compact && (
        <span
          className={`pl-[2px] text-[11px] leading-none ${
            value === undefined && hover === null ? "text-slate-300" : "text-slate-500"
          }`}
        >
          {caption}
        </span>
      )}
    </div>
  );
}
