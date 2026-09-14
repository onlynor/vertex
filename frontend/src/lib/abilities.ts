import type { Student, StudentEvaluationRecord, VideoRecord, XlsxCell, XlsxSheet } from "../types";
import { fileStamp, nowText, todayISO } from "./evaluation";

/*
 * 球员能力数据层（前端）。
 *
 * 数据关系：学生 → 多次训练视频 → 视频分析结果 → 每次能力评分 → 球员能力历史 → 图表。
 *
 * 现状：AI 分析结果（report）目前只有训练项目、综合表现、亮点、问题和建议，
 * 还没有分项能力分。因此——
 *   - 能力分：由真实字段（综合表现星级 report.rating、训练项目 report.training_type）
 *     推算出示例值。同一条视频每次算出来都一样，结果页和球员能力页因此保持一致，
 *     界面上统一标注「示例数据」；
 *   - 表现等级、本课亮点、需改进：直接使用真实分析结果，并合并老师在「智能评价」里写的亮点和改进点；
 *   - 教学评价（训练态度 / 团队纪律 / 当前位置的三项位置专项）：优先使用「智能评价」里
 *     老师的打分（1~5 星），该学生还没有记录时使用示例值。
 *
 * 等 report.abilities 有值后，videoAbilities 会直接采用它，页面与图表都不需要改动。
 * 每个指标对应的字段见文件末尾的 dataSources()。
 */

export type Position = "前锋" | "中场" | "后卫" | "门将";

export const POSITIONS: Position[] = ["前锋", "中场", "后卫", "门将"];

/** 未设置位置时使用中场这组维度：它的六项最均衡，不偏攻也不偏守。 */
export const DEFAULT_POSITION: Position = "中场";

/** 能力键同时也是将来 AI 输出 report.abilities 时使用的字段名。 */
export type AbilityKey =
  | "shooting"
  | "dribbling"
  | "speed"
  | "control"
  | "passing"
  | "attack"
  | "teamwork"
  | "defense"
  | "saving"
  | "reaction"
  | "handling"
  | "footwork"
  | "rushing"
  | "positioning";

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  shooting: "射门",
  dribbling: "运球",
  speed: "速度",
  control: "控球",
  passing: "传球",
  attack: "进攻",
  teamwork: "配合",
  defense: "防守",
  saving: "扑救",
  reaction: "反应",
  handling: "手控球",
  footwork: "脚下",
  rushing: "出击",
  positioning: "位置",
};

/** 面向小学生训练的六维指标，按场上位置选择。 */
export const POSITION_DIMENSIONS: Record<Position, AbilityKey[]> = {
  前锋: ["shooting", "dribbling", "speed", "control", "passing", "attack"],
  中场: ["passing", "control", "dribbling", "speed", "shooting", "teamwork"],
  后卫: ["defense", "speed", "passing", "control", "dribbling", "teamwork"],
  门将: ["saving", "reaction", "handling", "footwork", "rushing", "positioning"],
};

/**
 * 位置专项：智能评价里按位置打分的三项，键名就是能力键。
 * 与后端 internal/evaluation 的 PositionItems 保持一致。
 */
export const POSITION_ITEMS: Record<Position, { key: AbilityKey; label: string }[]> = {
  前锋: [
    { key: "shooting", label: "射门" },
    { key: "dribbling", label: "运球突破" },
    { key: "attack", label: "进攻跑位" },
  ],
  中场: [
    { key: "passing", label: "传球" },
    { key: "control", label: "控球" },
    { key: "teamwork", label: "配合意识" },
  ],
  后卫: [
    { key: "defense", label: "防守抢断" },
    { key: "speed", label: "回追速度" },
    { key: "teamwork", label: "补位配合" },
  ],
  门将: [
    { key: "saving", label: "扑救" },
    { key: "handling", label: "手控球" },
    { key: "rushing", label: "出击" },
  ],
};

export function resolvePosition(raw?: string | null): { position: Position; isDefault: boolean } {
  if (raw && (POSITIONS as string[]).includes(raw)) {
    return { position: raw as Position, isDefault: false };
  }
  return { position: DEFAULT_POSITION, isDefault: true };
}

/** live：来自真实记录；mock：暂无真实数据，为推算的示例值。 */
export type DataSource = "live" | "mock";

