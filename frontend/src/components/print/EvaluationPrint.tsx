import {
  classLabel,
  columnTitle,
  displayValue,
  fieldStats,
  fmtLessonDate,
  isRecorded,
  optionLines,
  positionAverage,
  positionItems,
  starText,
  summable,
  type SheetHeader,
} from "../../lib/evaluation";
import type { EvaluationEntry, EvaluationKindSchema, EvaluationSchema } from "../../types";
import { PrintFooter, PrintHeader, PrintSection } from "./PrintKit";

/** 评价表的 PDF 版式（A4 横版）：逐人评价表、学生评语、课堂总评。 */
export default function EvaluationPrint({
  schema,
  kind,
  sheet,
  entries,
}: {
  schema: EvaluationSchema;
  kind: EvaluationKindSchema;
  sheet: SheetHeader;
  entries: EvaluationEntry[];
}) {
  const drill = sheet.options.drill;
  const stats = fieldStats(kind, entries, drill);
  const recorded = entries.filter((e) => isRecorded(kind, e.values)).length;
  const scoreFields = kind.fields.filter((f) => f.type !== "text" && !f.context);
  const textFields = kind.fields.filter((f) => f.type === "text");
  const withComments = entries.filter((e) => e.comment.trim());
  const extra = optionLines(kind, sheet);

  function footerCell(key: string) {
    const s = stats.find((x) => x.field.key === key);
    if (!s || s.count === 0) return "—";
    if (s.field.type === "stars") return s.average === null ? "—" : `${s.average.toFixed(1)} 星`;
    if (s.field.type === "number") return summable(s.field) ? `合计 ${s.total}` : `平均 ${s.average}`;
    return "";
  }

  return (
    <article>
      <PrintHeader
        title={`${kind.label}表`}
        subtitle={classLabel(sheet.class_name)}
        meta={[
          [kind.title_label, sheet.title],
          [kind.date_label, fmtLessonDate(sheet.lesson_date)],
          ["教师", sheet.teacher_name || "—"],
          ["学生", `${entries.length} 人 · 已评价 ${recorded} 人`],
        ]}
      />
      {extra.length > 0 && (
        <p className="-mt-3 mb-4 text-[11px] leading-relaxed text-slate-500">
          {extra.map(([k, v]) => `${k}：${v}`).join("　　")}
        </p>
      )}

      <section className="mb-5">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="bg-slate-100 text-slate-600">
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">序号</th>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">姓名</th>
              {kind.uses_position && <th className="px-2 py-1.5 font-medium whitespace-nowrap">位置</th>}
              {scoreFields.map((f) => (
                <th key={f.key} className="px-2 py-1.5 font-medium whitespace-nowrap">
                  {f.type === "stars" || f.type === "position" ? f.label : columnTitle(f, drill)}
                </th>
              ))}
              {textFields.map((f) => (
                <th key={f.key} className="px-2 py-1.5 font-medium">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.student_id} className="border-b border-slate-200 align-top">
                <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium whitespace-nowrap text-slate-900">{e.student_name}</td>
                {kind.uses_position && (
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{String(e.values.position ?? "—")}</td>
                )}
                {scoreFields.map((f) =>
                  f.type === "position" ? (
                    <td key={f.key} className="px-2 py-1.5 whitespace-nowrap text-slate-700">
                      {positionItems(schema, e.values.position).map((item) => {
                        const v = e.values[schema.position_prefix + item.key];
                        return (
                          <div key={item.key}>
                            {item.label}{" "}
                            <span className={typeof v === "number" ? "text-amber-500" : "text-slate-300"}>
                              {typeof v === "number" ? starText(v) : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </td>
                  ) : (
                    <td
                      key={f.key}
                      className={`px-2 py-1.5 whitespace-nowrap ${
                        f.type === "stars" && e.values[f.key] ? "text-amber-500" : "text-slate-700"
                      }`}
                    >
                      {displayValue(f, e.values[f.key]) || <span className="text-slate-300">—</span>}
                    </td>
                  ),
                )}
                {textFields.map((f) => (
                  <td key={f.key} className="px-2 py-1.5 text-slate-600">
                    {String(e.values[f.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium text-slate-700">
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 whitespace-nowrap">班级</td>
              {kind.uses_position && <td />}
              {scoreFields.map((f) => (
                <td key={f.key} className="px-2 py-1.5 whitespace-nowrap">
                  {f.type === "position" ? positionFooter(schema, entries) : footerCell(f.key)}
                </td>
              ))}
              {textFields.map((f) => (
                <td key={f.key} />
              ))}
            </tr>
          </tfoot>
        </table>
      </section>

      {withComments.length > 0 && (
        <PrintSection title="学生评语" aside={`${withComments.length} 人`} allowBreak>
          <div className="columns-2 gap-8">
            {withComments.map((e) => (
              <div key={e.student_id} className="mb-3 break-inside-avoid">
                <p className="text-[11.5px] font-semibold text-slate-900">{e.student_name}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-700">{e.comment}</p>
              </div>
            ))}
          </div>
        </PrintSection>
      )}

      {sheet.summary && (
        <PrintSection title="课堂总评">
          {sheet.summary.split("\n").map((line, i) => (
            <p key={i} className="mb-1.5 text-[12px] leading-relaxed text-slate-700">
              {line}
            </p>
          ))}
        </PrintSection>
      )}

      <PrintFooter note="评语与课堂总评由 AI 根据老师的评价记录生成，老师可修改；星级为老师的评价。" />
    </article>
  );
}

function positionFooter(schema: EvaluationSchema, entries: EvaluationEntry[]): string {
  const nums = entries.map((e) => positionAverage(schema, e)).filter((v): v is number => v !== null);
  return nums.length ? `平均 ${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)} 星` : "—";
}
