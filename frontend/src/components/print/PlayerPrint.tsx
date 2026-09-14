import {
  ABILITY_LABELS,
  fmtShortDate,
  LEVEL_HEX,
  levelOf,
  PROFILE_WINDOW,
  type AbilityKey,
  type DataSource,
  type EvaluationAverage,
  type Note,
  type Position,
  type Scores,
  type Session,
} from "../../lib/abilities";
import type { Student } from "../../types";
import { BarList, levelColor } from "../ui";
import { PrintFooter, PrintHeader, PrintList, PrintRadar, PrintSection, PrintSparkline } from "./PrintKit";

export interface PlayerPrintProps {
  student: Student;
  position: Position;
  positionIsDefault: boolean;
  rangeText: string;
  sessions: Session[];
  dims: AbilityKey[];
  profile: Scores;
  overall: number;
  overallDelta: number | null;
  realCount: number;
  mockCount: number;
  scoreSource: DataSource;
  domain: [number, number];
  evaluationRows: EvaluationAverage[];
  evaluationSource: DataSource;
  levels: { level: string; count: number }[];
  highlights: Note[];
  issues: Note[];
}

/** 球员能力档案的 PDF 版式（A4 竖版）。 */
export default function PlayerPrint(p: PlayerPrintProps) {
  const level = levelOf(p.overall);
  const total = p.sessions.length;
  const noteText = (n: Note) => `${n.text}（${fmtShortDate(n.date)} · ${n.origin}）`;

  return (
    <article>
      <PrintHeader
        title="球员能力档案"
        subtitle={`统计范围：${p.rangeText}`}
        meta={[
          ["学生", p.student.name],
          ["学号", p.student.student_no || "—"],
          ["班级", p.student.class_name || "未分班"],
          ["场上位置", p.positionIsDefault ? `${p.position}（未设置）` : p.position],
        ]}
      />

      {p.scoreSource === "mock" && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          能力分目前为示例数据：由真实的综合表现星级和训练项目推算，用于展示结构，不是测量值
          {p.mockCount ? `；另补充了 ${p.mockCount} 次示例训练（图中空心点）` : ""}。
        </p>
      )}

      <div className="print-avoid-break mb-5 grid grid-cols-[1fr_260px] items-center gap-6 rounded-xl border border-slate-200 px-5 py-4">
        <div>
          <p className="text-[11px] text-slate-500">综合能力</p>
          <div className="mt-1 flex items-end gap-3">
            <span className="text-[48px] leading-none font-semibold text-slate-900">{p.overall}</span>
            <span className="pb-1">
              <span className={`block text-[14px] font-semibold ${levelColor(level)}`}>{level}</span>
              {p.overallDelta !== null && (
                <span className="text-[11px] text-slate-500">
                  较首次 {p.overallDelta >= 0 ? "↑" : "↓"} {Math.abs(p.overallDelta)}
                </span>
              )}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            满分 100 · 近 {Math.min(PROFILE_WINDOW, total)} 次训练平均 · 真实训练 {p.realCount} 次
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-1.5 text-[12px]">
            {p.dims.map((d) => (
              <div key={d} className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{ABILITY_LABELS[d]}</dt>
                <dd className="font-semibold text-slate-800">{p.profile[d] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <PrintRadar axes={p.dims.map((d) => ({ label: ABILITY_LABELS[d], value: p.profile[d] }))} />
      </div>

      <PrintSection title="能力变化" aside={`按训练先后排列，纵轴 ${p.domain[0]}~100 分`}>
        <div className="grid grid-cols-3 gap-3">
          {p.dims.map((d) => {
            const values = p.sessions.map((s) => s.scores[d]);
            const nums = values.filter((v): v is number => typeof v === "number");
            const first = nums[0];
            const latest = nums[nums.length - 1];
            const change = first !== undefined && latest !== undefined && nums.length > 1 ? latest - first : 0;
            return (
              <div key={d} className="rounded-lg bg-slate-50 px-3 pt-2.5 pb-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-slate-700">{ABILITY_LABELS[d]}</span>
                  <span className="text-[15px] font-semibold text-slate-900">
                    {latest ?? "—"}
                    {change !== 0 && (
                      <span className={`ml-1 text-[10.5px] ${change > 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {change > 0 ? "↑" : "↓"}
                        {Math.abs(change)}
                      </span>
                    )}
                  </span>
                </div>
                <PrintSparkline values={values} mock={p.sessions.map((s) => s.isMock)} domain={p.domain} width={196} height={44} />
                <p className="text-[10.5px] text-slate-400 tabular-nums">
                  {(nums.length > 4 ? "… " : "") + nums.slice(-4).join(" → ")}
                </p>
              </div>
            );
          })}
        </div>
      </PrintSection>

      <PrintSection title="训练表现统计">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="mb-2.5 text-[11.5px] font-semibold text-slate-700">
              各项平均评分
              <span className="ml-1 font-normal text-slate-400">
                满分 5 星 · {p.evaluationSource === "live" ? "课堂评价" : "示例数据"}
              </span>
            </p>
            <BarList
              max={5}
              rows={p.evaluationRows.map((r) => ({ label: r.label, value: r.value, display: r.value?.toFixed(1) }))}
            />
          </div>
          <div>
            <p className="mb-2.5 text-[11.5px] font-semibold text-slate-700">
              表现等级占比
              <span className="ml-1 font-normal text-slate-400">共 {total} 次</span>
            </p>
            <ul className="space-y-2">
              {p.levels.map((l) => (
                <li key={l.level} className="flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_HEX[l.level] }} />
                  <span className="text-slate-700">{l.level}</span>
                  <span className="ml-auto text-slate-500 tabular-nums">
                    {l.count} 次 · {total ? Math.round((l.count / total) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11.5px] font-semibold text-slate-700">本课亮点</p>
              <PrintList items={p.highlights.map(noteText)} empty="暂无亮点记录" dot="bg-emerald-500" />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] font-semibold text-slate-700">需改进</p>
              <PrintList items={p.issues.map(noteText)} empty="暂未发现明显问题" dot="bg-amber-500" />
            </div>
          </div>
        </div>
      </PrintSection>

      <PrintFooter note="能力档案汇总学生历次训练视频的分析结果与课堂评价；AI 结论仅供参考，以老师现场观察为准。" />
    </article>
  );
}
