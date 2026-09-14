import { useEffect, useState } from "react";
import type {
  Drill,
  EvaluationEntry,
  EvaluationField,
  EvaluationKind,
  EvaluationKindSchema,
  EvaluationOptions,
  EvaluationSchema,
  EvaluationValue,
  EvaluationValues,
  PositionItem,
  XlsxCell,
  XlsxSheet,
} from "../types";
import { api } from "./api";
import { classLabel } from "./classes";

export { classLabel };

/*
 * 「智能评价」前端工具：字段定义（由后端下发）、统计、导出。
 * 五种评价表：常规、分层、期中、期末、赛事；位置专项按学生的场上位置嵌入常规、期中、期末、赛事。
 */

let schemaRequest: Promise<EvaluationSchema> | null = null;

/** 字段定义整个会话只取一次。 */
export function loadEvaluationSchema(): Promise<EvaluationSchema> {
  if (!schemaRequest) {
    schemaRequest = api.evaluationSchema().catch((err: unknown) => {
      schemaRequest = null;
      throw err;
    });
  }
  return schemaRequest;
}

export function useEvaluationSchema() {
  const [schema, setSchema] = useState<EvaluationSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadEvaluationSchema()
      .then((s) => !cancelled && setSchema(s))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "加载失败"));
    return () => {
      cancelled = true;
    };
  }, []);
  return { schema, kinds: schema?.kinds ?? null, error };
}

/** 评价表类型的标签配色，只作装饰，类型名称始终以文字标出。 */
export const KIND_TONE: Record<EvaluationKind, string> = {
  routine: "bg-brand-50 text-brand-700",
  layered: "bg-violet-50 text-violet-700",
  midterm: "bg-amber-50 text-amber-800",
  final: "bg-emerald-50 text-emerald-700",
  match: "bg-rose-50 text-rose-700",
};

export const KIND_LABELS: Record<EvaluationKind, string> = {
  routine: "常规评价",
  layered: "分层评价",
  midterm: "期中评价",
  final: "期末评价",
  match: "赛事评价",
};

export const kindTone = (key: string) => KIND_TONE[key as EvaluationKind] ?? "bg-slate-100 text-slate-600";

/** 按键名找评价表类型，包括升级前的旧版类型。 */
export function findKind(schema: EvaluationSchema, key: string): EvaluationKindSchema | undefined {
  return schema.kinds.find((k) => k.key === key) ?? schema.legacy_kinds?.find((k) => k.key === key);
}

export const STAR_LEVELS = ["需加强", "较弱", "中等", "良好", "优秀"];

/** 这名学生是否已有评价内容；只有背景信息（如场上位置）不算。 */
export function isRecorded(kind: EvaluationKindSchema, values: EvaluationValues): boolean {
  return Object.entries(values).some(
    ([key, v]) => v !== undefined && v !== "" && !kind.fields.find((f) => f.key === key)?.context,
  );
}

/** 某个位置的专项项目；位置为空时返回空数组。 */
/** 这一项能不能交给 AI 填：背景信息、老师录入的客观事实（出勤、成绩、进球数）都不行。 */
export function aiFillable(field: EvaluationField): boolean {
  return !field.context && !field.manual && field.type !== "number" && field.type !== "position";
}

/**
 * 一行里可以交给「AI 一键评价」填的评价项，与后端 evaluation.FillTargets 保持一致。
 * skipFilled 为 true 时跳过老师已经填过的，用于「只填空白」。
 */
export function fillTargets(
  kind: EvaluationKindSchema,
  schema: EvaluationSchema,
  entry: EvaluationEntry,
  skipFilled: boolean,
): string[] {
  const filled = (key: string) => {
    const v = entry.values[key];
    return v !== undefined && v !== "";
  };
  const keys: string[] = [];
  for (const field of kind.fields) {
    if (field.type === "position") {
      for (const item of positionItems(schema, entry.values.position)) {
        const key = schema.position_prefix + item.key;
        if (!skipFilled || !filled(key)) keys.push(key);
      }
    } else if (aiFillable(field) && (!skipFilled || !filled(field.key))) {
      keys.push(field.key);
    }
  }
  return keys;
}