export type Scores = Partial<Record<AbilityKey, number>>;

export interface SessionAbilities {
  scores: Scores;
  overall: number;
  source: DataSource;
}

/** 图表用色，与站内既有配色一致（品牌蓝 brand-600 等）。 */
export const CHART = {
  brand: "#2563eb",
  track: "#eff6ff",
  grid: "#e6e9ef",
  ink: "#344054",
  muted: "#667085",
} as const;

/** 四档表现的颜色与站内 levelColor 保持一致；顺序固定，已通过色盲区分度校验。 */
export const LEVELS = ["优秀", "良好", "一般", "待提升"] as const;

export const LEVEL_HEX: Record<string, string> = {
  优秀: "#059669",
  良好: "#2563eb",
  一般: "#f59e0b",
  待提升: "#ea580c",
};

const UNRECOGNISED = "无法识别";

/** 确定性的伪随机数（0~1）：同一个 key 永远得到同一个值，示例数据因此不会每次刷新都变。 */
function seeded(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const mean = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

/** 示例能力分以真实的综合表现星级为基准，保证示例分数与 AI 的定性判断方向一致。 */
const RATING_BASE: Record<number, number> = { 5: 86, 4: 76, 3: 66, 2: 55 };

/** 训练项目与能力的对应关系：练什么，对应的能力在示例分里略高一些。 */
const AFFINITY: Record<AbilityKey, string[]> = {
  shooting: ["射门", "射"],
  dribbling: ["运球", "绕桩", "带球", "盘带", "突破"],
  speed: ["热身", "平衡", "提膝", "体能", "跑", "敏捷", "速度", "折返"],
  control: ["颠球", "控球", "球感", "停球"],
  passing: ["传", "接球"],
  attack: ["射门", "突破", "进攻"],
  teamwork: ["配合", "传接", "对抗", "小组"],
  defense: ["防守", "抢断", "对抗", "拦截"],
  saving: ["扑救", "守门", "门将"],
  reaction: ["反应", "扑救", "敏捷"],
  handling: ["手", "接球", "守门"],
  footwork: ["脚下", "传", "运球"],
  rushing: ["出击"],
  positioning: ["站位", "位置"],
};

function affinity(trainingType: string, key: AbilityKey): number {
  return AFFINITY[key].some((word) => trainingType.includes(word)) ? 6 : 0;
}

export function overallOf(scores: Scores, dims: AbilityKey[]): number {
  return mean(dims.map((d) => scores[d]).filter((v): v is number => typeof v === "number"));
}

/** 由分数反推定性档位，阈值与 AI 报告四档的量级对齐。 */
export function levelOf(score: number): string {
  if (score >= 85) return "优秀";
  if (score >= 75) return "良好";
  if (score >= 62) return "一般";
  return "待提升";
}

/** 只有分析完成、且识别到了足球训练内容的视频才参与能力计算。 */
export function isAnalysable(video: VideoRecord): boolean {
  if (video.status !== "done" || !video.report) return false;
  return (video.report.training_type || video.training_type) !== UNRECOGNISED;
}

/**
 * 单条视频的六维能力分。返回 null 表示这条视频不适合评估能力（未完成或未识别到训练内容），
 * 此时界面应说明原因，而不是编一组分数。
 */
export function videoAbilities(video: VideoRecord, position: Position): SessionAbilities | null {
  if (!isAnalysable(video) || !video.report) return null;
  const report = video.report;
  const dims = POSITION_DIMENSIONS[position];

  // 真实数据：AI 输出了本位置全部六项能力分时直接使用。
  const live = report.abilities;
  if (live && dims.every((d) => typeof live[d] === "number")) {
    const scores: Scores = {};
    for (const d of dims) scores[d] = clamp(Math.round(live[d] as number), 0, 100);
    return { scores, overall: overallOf(scores, dims), source: "live" };
  }

  // 示例数据：星级定基准，训练项目加成，按视频 id 做确定性浮动。
  const base = RATING_BASE[report.rating] ?? 64;
  const trainingType = report.training_type || video.training_type || "";
  const scores: Scores = {};
  for (const d of dims) {
    const jitter = (seeded(`v${video.id}:${d}`) - 0.5) * 18;
    scores[d] = clamp(Math.round(base + jitter + affinity(trainingType, d)), 35, 98);
  }
  return { scores, overall: overallOf(scores, dims), source: "mock" };
}

export interface Session {
  key: string;
  videoId: number | null;
  date: Date;
  /** 训练01、训练02……按时间先后编号 */
  label: string;
  trainingType: string;
  level: string;
  scores: Scores;
  overall: number;
  /** 整次训练都是为补齐图表结构生成的示例，没有对应的真实视频。 */
  isMock: boolean;
  /** 能力分的来源：真实视频的能力分目前也是推算值，所以这里单独标注。 */
  scoreSource: DataSource;
  highlights: string[];
  issues: string[];
}

/** 历史不足这么多次时补示例训练，让变化趋势有结构可看。 */
export const MIN_SESSIONS = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildHistory(
  studentId: number,
  videos: VideoRecord[],
  position: Position,
): { sessions: Session[]; unrecognised: number } {
  const dims = POSITION_DIMENSIONS[position];
  const done = videos.filter((v) => v.status === "done" && v.report);
  const unrecognised = done.filter((v) => !isAnalysable(v)).length;

  const real: Session[] = [];
  const ordered = done
    .filter(isAnalysable)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const v of ordered) {
    const abilities = videoAbilities(v, position);
    if (!abilities || !v.report) continue;
    real.push({
      key: `v${v.id}`,
      videoId: v.id,
      date: new Date(v.created_at),
      label: "",
      trainingType: v.report.training_type || v.training_type,
      level: v.report.level,
      scores: abilities.scores,
      overall: abilities.overall,
      isMock: false,
      scoreSource: abilities.source,
      highlights: v.report.highlights ?? [],
      issues: v.report.issues ?? [],
    });
  }

  const sessions = [...mockLeadIn(studentId, real, dims, MIN_SESSIONS - real.length), ...real];
  sessions.forEach((s, i) => {
    s.label = `训练${String(i + 1).padStart(2, "0")}`;
  });
  return { sessions, unrecognised };
}

