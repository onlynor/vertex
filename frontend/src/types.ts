export type VideoStatus = "pending" | "processing" | "done" | "failed";

export interface Teacher {
  id: number;
  username: string;
  name: string;
  role: string;
  phone?: string;
  created_at: string;
}

export interface Student {
  id: number;
  name: string;
  student_no: string;
  class_name: string;
  gender: string;
  age: number;
  /** 场上位置：前锋 / 中场 / 后卫 / 门将；空字符串表示未设置。 */
  position?: string;
  teacher_id: number;
  created_at: string;
}

export interface AnalysisReport {
  /** 模型从画面中识别出的训练项目，而非固定配置。 */
  training_type: string;
  summary: string;
  performance: string;
  level: string;
  rating: number;
  highlights: string[];
  issues: string[];
  suggestions: string[];
  /**
   * 预留字段：AI 输出的分项能力分（0~100），键名见 lib/abilities.ts 的 AbilityKey。
   * 当前分析结果还没有这个字段，前端会用推算的示例值代替并标注来源。
   */
  abilities?: Record<string, number>;
}

export interface VideoRecord {
  id: number;
  task_id: string;
  student_id: number;
  teacher_id: number;
  student_name: string;
  filename: string;
  size_bytes: number;
  duration_sec: number;
  training_type: string;
  status: VideoStatus;
  video_stored: boolean;
  error_msg?: string;
  created_at: string;
  completed_at: string | null;
  report: AnalysisReport | null;
  /** 后端随视频一起预加载的学生档案，用于读取位置等信息。 */
  student?: Student;
}

export interface TrendPoint {
  date: string;
  videos: number;
  reports: number;
}

export interface StatsOverview {
  week_videos: number;
  week_reports: number;
  prev_week_videos: number;
  prev_week_reports: number;
  total_students: number;
  avg_duration_sec: number;
  trend: TrendPoint[];
}

export interface StudentImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface LLMSettings {
  base_url: string;
  model: string;
  api_key_masked: string;
  has_api_key: boolean;
}

/* ---------- 智能评价 ---------- */

export type EvaluationKind = "routine" | "layered" | "midterm" | "final" | "match";

export interface EvaluationField {
  key: string;
  label: string;
  /** position 为位置专项：按这一行的场上位置显示对应几项星级，值存为 pos_<能力键> */
  type: "stars" | "number" | "text" | "choice" | "position";
  /** 星级 1~5 各档的含义，下标 0 对应 1 星 */
  levels?: string[];
  /** 星级可以记为 0，表示「未参与」（旧版分层任务表） */
  allow_zero?: boolean;
  options?: string[];
  max?: number;
  unit?: string;
  /** 背景信息（如场上位置），填了也不算已评价 */
  context?: boolean;
  /** 只能由老师录入的客观事实（出勤、成绩、进球数），AI 一键评价不会填 */
  manual?: boolean;
  placeholder?: string;
}

/** 位置专项中的一项，键名与球员能力的能力键一致 */
export interface PositionItem {
  key: string;
  label: string;
  /** 观察要点 */
  look: string;
}

/** 分层评价的练习项目：测评方式、单位和三层达标线 */
export interface Drill {
  key: string;
  label: string;
  measure: string;
  unit: string;
  lower_is_better: boolean;
  /** 基础层、提高层、挑战层的达标线 */
  thresholds: [number, number, number];
  method?: string;
}

/** 表头附加信息：分层评价的练习项目、期中期末的统计区间、记录方式 */
export interface EvaluationOptions {
  drill?: Drill;
  period_start?: string;
  record_method?: string;
}

export interface EvaluationKindSchema {
  /** 五种新类型之一；升级前建的表为 legacy_ 开头的旧版类型 */
  key: string;
  legacy?: boolean;
  label: string;
  description: string;
  title_label: string;
  title_placeholder: string;
  date_label: string;
  fields: EvaluationField[];
  uses_position: boolean;
  uses_drill: boolean;
  uses_period: boolean;
  compare_videos: boolean;
  same_day_video: boolean;
  record_methods?: string[];
}