/** 这一行还有没有内容可以让 AI 补（评价项或评语）。 */
export function needsFill(kind: EvaluationKindSchema, schema: EvaluationSchema, entry: EvaluationEntry): boolean {
  return !entry.comment.trim() || fillTargets(kind, schema, entry, true).length > 0;
}

export function positionItems(schema: EvaluationSchema, position: EvaluationValue | undefined): PositionItem[] {
  return typeof position === "string" ? (schema.position_items[position] ?? []) : [];
}

export function starLabel(field: EvaluationField, n: number): string {
  if (n === 0) return "未参与";
  return field.levels?.[n - 1] ?? STAR_LEVELS[n - 1] ?? "";
}

export const starText = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

/** 打印、导出时把一个评价值写成文字。 */
export function displayValue(field: EvaluationField, value: EvaluationValue | undefined): string {
  if (value === undefined || value === "") return "";
  if (field.type === "stars") return value === 0 ? "未参与" : starText(Number(value));
  if (field.type === "number") return field.unit === "%" ? `${value}%` : String(value);
  return String(value);
}

/** 求和有意义的数字项（进球、助攻）；分层评价的成绩只看平均和最好。 */
export const summable = (field: EvaluationField) =>
  field.type === "number" && field.key !== "score" && field.unit !== "%" && field.unit !== "天";