/**
 * 在第一次真实训练之前按周补若干次示例训练，分数逐次上升并衔接到第一次真实训练，
 * 这样示例只负责“把趋势画出来”，真实记录仍然是图上最新的点。
 */
function mockLeadIn(studentId: number, real: Session[], dims: AbilityKey[], count: number): Session[] {
  if (count <= 0) return [];
  const anchor = real[0];
  const anchorDate = anchor ? anchor.date : new Date();
  const out: Session[] = [];

  for (let k = count; k >= 1; k--) {
    const scores: Scores = {};
    for (const d of dims) {
      const target = anchor?.scores[d] ?? 60 + Math.round(seeded(`base:${studentId}:${d}`) * 12);
      const jitter = (seeded(`mock:${studentId}:${k}:${d}`) - 0.5) * 6;
      scores[d] = clamp(Math.round(target - k * 3.5 + jitter), 35, 95);
    }
    const overall = overallOf(scores, dims);
    out.push({
      key: `mock-${k}`,
      videoId: null,
      date: new Date(anchorDate.getTime() - k * 7 * DAY_MS),
      label: "",
      trainingType: "示例训练",
      level: levelOf(overall),
      scores,
      overall,
      isMock: true,
      scoreSource: "mock",
      highlights: [],
      issues: [],
    });
  }
  return out;
}

export type TimeRange = "1m" | "3m" | "6m" | "all";

export const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "1m", label: "近 1 个月" },
  { value: "3m", label: "近 3 个月" },
  { value: "6m", label: "近半年" },
  { value: "all", label: "全部" },
];

export const rangeLabel = (range: TimeRange) => TIME_RANGES.find((r) => r.value === range)?.label ?? "全部";

export function inRange(date: Date, range: TimeRange, now = new Date()): boolean {
  if (range === "all") return true;
  const months = range === "1m" ? 1 : range === "3m" ? 3 : 6;
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  return date >= from;
}

export function withinRange(sessions: Session[], range: TimeRange, now = new Date()): Session[] {
  return sessions.filter((s) => inRange(s.date, range, now));
}

/** 长期画像取最近几次训练的平均，单次视频的偶然发挥不会让画像大起大落。 */
export const PROFILE_WINDOW = 3;