export interface EvaluationSchema {
  kinds: EvaluationKindSchema[];
  /** 升级前的旧版类型，只用来打开已有的表 */
  legacy_kinds?: EvaluationKindSchema[];
  positions: string[];
  position_items: Record<string, PositionItem[]>;
  position_prefix: string;
  drills: Drill[];
  tiers: string[];
}

export type EvaluationValue = number | string;
export type EvaluationValues = Record<string, EvaluationValue>;

/** 学生在评价日期当天及之前最近一次视频分析的摘要 */
export interface EvaluationVideoRef {
  id: number;
  date: string;
  training_type: string;
  level: string;
  rating: number;
  highlight: string;
  issue: string;
}

export interface EvaluationEntry {
  student_id: number;
  student_name: string;
  student_no: string;
  position: string;
  values: EvaluationValues;
  comment: string;
  /** ai：AI 生成且未改动；manual：老师填写或修改过 */
  comment_source: "" | "ai" | "manual";
  /** 由「AI 一键评价」填出、老师还没改过的评价项键名 */
  ai_fields: string[];
  /** 这张表关心的时间范围内最近一段视频（赛事为比赛当天、期中期末为统计区间） */
  video: EvaluationVideoRef | null;
  /** 期末评价：统计区间内的第一段视频，用来对比期初和期末 */
  video_first?: EvaluationVideoRef | null;
  video_count: number;
}

export interface EvaluationSheetSummary {
  id: number;
  teacher_id: number;
  kind: string;
  class_name: string;
  title: string;
  lesson_date: string;
  teacher_name: string;
  student_count: number;
  recorded_count: number;
  commented_count: number;
  options: EvaluationOptions;
  created_at: string;
  updated_at: string;
}

export interface EvaluationSheet extends EvaluationSheetSummary {
  summary: string;
  entries: EvaluationEntry[];
}

export interface EvaluationSavePayload {
  title: string;
  lesson_date: string;
  teacher_name: string;
  summary: string;
  options: EvaluationOptions;
  entries: Pick<EvaluationEntry, "student_id" | "values" | "comment" | "comment_source" | "ai_fields">[];
}

/** AI 一键评价的结果：这次填出来的评价项和评语 */
export interface EvaluationFillResult {
  student_id: number;
  values?: EvaluationValues;
  fields?: string[];
  comment?: string;
  error?: string;
}

/** 某名学生在一张评价表中的记录，供球员能力页使用 */
export interface StudentEvaluationRecord {
  sheet_id: number;
  kind: string;
  class_name: string;
  title: string;
  lesson_date: string;
  values: EvaluationValues;
  comment: string;
}

/* ---------- 班级 ---------- */

export interface ClassInfo {
  name: string;
  count: number;
  boys: number;
  girls: number;
  /** 统一写法后的名称，与 name 相同表示不需要调整 */
  normalized: string;
}

/* ---------- 数据大屏 ---------- */

export interface ScreenStudent {
  id: number;
  name: string;
  position: string;
  level: string;
}

export interface ScreenClass {
  name: string;
  students: ScreenStudent[];
  videos: number;
  excellent: number;
  avg_rating: number;
}

export interface ScreenMoment {
  video_id: number;
  student_id: number;
  student: string;
  class_name: string;
  training_type: string;
  level: string;
  text: string;
  date: string;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface ScreenStats {
  totals: { students: number; classes: number; videos: number; reports: number; sheets: number; comments: number };
  levels: NameCount[];
  positions: NameCount[];
  training_types: NameCount[];
  classes: ScreenClass[];
  moments: ScreenMoment[];
  stars: ScreenMoment[];
  stars_label: string;
  trend: TrendPoint[];
}

/* ---------- Excel 导出 ---------- */

export type XlsxCell = string | number | null;

export interface XlsxSheet {
  name: string;
  title?: string;
  /** 表格上方的键值信息，如「班级：三年级一班」 */
  meta?: [string, string][];
  columns: { header: string; width?: number }[];
  rows: XlsxCell[][];
  /** 表格下方的说明文字 */
  notes?: string[];
}
