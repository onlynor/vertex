import { ABILITY_LABELS, POSITION_DIMENSIONS, resolvePosition, videoAbilities } from "../../lib/abilities";
import type { VideoRecord } from "../../types";
import { levelColor, Stars } from "../ui";
import { PrintFooter, PrintHeader, PrintList, PrintRadar, PrintSection } from "./PrintKit";

/** 单份训练报告的 PDF 版式（A4 竖版），用于打印存档或发给家长。 */
export default function ReportPrint({ record, thumb }: { record: VideoRecord; thumb: string | null }) {
  const report = record.report;
  if (!report) return null;
  const { position, isDefault } = resolvePosition(record.student?.position);
  const abilities = videoAbilities(record, position);
  const dims = POSITION_DIMENSIONS[position];

  return (
    <article>
      <PrintHeader
        title="训练报告"
        subtitle={`记录编号 ${record.id}`}
        meta={[
          ["学生", record.student_name || "—"],
          ["班级", record.student?.class_name || "未分班"],
          ["训练项目", report.training_type || record.training_type],
          [
            "分析时间",
            new Date(record.created_at).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ],
        ]}
      />

      <div className="print-avoid-break mb-5 grid grid-cols-[1.05fr_1fr] gap-6">
        {thumb ? (
          <img src={thumb} alt="训练画面" className="aspect-video w-full rounded-lg object-cover" />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-[11px] text-slate-400">
            无训练画面
          </div>
        )}
        <div>
          <p className="text-[11px] text-slate-500">综合表现</p>
          <p className={`mt-0.5 text-[28px] leading-tight font-semibold ${levelColor(report.level)}`}>
            {report.level}
          </p>
          <Stars rating={report.rating} className="mt-1.5" />
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-700">{report.summary}</p>
          {record.duration_sec > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">视频时长 {Math.round(record.duration_sec)} 秒</p>
          )}
        </div>
      </div>

      <PrintSection title="动作表现">
        <p className="text-[12.5px] leading-relaxed text-slate-700">{report.performance}</p>
      </PrintSection>

      <div className="grid grid-cols-2 gap-6">
        <PrintSection title="做得好的地方">
          <PrintList items={report.highlights} empty="暂无记录" dot="bg-emerald-500" />
        </PrintSection>
        <PrintSection title="发现的问题">
          <PrintList items={report.issues} empty="未发现明显问题" dot="bg-amber-500" />
        </PrintSection>
      </div>

      <PrintSection title="改进建议">
        <PrintList items={report.suggestions} empty="继续保持当前训练节奏" dot="bg-brand-600" />
      </PrintSection>

      {abilities && (
        <PrintSection title="本次能力分析" aside={abilities.source === "mock" ? "示例数据" : "分析记录"}>
          <div className="grid grid-cols-[260px_1fr] items-center gap-6">
            <PrintRadar axes={dims.map((d) => ({ label: ABILITY_LABELS[d], value: abilities.scores[d] }))} />
            <div>
              <p className="text-[11px] text-slate-500">
                综合能力 · {position}六维{isDefault ? "（未设置位置，按中场展示）" : ""}
              </p>
              <p className="mt-0.5 text-[30px] leading-tight font-semibold text-slate-900">
                {abilities.overall}
                <span className="ml-1 text-[13px] font-medium text-slate-400">/ 100</span>
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1.5 text-[12px]">
                {dims.map((d) => (
                  <div key={d} className="flex justify-between border-b border-slate-100 pb-1">
                    <dt className="text-slate-500">{ABILITY_LABELS[d]}</dt>
                    <dd className="font-semibold text-slate-800">{abilities.scores[d] ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[10.5px] leading-relaxed text-slate-400">
                仅反映本次视频中的表现，不代表长期能力。
                {abilities.source === "mock" && "能力分目前由综合表现星级和训练项目推算，为示例数据，不是测量值。"}
              </p>
            </div>
          </div>
        </PrintSection>
      )}

      <PrintFooter note="本分析由 AI 生成，仅供参考；综合表现为四档定性判断，不代表精确评分。" />
    </article>
  );
}