export function currentProfile(sessions: Session[], dims: AbilityKey[], window = PROFILE_WINDOW): Scores {
  const recent = sessions.slice(-window);
  const out: Scores = {};
  for (const d of dims) {
    const values = recent.map((s) => s.scores[d]).filter((v): v is number => typeof v === "number");
    if (values.length) out[d] = mean(values);
  }
  return out;
}

export interface EvaluationFieldRef {
  key: string;
  label: string;
}

/**
 * 「各项平均评分」的五项：常规评价里全队通用的训练态度、团队纪律，
 * 加上当前位置的三项位置专项（常规、期中、期末、赛事评价都会打）。
 */
export function evaluationFields(position: Position): EvaluationFieldRef[] {
  return [
    { key: "attitude", label: "训练态度" },
    { key: "discipline", label: "团队纪律" },
    ...POSITION_ITEMS[position].map((i) => ({ key: `pos_${i.key}`, label: i.label })),
  ];
}

export interface TeacherEvaluation {
  key: string;
  date: Date;
  /** 评价表的类型和名称；示例数据为对应的训练编号 */
  title: string;
  /** 1~5 星，老师没评的项为空 */
  scores: Record<string, number>;
  highlight: string;
  improve: string;
  source: DataSource;
}

const EVALUATION_KIND_LABELS: Record<string, string> = {
  routine: "常规评价",
  layered: "分层评价",
  midterm: "期中评价",
  final: "期末评价",
  match: "赛事评价",
};

/** 带位置专项的四种评价表，都能为球员能力提供星级。 */
const POSITIONAL_KINDS = new Set(["routine", "midterm", "final", "match"]);

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** 真实教学评价：「智能评价」里常规、期中、期末、赛事评价的星级，以及常规、期中评价的亮点和改进点。 */
export function liveEvaluations(records: StudentEvaluationRecord[], position: Position): TeacherEvaluation[] {
  const fields = evaluationFields(position);
  const out: TeacherEvaluation[] = [];
  for (const r of records) {
    if (!POSITIONAL_KINDS.has(r.kind)) continue;
    const scores: Record<string, number> = {};
    for (const { key } of fields) {
      const v = r.values[key];
      if (typeof v === "number" && v >= 1 && v <= 5) scores[key] = v;
    }
    const text = (key: string) => {
      const v = r.values[key];
      return (r.kind === "routine" || r.kind === "midterm") && typeof v === "string" ? v : "";
    };
    const highlight = text("highlight");
    const improve = text("improve");
    if (!Object.keys(scores).length && !highlight && !improve) continue;
    out.push({
      key: `e${r.sheet_id}`,
      date: parseLocalDate(r.lesson_date),
      title: `${EVALUATION_KIND_LABELS[r.kind] ?? "评价"} · ${r.title}`,
      scores,
      highlight,
      improve,
      source: "live",
    });
  }
  return out;
}

/** 出勤统计：常规评价里的出勤情况，只统计所选时间范围内的课。 */
export function attendanceSummary(
  records: StudentEvaluationRecord[],
  range: TimeRange,
): { total: number; present: number; detail: string } | null {
  const marks = records
    .filter((r) => r.kind === "routine" && inRange(parseLocalDate(r.lesson_date), range))
    .map((r) => r.values.attendance)
    .filter((v): v is string => typeof v === "string");
  if (!marks.length) return null;
  const counts = new Map<string, number>();
  for (const m of marks) counts.set(m, (counts.get(m) ?? 0) + 1);
  const detail = [...counts]
    .filter(([k]) => k !== "出勤")
    .map(([k, n]) => `${k} ${n}`)
    .join("、");
  return { total: marks.length, present: counts.get("出勤") ?? 0, detail };
}

const scoreToStars = (score: number) => (score >= 85 ? 5 : score >= 75 ? 4 : score >= 62 ? 3 : score >= 50 ? 2 : 1);

/** 示例教学评价：每次训练一条，把该次综合能力换算成星级；态度、纪律通常高于技术项。 */
export function mockEvaluations(studentId: number, sessions: Session[], position: Position): TeacherEvaluation[] {
  const fields = evaluationFields(position);
  return sessions.map((s) => {
    const scores: Record<string, number> = {};
    for (const { key } of fields) {
      const bias = key === "attitude" ? 8 : key === "discipline" ? 5 : 0;
      const jitter = (seeded(`eval:${studentId}:${s.key}:${key}`) - 0.5) * 14;
      scores[key] = scoreToStars((s.overall || 66) + bias + jitter);
    }
    return { key: `m-${s.key}`, date: s.date, title: s.label, scores, highlight: "", improve: "", source: "mock" };
  });
}

