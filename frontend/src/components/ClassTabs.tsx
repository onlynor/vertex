import { classLabel, type ClassGroup } from "../lib/classes";

/** 班级切换条：「全部」加每个班级，手机上可以横向滑动。各页面共用这一套分班筛选。 */
export default function ClassTabs({
  groups,
  value,
  onChange,
  total,
  allLabel = "全部班级",
  showCount = true,
}: {
  groups: ClassGroup[];
  value: string | null;
  onChange: (value: string | null) => void;
  total: number;
  allLabel?: string;
  showCount?: boolean;
}) {
  return (
    <div role="tablist" aria-label="班级" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
      <Tab active={value === null} label={allLabel} count={showCount ? total : null} onClick={() => onChange(null)} />
      {groups.map((g) => (
        <Tab
          key={g.name || "__none"}
          active={value === g.name}
          label={classLabel(g.name)}
          count={showCount ? g.count : null}
          onClick={() => onChange(g.name)}
        />
      ))}
    </div>
  );
}

function Tab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "bg-white text-slate-600 ring-1 ring-black/[0.06] hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      {label}
      {count !== null && (
        <span
          className={`rounded-full px-1.5 text-[11px] tabular-nums ${
            active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