export function withValue(values: EvaluationValues, key: string, value: EvaluationValue | undefined): EvaluationValues {
  const next = { ...values };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

/** 换位置：原来位置的专项打分不再适用，一并清掉。 */
export function withPosition(values: EvaluationValues, position: string, schema: EvaluationSchema): EvaluationValues {
  const keep = new Set(positionItems(schema, position).map((i) => schema.position_prefix + i.key));
  const next: EvaluationValues = {};
  for (const [key, v] of Object.entries(values)) {
    if (key.startsWith(schema.position_prefix) && !keep.has(key)) continue;
    next[key] = v;
  }
  return withValue(next, "position", position || undefined);
}

/** 按达标线判断成绩达到的层级。 */
export function tierFor(drill: Drill, score: number, tiers: string[]): string {
  let reached = 0;
  drill.thresholds.forEach((line, i) => {
    if (drill.lower_is_better ? score <= line : score >= line) reached = i + 1;
  });
  return tiers[reached] ?? "";
}

export function thresholdText(drill: Drill, i: 0 | 1 | 2): string {
  return `${drill.lower_is_better ? "≤" : "≥"}${drill.thresholds[i]} ${drill.unit}`;
}

export function todayISO(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** 学期开始：8~12 月为秋季学期（9 月 1 日），1 月算上一年秋季学期，2~7 月为春季学期（2 月 1 日）。 */
export function termStart(dateISO: string): string {
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return termStart(todayISO());
  if (m >= 8) return `${y}-09-01`;
  if (m === 1) return `${y - 1}-09-01`;
  return `${y}-02-01`;
}

/** 期中、期末评价的默认名称，按当天日期推算学期。 */
export function defaultTitle(kind: EvaluationKind, date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const autumn = m >= 8 || m === 1;
  const startYear = m >= 8 ? y : y - 1;
  if (kind === "final") return autumn ? `${startYear}-${startYear + 1} 学年第一学期` : `${y - 1}-${y} 学年第二学期`;
  if (kind === "midterm") return `${autumn ? "秋季" : "春季"}学期期中评价`;
  return "";
}

/** 新建评价表时的表头附加信息默认值。 */
export function defaultOptions(kind: EvaluationKindSchema, schema: EvaluationSchema, dateISO: string): EvaluationOptions {
  const options: EvaluationOptions = {};
  const drill = schema.drills[0];
  if (kind.uses_drill && drill) options.drill = { ...drill, thresholds: [...drill.thresholds] };
  if (kind.uses_period) options.period_start = termStart(dateISO);
  if (kind.record_methods?.length) options.record_method = kind.record_methods[0];
  return options;
}

export function fmtLessonDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${y}.${m}.${d}` : iso;
}

export interface FieldStat {
  field: EvaluationField;
  /** 有记录的人数 */
  count: number;
  /** 星级为平均星数，数字项为人均值 */
  average: number | null;
  total: number | null;
  /** 数字项的最好成绩（分层评价按越多越好或越少越好判断） */
  best: number | null;
  /** 星级为各档人数（5 星在前），选项为各选项人数 */
  distribution: { label: string; count: number }[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 班级统计：星级平均、数字合计与人均、选项分布。文字、位置专项和背景信息另行处理。 */
export function fieldStats(kind: EvaluationKindSchema, entries: EvaluationEntry[], drill?: Drill): FieldStat[] {
  return kind.fields
    .filter((f) => f.type !== "text" && f.type !== "position" && !f.context)
    .map((field) => {
      const values = entries.map((e) => e.values[field.key]).filter((v) => v !== undefined && v !== "");
      const nums = values.filter((v): v is number => typeof v === "number");
      if (field.type === "stars") {
        // 「未参与」（0 星）不计入平均。
        const rated = nums.filter((n) => n > 0);
        const distribution = [5, 4, 3, 2, 1].map((n) => ({
          label: starLabel(field, n),
          count: nums.filter((v) => v === n).length,
        }));
        if (field.allow_zero) distribution.push({ label: "未参与", count: nums.filter((v) => v === 0).length });
        return {
          field,
          count: nums.length,
          average: rated.length ? round1(rated.reduce((a, b) => a + b, 0) / rated.length) : null,
          total: null,
          best: null,
          distribution,
        };
      }
      if (field.type === "number") {
        const total = nums.reduce((a, b) => a + b, 0);
        const best = nums.length ? (drill?.lower_is_better ? Math.min(...nums) : Math.max(...nums)) : null;
        return {
          field,
          count: nums.length,
          average: nums.length ? round1(total / nums.length) : null,
          total: nums.length ? total : null,
          best,
          distribution: [],
        };
      }
      return {
        field,
        count: values.length,
        average: null,
        total: null,
        best: null,
        distribution: (field.options ?? []).map((o) => ({ label: o, count: values.filter((v) => v === o).length })),
      };
    });
}

export interface PositionStat {
  position: string;
  count: number;
  items: { key: string; label: string; average: number | null; count: number }[];
}

/** 位置专项按位置分组统计平均星级。 */
export function positionStats(schema: EvaluationSchema, entries: EvaluationEntry[]): PositionStat[] {
  return schema.positions
    .map((position) => {
      const group = entries.filter((e) => e.values.position === position);
      const items = (schema.position_items[position] ?? []).map((item) => {
        const nums = group
          .map((e) => e.values[schema.position_prefix + item.key])
          .filter((v): v is number => typeof v === "number");
        return {
          key: item.key,
          label: item.label,
          average: nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null,
          count: nums.length,
        };
      });
      return { position, count: group.length, items };
    })
    .filter((p) => p.count > 0);
}

/** 一名学生的位置专项写成一行文字，如「射门 ★★★★☆ · 运球突破 ★★★☆☆」。 */
export function positionSummary(schema: EvaluationSchema, entry: EvaluationEntry, separator = " · "): string {
  return positionItems(schema, entry.values.position)
    .map((item) => {
      const v = entry.values[schema.position_prefix + item.key];
      return typeof v === "number" ? `${item.label} ${starText(v)}` : "";
    })
    .filter(Boolean)
    .join(separator);
}

export function positionAverage(schema: EvaluationSchema, entry: EvaluationEntry): number | null {
  const nums = positionItems(schema, entry.values.position)
    .map((item) => entry.values[schema.position_prefix + item.key])
    .filter((v): v is number => typeof v === "number");
  return nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

/** 复制到剪贴板；非 HTTPS 的局域网地址下 Clipboard API 不可用，退回旧写法。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续尝试旧写法
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

export function fileStamp(date = new Date()): string {
  return todayISO(date).replaceAll("-", "");
}

export function nowText(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${todayISO(date)} ${hh}:${mm}`;
}

export interface SheetHeader {
  class_name: string;
  title: string;
  lesson_date: string;
  teacher_name: string;
  summary: string;
  options: EvaluationOptions;
}

/** 表头附加信息写成「名称：内容」，页面、导出、打印共用。 */
export function optionLines(kind: EvaluationKindSchema, sheet: SheetHeader): [string, string][] {
  const lines: [string, string][] = [];
  const drill = sheet.options.drill;
  if (kind.uses_drill && drill) {
    lines.push(["练习项目", `${drill.label}（${drill.measure}）`]);
    lines.push([
      "达标线",
      `基础层 ${thresholdText(drill, 0)} · 提高层 ${thresholdText(drill, 1)} · 挑战层 ${thresholdText(drill, 2)}`,
    ]);
    if (drill.method) lines.push(["测评方法", drill.method]);
  }
  if (kind.uses_period && sheet.options.period_start) {
    lines.push(["统计区间", `${fmtLessonDate(sheet.options.period_start)} – ${fmtLessonDate(sheet.lesson_date)}`]);
  }
  if (sheet.options.record_method) lines.push(["记录方式", sheet.options.record_method]);
  return lines;
}

export function evaluationFilename(kind: EvaluationKindSchema, sheet: SheetHeader): string {
  return `${kind.label}_${classLabel(sheet.class_name)}_${sheet.title}_${sheet.lesson_date.replaceAll("-", "")}`;
}

/** 表格列标题，如「训练态度（星）」「成绩（次）」。 */
export function columnTitle(field: EvaluationField, drill?: Drill): string {
  if (field.type === "stars") return `${field.label}（星）`;
  if (field.key === "score" && drill) return `成绩（${drill.unit}）`;
  if (field.unit) return `${field.label}（${field.unit}）`;
  return field.label;
}

const str = (v: EvaluationValue | undefined): XlsxCell => (typeof v === "string" && v ? v : null);

function cellValue(field: EvaluationField, value: EvaluationValue | undefined): XlsxCell {
  if (value === undefined || value === "") return null;
  if (field.type === "stars" && value === 0) return "未参与";
  return value;
}

/**
 * 评价表导出为 Excel：第一个工作表是逐人评价（星级、次数写成数字，便于在 Excel 里再统计；
 * 位置专项写成一段文字加一个平均分），第二个工作表是班级统计和课堂总评。
 */
export function evaluationWorkbook(
  schema: EvaluationSchema,
  kind: EvaluationKindSchema,
  sheet: SheetHeader,
  entries: EvaluationEntry[],
): XlsxSheet[] {
  const drill = sheet.options.drill;
  const scoreFields = kind.fields.filter((f) => f.type !== "text" && !f.context);
  const textFields = kind.fields.filter((f) => f.type === "text");
  const stats = fieldStats(kind, entries, drill);
  const statFor = (f: EvaluationField) => stats.find((s) => s.field.key === f.key);
  const recorded = entries.filter((e) => isRecorded(kind, e.values)).length;
  const withPos = kind.uses_position;
  const posAverages = entries.map((e) => positionAverage(schema, e)).filter((v): v is number => v !== null);

  const rows: XlsxCell[][] = entries.map((e, i) => [
    i + 1,
    e.student_name,
    e.student_no || null,
    ...(withPos ? [str(e.values.position)] : []),
    ...scoreFields.flatMap((f): XlsxCell[] =>
      f.type === "position"
        ? [positionSummary(schema, e, "；") || null, positionAverage(schema, e)]
        : [cellValue(f, e.values[f.key])],
    ),
    ...textFields.map((f) => str(e.values[f.key])),
    e.comment || null,
    e.comment ? (e.comment_source === "ai" ? "AI 生成" : "老师填写") : null,
  ]);
  if (entries.length) {
    rows.push([
      "",
      "班级平均",
      null,
      ...(withPos ? [null] : []),
      ...scoreFields.flatMap((f): XlsxCell[] =>
        f.type === "position"
          ? [null, posAverages.length ? round1(posAverages.reduce((a, b) => a + b, 0) / posAverages.length) : null]
          : [f.type === "stars" || f.type === "number" ? (statFor(f)?.average ?? null) : null],
      ),
      ...textFields.map(() => null),
      null,
      null,
    ]);
    if (scoreFields.some(summable)) {
      rows.push([
        "",
        "合计",
        null,
        ...(withPos ? [null] : []),
        ...scoreFields.flatMap((f): XlsxCell[] =>
          f.type === "position" ? [null, null] : [summable(f) ? (statFor(f)?.total ?? null) : null],
        ),
        ...textFields.map(() => null),
        null,
        null,
      ]);
    }
  }

  // 相同含义的星级项合并成一条说明。
  const legends = new Map<string, string[]>();
  for (const f of scoreFields) {
    if (f.type !== "stars" && f.type !== "position") continue;
    const levels = f.levels ?? STAR_LEVELS;
    const key = levels.map((l, i) => `${i + 1} 星=${l}`).join("，");
    legends.set(key, [...(legends.get(key) ?? []), f.label]);
  }
  const positionNote = withPos
    ? `位置专项按场上位置看不同的项目：${schema.positions
        .map((p) => `${p} ${(schema.position_items[p] ?? []).map((i) => i.label).join("/")}`)
        .join("；")}`
    : null;

  const main: XlsxSheet = {
    name: kind.label,
    title: `${kind.label}表 · ${classLabel(sheet.class_name)}`,
    meta: [
      [kind.title_label, sheet.title],
      [kind.date_label, sheet.lesson_date],
      ...optionLines(kind, sheet),
      ["教师", sheet.teacher_name || "—"],
      ["学生人数", `${entries.length} 人，已评价 ${recorded} 人`],
      ["导出时间", nowText()],
    ],
    columns: [
      { header: "序号", width: 6 },
      { header: "姓名", width: 10 },
      { header: "学号", width: 12 },
      ...(withPos ? [{ header: "位置", width: 8 }] : []),
      ...scoreFields.flatMap((f) =>
        f.type === "position"
          ? [
              { header: f.label, width: 36 },
              { header: `${f.label}平均（星）`, width: 12 },
            ]
          : [{ header: columnTitle(f, drill), width: Math.max(10, f.label.length * 2 + 4) }],
      ),
      ...textFields.map((f) => ({ header: f.label, width: 24 })),
      { header: "评语", width: 50 },
      { header: "评语来源", width: 10 },
    ],
    rows,
    notes: [
      ...[...legends].map(([legend, labels]) => `${labels.join("、")}：${legend}`),
      ...(positionNote ? [positionNote] : []),
      "评语由 AI 根据老师的评价记录生成，老师可修改。",
    ],
  };

  const summaryRows: XlsxCell[][] = [
    ...stats.map((s): XlsxCell[] => [
      s.field.label,
      s.count,
      s.average,
      summable(s.field) ? s.total : null,
      s.distribution
        .filter((d) => d.count > 0)
        .map((d) => `${d.label} ${d.count} 人`)
        .join("、") || null,
    ]),
    ...positionStats(schema, entries).flatMap((p) =>
      p.items.map((item): XlsxCell[] => [`位置专项·${p.position}·${item.label}`, item.count, item.average, null, null]),
    ),
  ];

  const summary: XlsxSheet = {
    name: "班级统计",
    title: `班级统计 · ${sheet.title}`,
    columns: [
      { header: "评价项", width: 22 },
      { header: "有记录人数", width: 11 },
      { header: "平均", width: 9 },
      { header: "合计", width: 9 },
      { header: "分布", width: 60 },
    ],
    rows: summaryRows,
    notes: sheet.summary ? ["课堂总评：", ...sheet.summary.split("\n")] : [],
  };

  return [main, summary];
}