export interface EvaluationAverage {
  key: string;
  label: string;
  /** 平均星级，保留一位小数 */
  value: number | null;
  /** 有打分的课次数 */
  count: number;
}

export function evaluationAverages(evaluations: TeacherEvaluation[], fields: EvaluationFieldRef[]): EvaluationAverage[] {
  return fields.map(({ key, label }) => {
    const values = evaluations.map((e) => e.scores[key]).filter((v): v is number => typeof v === "number");
    const value = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
    return { key, label, value, count: values.length };
  });
}

export function levelDistribution(sessions: Session[]) {
  return LEVELS.map((level) => ({ level, count: sessions.filter((s) => s.level === level).length }));
}

export interface Note {
  text: string;
  date: Date;
  origin: "视频分析" | "课堂评价";
}

/** 最近的亮点或问题：视频分析与老师的课堂评价合并，按时间倒序去重后取前几条。 */
export function recentNotes(
  sessions: Session[],
  evaluations: TeacherEvaluation[],
  field: "highlights" | "issues",
  limit = 3,
): Note[] {
  const pool: Note[] = [];
  for (const s of sessions) for (const text of s[field]) pool.push({ text, date: s.date, origin: "视频分析" });
  for (const e of evaluations) {
    if (e.source !== "live") continue;
    const text = field === "highlights" ? e.highlight : e.improve;
    if (text) pool.push({ text, date: e.date, origin: "课堂评价" });
  }
  pool.sort((a, b) => b.date.getTime() - a.date.getTime());

  const seen = new Set<string>();
  const out: Note[] = [];
  for (const note of pool) {
    if (seen.has(note.text)) continue;
    seen.add(note.text);
    out.push(note);
    if (out.length >= limit) break;
  }
  return out;
}

export function fmtShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export interface DataSourceField {
  metric: string;
  field: string;
  origin: string;
  status: DataSource;
}

/** 每个指标的数据来源字段。能力分接入 AI 输出后把对应项改为 live 即可。 */
export function dataSources(evaluationsLive: boolean): DataSourceField[] {
  return [
    {
      metric: "每次视频的六维能力分",
      field: "report.abilities.<能力键>",
      origin: "视频分析结果（AI 输出，待接入）",
      status: "mock",
    },
    { metric: "综合能力分", field: "六维能力分的平均值", origin: "由能力分计算", status: "mock" },
    { metric: "能力雷达", field: "最近 3 次训练能力分的平均", origin: "由能力分计算", status: "mock" },
    { metric: "表现等级占比", field: "report.level", origin: "视频分析结果", status: "live" },
    {
      metric: "本课亮点",
      field: "report.highlights[]；常规/期中评价 values.highlight",
      origin: "视频分析结果 + 智能评价",
      status: "live",
    },
    {
      metric: "需改进",
      field: "report.issues[]；常规/期中评价 values.improve",
      origin: "视频分析结果 + 智能评价",
      status: "live",
    },
    { metric: "训练时间 / 训练次数", field: "video.created_at", origin: "视频记录", status: "live" },
    { metric: "场上位置", field: "student.position", origin: "学生档案", status: "live" },
    {
      metric: "训练态度 / 团队纪律 / 位置专项",
      field: "常规评价 values.attitude / discipline；常规/期中/期末/赛事评价 values.pos_<能力键>（1~5 星）",
      origin: evaluationsLive ? "智能评价" : "智能评价（该学生暂无记录）",
      status: evaluationsLive ? "live" : "mock",
    },
    { metric: "出勤", field: "常规评价 values.attendance", origin: "智能评价", status: "live" },
  ];
}

export interface PlayerExportData {
  student: Student;
  position: Position;
  positionIsDefault: boolean;
  range: TimeRange;
  sessions: Session[];
  dims: AbilityKey[];
  profile: Scores;
  overall: number;
  evaluations: TeacherEvaluation[];
}

export const playerFilename = (student: Student) => `${student.name}_球员能力_${fileStamp()}`;

/** 球员能力导出为 Excel：能力概览、历次训练、课堂评价三个工作表，示例数据逐行标注来源。 */
export function playerWorkbook(d: PlayerExportData): XlsxSheet[] {
  const real = d.sessions.filter((s) => !s.isMock);
  const mockCount = d.sessions.length - real.length;
  const scoresMock = d.sessions.some((s) => s.scoreSource === "mock");
  const first = d.sessions[0];
  const last = d.sessions[d.sessions.length - 1];
  const evaluationsLive = d.evaluations.some((e) => e.source === "live");
  const fields = evaluationFields(d.position);
  const delta = (a?: number, b?: number): XlsxCell => (a !== undefined && b !== undefined ? b - a : null);

  const overview: XlsxSheet = {
    name: "能力概览",
    title: `${d.student.name} · 球员能力档案`,
    meta: [
      ["学号", d.student.student_no || "—"],
      ["班级", d.student.class_name || "未分班"],
      ["场上位置", d.positionIsDefault ? `${d.position}（未设置，按中场维度）` : d.position],
      ["统计范围", rangeLabel(d.range)],
      ["训练次数", `${real.length} 次${mockCount ? `（另补充示例训练 ${mockCount} 次）` : ""}`],
      [
        "综合能力",
        `${d.overall} 分 · ${levelOf(d.overall)}（近 ${Math.min(PROFILE_WINDOW, d.sessions.length)} 次训练平均）`,
      ],
      ["导出时间", nowText()],
    ],
    columns: [
      { header: "能力", width: 10 },
      { header: "当前（近 3 次平均）", width: 18 },
      { header: "首次", width: 8 },
      { header: "最近一次", width: 10 },
      { header: "变化", width: 8 },
    ],
    rows: [
      ...d.dims.map((dim): XlsxCell[] => [
        ABILITY_LABELS[dim],
        d.profile[dim] ?? null,
        first?.scores[dim] ?? null,
        last?.scores[dim] ?? null,
        delta(first?.scores[dim], last?.scores[dim]),
      ]),
      ["综合能力", d.overall, first?.overall ?? null, last?.overall ?? null, delta(first?.overall, last?.overall)],
    ],
    notes: scoresMock
      ? ["能力分目前为示例数据：由真实的综合表现星级和训练项目推算，只用于搭好图表结构，不是测量值，不宜作为正式成绩依据。"]
      : [],
  };

  const history: XlsxSheet = {
    name: "历次训练",
    columns: [
      { header: "训练", width: 8 },
      { header: "日期", width: 12 },
      { header: "训练项目", width: 18 },
      { header: "表现等级", width: 10 },
      ...d.dims.map((dim) => ({ header: ABILITY_LABELS[dim], width: 8 })),
      { header: "综合", width: 8 },
      { header: "数据来源", width: 24 },
    ],
    rows: d.sessions.map((s) => [
      s.label,
      todayISO(s.date),
      s.trainingType,
      s.level,
      ...d.dims.map((dim) => s.scores[dim] ?? null),
      s.overall,
      s.isMock ? "示例训练" : s.scoreSource === "mock" ? "真实训练（能力分为示例）" : "分析记录",
    ]),
  };

  const evaluations: XlsxSheet = {
    name: "课堂评价",
    columns: [
      { header: "日期", width: 12 },
      { header: evaluationsLive ? "评价表" : "训练", width: 24 },
      ...fields.map((f) => ({ header: `${f.label}（星）`, width: 12 })),
      { header: "亮点", width: 26 },
      { header: "需改进", width: 26 },
      { header: "数据来源", width: 12 },
    ],
    rows: d.evaluations.map((e) => [
      todayISO(e.date),
      e.title,
      ...fields.map((f) => e.scores[f.key] ?? null),
      e.highlight || null,
      e.improve || null,
      e.source === "live" ? "课堂评价" : "示例数据",
    ]),
    notes: [
      evaluationsLive
        ? "来自「智能评价」里老师的打分，1~5 星；训练态度、团队纪律来自常规评价，位置专项来自常规、期中、期末和赛事评价。"
        : "该学生还没有课堂评价记录，以上为示例数据；在「智能评价」中打分后自动改用真实评分。",
    ],
  };

  return [overview, history, evaluations];
}
