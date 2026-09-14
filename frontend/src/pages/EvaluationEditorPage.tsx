import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import EvaluationSheetDialog, { type SheetForm } from "../components/EvaluationSheetDialog";
import {
  IconAlert,
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconPencil,
  IconPlus,
  IconReport,
  IconSpark,
  IconTrash,
} from "../components/Icons";
import EvaluationPrint from "../components/print/EvaluationPrint";
import { PrintPortal, type PrintJob } from "../components/print/PrintKit";
import StarInput from "../components/StarInput";
import { BarList, Button, Card, EmptyState, Progress, SectionHeader, Select, Spinner, Toast } from "../components/ui";
import { api } from "../lib/api";
import {
  classLabel,
  columnTitle,
  copyText,
  evaluationFilename,
  evaluationWorkbook,
  fieldStats,
  findKind,
  fmtLessonDate,
  isRecorded,
  kindTone,
  needsFill,
  optionLines,
  positionItems,
  positionStats,
  summable,
  tierFor,
  useEvaluationSchema,
  withPosition,
  withValue,
  type SheetHeader,
} from "../lib/evaluation";
import type {
  Drill,
  EvaluationEntry,
  EvaluationField,
  EvaluationFillResult,
  EvaluationKindSchema,
  EvaluationOptions,
  EvaluationSchema,
  EvaluationSheet,
  EvaluationValue,
  EvaluationVideoRef,
  Student,
} from "../types";

/** 停止输入这么久后自动保存。 */
const AUTOSAVE_DELAY = 800;
/** 每次请求为几名学生生成评语：后端并发处理，分批是为了能显示进度、随时停止。 */
const COMMENT_BATCH = 4;
/** 一键评价一次填几名学生：整行内容比评语长，批小一点进度走得更稳。 */
const FILL_BATCH = 3;

interface Draft {
  title: string;
  lesson_date: string;
  teacher_name: string;
  summary: string;
  options: EvaluationOptions;
  entries: EvaluationEntry[];
}

type SaveState = "saved" | "pending" | "saving" | "error";

function toDraft(sheet: EvaluationSheet): Draft {
  return {
    title: sheet.title,
    lesson_date: sheet.lesson_date,
    teacher_name: sheet.teacher_name,
    summary: sheet.summary,
    options: sheet.options ?? {},
    entries: sheet.entries,
  };
}

function toPayload(d: Draft) {
  return {
    title: d.title,
    lesson_date: d.lesson_date,
    teacher_name: d.teacher_name,
    summary: d.summary,
    options: d.options,
    entries: d.entries.map(({ student_id, values, comment, comment_source, ai_fields }) => ({
      student_id,
      values,
      comment,
      comment_source,
      ai_fields,
    })),
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** 「从视频预填」按评价类型做不同的事；分层评价没有可预填的内容。 */
function prefillSpec(kind: EvaluationKindSchema): { label: string; hint: string } | null {
  if (kind.compare_videos) {
    return { label: "按视频对比预填", hint: "按期初、期末两段视频的表现变化，给空着的「成长进步」填一个建议星级" };
  }
  if (kind.same_day_video) {
    return { label: "从比赛录像预填", hint: "用比赛当天录像分析里做得好的地方，填写空着的赛后记录" };
  }
  if (kind.fields.some((f) => f.key === "highlight") && kind.fields.some((f) => f.key === "improve")) {
    return { label: "从视频预填", hint: "用最近一次视频分析的亮点和问题，填写空着的亮点、改进点" };
  }
  return null;
}

export default function EvaluationEditorPage() {
  const { id } = useParams<{ id: string }>();
  const sheetId = Number(id);
  const navigate = useNavigate();
  const { schema, error: schemaError } = useEvaluationSchema();
  const [sheet, setSheet] = useState<EvaluationSheet | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [panel, setPanel] = useState<"batch" | "ai" | "add" | null>(null);
  const [aiScope, setAiScope] = useState<"missing" | "all">("missing");
  const [aiMode, setAiMode] = useState<"fill" | "comment">("fill");
  const [alsoSummary, setAlsoSummary] = useState(true);
  const [editingHeader, setEditingHeader] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyRows, setBusyRows] = useState<number[]>([]);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // 自动保存：draftRef 始终是最新内容；同一时间只有一个保存请求，后发的等前一个回来再发。
  const draftRef = useRef<Draft | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const stopRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kind = schema && sheet ? (findKind(schema, sheet.kind) ?? null) : null;

  const flash = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getEvaluation(sheetId)
      .then((data) => {
        if (cancelled) return;
        const d = toDraft(data);
        draftRef.current = d;
        dirtyRef.current = false;
        setSheet(data);
        setDraft(d);
        setSavedAt(new Date(data.updated_at));
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : "加载失败"));
    api
      .listStudents()
      .then((res) => !cancelled && setStudents(res.items))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sheetId]);

  const persist = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    while (inflightRef.current) await inflightRef.current;
    const snapshot = draftRef.current;
    if (!dirtyRef.current || !snapshot) return true;
    dirtyRef.current = false;
    setSaveState("saving");
    const request = api
      .saveEvaluation(sheetId, toPayload(snapshot))
      .then((res) => {
        setSavedAt(new Date(res.updated_at));
        lastErrorRef.current = null;
        return true;
      })
      .catch((err: unknown) => {
        dirtyRef.current = true;
        lastErrorRef.current = err instanceof Error ? err.message : "保存失败";
        flash(`保存失败：${lastErrorRef.current}`, "error");
        return false;
      })
      .finally(() => {
        inflightRef.current = null;
      });
    inflightRef.current = request;
    const ok = await request;
    setSaveState(!ok ? "error" : dirtyRef.current ? "pending" : "saved");
    return ok;
  }, [sheetId, flash]);

  /** 把所有未保存的改动存完；生成评语、导出前调用，保证后端读到的是最新内容。 */
  const flush = useCallback(async () => {
    let ok = true;
    do {
      ok = await persist();
    } while (ok && dirtyRef.current);
    return ok;
  }, [persist]);

  const update = useCallback(
    (mutate: (d: Draft) => Draft) => {
      const current = draftRef.current;
      if (!current) return;
      const next = mutate(current);
      draftRef.current = next;
      setDraft(next);
      dirtyRef.current = true;
      setSaveState("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persist(), AUTOSAVE_DELAY);
    },
    [persist],
  );

  // 离开页面（切到别的菜单、关闭标签页）时把最后的改动发出去。
  useEffect(() => {
    const saveOnExit = () => {
      if (!dirtyRef.current || !draftRef.current) return;
      dirtyRef.current = false;
      void api.saveEvaluation(sheetId, toPayload(draftRef.current), { keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", saveOnExit);
    return () => {
      window.removeEventListener("pagehide", saveOnExit);
      if (timerRef.current) clearTimeout(timerRef.current);
      saveOnExit();
    };
  }, [sheetId]);

  /** 日期、统计区间或学生变化后，重新取相关视频（不影响正在编辑的内容）。 */
  const refreshVideos = useCallback(async () => {
    try {
      const fresh = await api.getEvaluation(sheetId);
      const byId = new Map(fresh.entries.map((e) => [e.student_id, e]));
      const current = draftRef.current;
      if (!current) return;
      const next = {
        ...current,
        entries: current.entries.map((e) => {
          const f = byId.get(e.student_id);
          return { ...e, video: f?.video ?? null, video_first: f?.video_first ?? null, video_count: f?.video_count ?? 0 };
        }),
      };
      draftRef.current = next;
      setDraft(next);
    } catch {
      // 视频提示刷新失败不影响编辑
    }
  }, [sheetId]);

  const setValue = useCallback(
    (studentId: number, key: string, value: EvaluationValue | undefined) =>
      update((d) => ({
        ...d,
        entries: d.entries.map((e) => {
          if (e.student_id !== studentId) return e;
          let values = withValue(e.values, key, value);
          // 分层评价：填了成绩就按达标线自动判断达到哪一层，老师仍可以手动改。
          if (key === "score" && d.options.drill && schema) {
            values = withValue(
              values,
              "tier",
              typeof value === "number" ? tierFor(d.options.drill, value, schema.tiers) : undefined,
            );
          }
          return { ...e, values, ai_fields: e.ai_fields.filter((k) => k !== key) };
        }),
      })),
    [update, schema],
  );

  const setPosition = useCallback(
    (studentId: number, position: string) => {
      if (!schema) return;
      update((d) => ({
        ...d,
        entries: d.entries.map((e) => {
          if (e.student_id !== studentId) return e;
          const values = withPosition(e.values, position, schema);
          return { ...e, values, ai_fields: e.ai_fields.filter((k) => values[k] !== undefined) };
        }),
      }));
    },
    [update, schema],
  );

  const setComment = useCallback(
    (studentId: number, comment: string, source: "ai" | "manual") =>
      update((d) => ({
        ...d,
        entries: d.entries.map((e) =>
          e.student_id === studentId ? { ...e, comment, comment_source: comment ? source : "" } : e,
        ),
      })),
    [update],
  );

  const editComment = useCallback((studentId: number, text: string) => setComment(studentId, text, "manual"), [setComment]);

  const removeStudent = useCallback(
    (entry: EvaluationEntry) => {
      const hasData = (kind && isRecorded(kind, entry.values)) || entry.comment.trim();
      if (hasData && !confirm(`${entry.student_name} 已有评价内容，确定从表中移除吗？`)) return;
      update((d) => ({ ...d, entries: d.entries.filter((e) => e.student_id !== entry.student_id) }));
    },
    [kind, update],
  );

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      flash(ok ? "已复制" : "复制失败，请手动选中文字复制", ok ? "success" : "error");
    },
    [flash],
  );

  /** 把一名学生的一键评价结果并进表格，并记下哪些格子是 AI 填的。 */
  const applyFill = useCallback(
    (item: EvaluationFillResult) =>
      update((d) => ({
        ...d,
        entries: d.entries.map((e) => {
          if (e.student_id !== item.student_id) return e;
          const values = { ...e.values, ...(item.values ?? {}) };
          const marked = new Set([...e.ai_fields, ...(item.fields ?? [])]);
          return {
            ...e,
            values,
            ai_fields: [...marked].filter((k) => values[k] !== undefined && values[k] !== ""),
            comment: item.comment || e.comment,
            comment_source: item.comment ? "ai" : e.comment_source,
          };
        }),
      })),
    [update],
  );

  const fillOne = useCallback(
    async (studentId: number) => {
      setBusyRows((rows) => [...rows, studentId]);
      try {
        if (!(await flush())) throw new Error(lastErrorRef.current ?? "保存失败，请稍后重试");
        const res = await api.fillEvaluation(sheetId, [studentId], false);
        const item = res.items[0];
        if (item?.values || item?.comment) {
          applyFill(item);
          flash("已填好这一行，可以直接改");
        } else flash(item?.error ?? "生成失败，请重试", "error");
      } catch (err) {
        flash(err instanceof Error ? err.message : "生成失败，请重试", "error");
      } finally {
        setBusyRows((rows) => rows.filter((r) => r !== studentId));
      }
    },
    [flush, sheetId, applyFill, flash],
  );

  const generateOne = useCallback(
    async (studentId: number) => {
      const entry = draftRef.current?.entries.find((e) => e.student_id === studentId);
      if (!entry || !kind) return;
      if (!isRecorded(kind, entry.values)) {
        flash("先给这名学生打分或写记录，再生成评语", "error");
        return;
      }
      setBusyRows((rows) => [...rows, studentId]);
      try {
        if (!(await flush())) throw new Error(lastErrorRef.current ?? "保存失败，请稍后重试");
        const res = await api.generateComments(sheetId, [studentId]);
        const item = res.items[0];
        if (item?.comment) setComment(studentId, item.comment, "ai");
        else flash(item?.error ?? "生成失败，请重试", "error");
      } catch (err) {
        flash(err instanceof Error ? err.message : "生成失败，请重试", "error");
      } finally {
        setBusyRows((rows) => rows.filter((r) => r !== studentId));
      }
    },
    [kind, flush, sheetId, setComment, flash],
  );

  if (loadError || schemaError) {
    return (
      <Card className="mx-auto max-w-md p-10 text-center">
        <p className="text-[15px] font-medium text-slate-800">{loadError ?? schemaError}</p>
        <Button className="mt-5" onClick={() => navigate("/evaluations")}>
          返回评价表列表
        </Button>
      </Card>
    );
  }

  if (!sheet || !draft || !kind || !schema) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const header: SheetHeader = {
    class_name: sheet.class_name,
    title: draft.title,
    lesson_date: draft.lesson_date,
    teacher_name: draft.teacher_name,
    summary: draft.summary,
    options: draft.options,
  };
  const recordedIds = draft.entries.filter((e) => isRecorded(kind, e.values)).map((e) => e.student_id);
  const missingIds = draft.entries
    .filter((e) => isRecorded(kind, e.values) && !e.comment.trim())
    .map((e) => e.student_id);
  const unrecorded = draft.entries.length - recordedIds.length;
  // 一键评价：「只填空白」挑出还缺内容的学生，「全部重填」是表里的所有人。
  const fillMissingIds = draft.entries.filter((e) => needsFill(kind, schema, e)).map((e) => e.student_id);
  const allIds = draft.entries.map((e) => e.student_id);
  const aiTargets =
    aiMode === "fill"
      ? aiScope === "missing"
        ? fillMissingIds
        : allIds
      : aiScope === "missing"
        ? missingIds
        : recordedIds;
  const aiFilled = draft.entries.some((e) => e.ai_fields.length > 0);
  // 出勤、成绩、进球这类客观事实只能老师自己填，面板里如实说明。
  const manualLabels = kind.fields
    .filter((f) => !f.context && (f.manual || f.type === "number"))
    .map((f) => f.label)
    .join("、");
  const batchFields = kind.fields.filter((f) => (f.type === "stars" || f.type === "choice") && !f.context);
  const prefill = prefillSpec(kind);
  const prefillable = kind.compare_videos
    ? draft.entries.filter((e) => e.video_first && e.video).length
    : draft.entries.filter((e) => e.video).length;

  async function generateComments(ids: number[]) {
    setPanel(null);
    if (!ids.length) return;
    if (!(await flush())) {
      flash(lastErrorRef.current ?? "保存失败，请稍后重试", "error");
      return;
    }
    stopRef.current = false;
    setProgress({ done: 0, total: ids.length });
    let ok = 0;
    const errors: string[] = [];
    for (let i = 0; i < ids.length && !stopRef.current; i += COMMENT_BATCH) {
      const chunk = ids.slice(i, i + COMMENT_BATCH);
      try {
        const res = await api.generateComments(sheetId, chunk);
        for (const item of res.items) {
          if (item.comment) {
            setComment(item.student_id, item.comment, "ai");
            ok++;
          } else if (item.error) {
            errors.push(item.error);
          }
        }
      } catch (err) {
        // 整个请求失败（网络、配置问题）时后面的批次也会失败，直接停下。
        errors.push(err instanceof Error ? err.message : "生成失败");
        break;
      }
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setProgress(null);
    if (errors.length) flash(`已生成 ${ok} 条评语，${errors.length} 条失败：${errors[0]}`, ok ? "success" : "error");
    else flash(stopRef.current ? `已停止，生成了 ${ok} 条评语` : `已生成 ${ok} 条评语`);
  }

  /** AI 一键评价：分批把整行评价和评语填出来，可随时停止；填完顺手写课堂总评。 */
  async function runFill(ids: number[], overwrite: boolean) {
    setPanel(null);
    if (!ids.length) return;
    if (!(await flush())) {
      flash(lastErrorRef.current ?? "保存失败，请稍后重试", "error");
      return;
    }
    stopRef.current = false;
    setProgress({ done: 0, total: ids.length });
    let ok = 0;
    const errors: string[] = [];
    for (let i = 0; i < ids.length && !stopRef.current; i += FILL_BATCH) {
      const chunk = ids.slice(i, i + FILL_BATCH);
      try {
        const res = await api.fillEvaluation(sheetId, chunk, overwrite);
        for (const item of res.items) {
          if (item.values || item.comment) {
            applyFill(item);
            ok++;
          } else if (item.error) {
            errors.push(item.error);
          }
        }
      } catch (err) {
        // 整个请求失败（网络、配置问题）时后面的批次也会失败，直接停下。
        errors.push(err instanceof Error ? err.message : "生成失败");
        break;
      }
      setProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }
    setProgress(null);
    if (ok && alsoSummary && !stopRef.current) await generateSummary(true);
    if (errors.length) flash(`已评价 ${ok} 人，${errors.length} 人没填上：${errors[0]}`, ok ? "success" : "error");
    else flash(stopRef.current ? `已停止，评价了 ${ok} 人` : `已为 ${ok} 名学生填好评价，检查一下就能导出`);
  }

  async function generateSummary(silent = false) {
    setSummaryBusy(true);
    try {
      if (!(await flush())) throw new Error(lastErrorRef.current ?? "保存失败，请稍后重试");
      const res = await api.generateSummary(sheetId);
      update((d) => ({ ...d, summary: res.summary }));
      if (!silent) flash("已生成课堂总评");
    } catch (err) {
      if (!silent) flash(err instanceof Error ? err.message : "生成失败，请重试", "error");
    } finally {
      setSummaryBusy(false);
    }
  }

  function applyBatch(key: string, value: EvaluationValue, overwrite: boolean) {
    const field = kind?.fields.find((f) => f.key === key);
    let changed = 0;
    update((d) => ({
      ...d,
      entries: d.entries.map((e) => {
        if (!overwrite && e.values[key] !== undefined) return e;
        changed++;
        return { ...e, values: { ...e.values, [key]: value } };
      }),
    }));
    setPanel(null);
    const what = typeof value === "number" ? `${value} 星` : `「${value}」`;
    flash(changed ? `已为 ${changed} 名学生设置「${field?.label}」${what}` : "没有需要填写的学生（已填的不会覆盖）");
  }

  function prefillFromVideo() {
    if (!kind) return;
    let filled = 0;
    update((d) => ({
      ...d,
      entries: d.entries.map((e) => {
        const values = { ...e.values };
        if (kind.compare_videos) {
          if (values.growth === undefined && e.video_first && e.video) {
            values.growth = Math.max(1, Math.min(5, 3 + e.video.rating - e.video_first.rating));
          }
        } else if (kind.same_day_video) {
          if (!values.note && e.video?.highlight) values.note = e.video.highlight.slice(0, 200);
        } else if (e.video) {
          if (!values.highlight && e.video.highlight) values.highlight = e.video.highlight.slice(0, 200);
          if (!values.improve && e.video.issue) values.improve = e.video.issue.slice(0, 200);
        }
        if (JSON.stringify(values) === JSON.stringify(e.values)) return e;
        filled++;
        return { ...e, values };
      }),
    }));
    flash(filled ? `已为 ${filled} 名学生预填` : "没有可以预填的内容（已填写的不会覆盖）");
  }

  async function addStudents(list: Student[]) {
    if (!kind) return;
    setPanel(null);
    update((d) => ({
      ...d,
      entries: [
        ...d.entries,
        ...list.map(
          (s): EvaluationEntry => ({
            student_id: s.id,
            student_name: s.name,
            student_no: s.student_no,
            position: s.position ?? "",
            values: kind.uses_position && s.position ? { position: s.position } : {},
            comment: "",
            comment_source: "",
            ai_fields: [],
            video: null,
            video_count: 0,
          }),
        ),
      ],
    }));
    flash(`已加入 ${list.length} 名学生`);
    if (await flush()) void refreshVideos();
  }

  async function saveHeader(form: SheetForm) {
    update((d) => ({
      ...d,
      title: form.title.trim() || kind?.label || d.title,
      lesson_date: form.lesson_date,
      teacher_name: form.teacher_name.trim(),
      options: form.options,
    }));
    if (!(await flush())) throw new Error(lastErrorRef.current ?? "保存失败");
    setEditingHeader(false);
    void refreshVideos();
  }

  async function exportExcel() {
    if (!kind || !draft || !schema) return;
    setExporting(true);
    try {
      await api.exportXlsx(evaluationFilename(kind, header), evaluationWorkbook(schema, kind, header, draft.entries));
      flash("已导出 Excel 文件");
    } catch (err) {
      flash(err instanceof Error ? err.message : "导出失败，请重试", "error");
    } finally {
      setExporting(false);
    }
  }

  async function deleteSheet() {
    if (!draft || !confirm(`确定删除「${draft.title}」吗？表中的评价和评语会一起删除，且无法恢复。`)) return;
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      dirtyRef.current = false;
      await api.deleteEvaluation(sheetId);
      navigate("/evaluations");
    } catch (err) {
      flash(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  const rowProps: RowProps = {
    kind,
    schema,
    drill: draft.options.drill,
    onValue: setValue,
    onPosition: setPosition,
    onComment: editComment,
    onGenerate: generateOne,
    onFill: fillOne,
    onRemove: removeStudent,
    onCopy: copy,
  };
  const extraLines = optionLines(kind, header);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up">
        <Link
          to="/evaluations"
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 transition hover:text-slate-800"
        >
          <IconArrowLeft className="h-4 w-4" />
          全部评价表
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${kindTone(kind.key)}`}>{kind.label}</span>
              <h1 className="display-tight min-w-0 truncate text-[22px] font-semibold text-slate-900 sm:text-[28px]">
                {draft.title}
              </h1>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <span>{classLabel(sheet.class_name)}</span>
              <span className="text-slate-300">·</span>
              <span>{fmtLessonDate(draft.lesson_date)}</span>
              <span className="text-slate-300">·</span>
              <span>{draft.teacher_name || "未填写教师"}</span>
              <span className="text-slate-300">·</span>
              <span>{draft.entries.length} 名学生</span>
              <button
                onClick={() => setEditingHeader(true)}
                className="ml-1 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
              >
                <IconPencil className="h-3.5 w-3.5" />
                编辑信息
              </button>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveIndicator state={saveState} savedAt={savedAt} onRetry={() => void flush()} />
            <Button variant="secondary" size="sm" disabled={exporting} onClick={() => void exportExcel()}>
              <IconDownload className="h-4 w-4" />
              导出 Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              title="打开打印窗口，选择「另存为 PDF」"
              onClick={() => setPrintJob({ title: evaluationFilename(kind, header), landscape: true })}
            >
              <IconDownload className="h-4 w-4" />
              导出 PDF
            </Button>
            <button
              onClick={() => void deleteSheet()}
              title="删除评价表"
              className="rounded-full p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
            >
              <IconTrash className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {extraLines.length > 0 && (
        <div className="animate-fade-up flex flex-wrap gap-x-7 gap-y-2 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 text-[13px]">
          {extraLines.map(([label, value]) => (
            <p key={label}>
              <span className="text-slate-400">{label}</span>
              <span className="ml-2 font-medium text-slate-700">{value}</span>
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <ClassOverview schema={schema} kind={kind} entries={draft.entries} drill={draft.options.drill} />
        <SummaryCard
          summary={draft.summary}
          busy={summaryBusy}
          canGenerate={recordedIds.length > 0}
          onChange={(summary) => update((d) => ({ ...d, summary }))}
          onGenerate={() => void generateSummary()}
          onCopy={() => void copy(draft.summary)}
        />
      </div>

      <Card className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">学生评价</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              改动自动保存 · 点星星打分，再点一次取消
              {kind.uses_position ? " · 位置专项随场上位置变化" : ""}
              {aiFilled ? " · 紫色格子是 AI 填的，改一下就算你自己填的" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {batchFields.length > 0 && (
              <PopoverButton
                label="批量打分"
                open={panel === "batch"}
                onOpenChange={(open) => setPanel(open ? "batch" : null)}
              >
                <BatchPanel fields={batchFields} onApply={applyBatch} />
              </PopoverButton>
            )}
            {prefill && (
              <Button
                variant="secondary"
                size="sm"
                disabled={!prefillable}
                title={prefillable ? prefill.hint : "表中学生在这段时间还没有视频分析记录"}
                onClick={prefillFromVideo}
              >
                {prefill.label}
              </Button>
            )}
            {progress ? (
              <Button size="sm" variant="secondary" onClick={() => (stopRef.current = true)}>
                <Spinner className="h-3.5 w-3.5" />
                AI 评价中 {progress.done}/{progress.total} · 停止
              </Button>
            ) : (
              <PopoverButton
                label="AI 一键评价"
                icon={<IconSpark className="h-4 w-4" />}
                primary
                open={panel === "ai"}
                onOpenChange={(open) => setPanel(open ? "ai" : null)}
              >
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-900">AI 一键评价</p>
                  <Segmented
                    value={aiMode}
                    onChange={(v) => setAiMode(v as "fill" | "comment")}
                    options={[
                      { value: "fill", label: "整张表" },
                      { value: "comment", label: "只写评语" },
                    ]}
                  />
                  <p className="text-xs leading-relaxed text-slate-500">
                    {aiMode === "fill" ? (
                      <>
                        看训练视频分析
                        {kind.compare_videos ? "（期初、期末两段对比）" : kind.same_day_video ? "（比赛录像）" : ""}
                        、你已经填的内容和这个班以前的评价表，把星级、
                        {kind.uses_position ? "位置专项、" : ""}文字记录和评语一次填好。
                        {manualLabels ? `${manualLabels}这类要你自己填。` : ""}填完可以直接改。
                      </>
                    ) : (
                      "只根据表里已有的打分和记录写评语，不改你打的分。"
                    )}
                  </p>
                  <div className="space-y-2">
                    <ScopeOption
                      checked={aiScope === "missing"}
                      onSelect={() => setAiScope("missing")}
                      title={aiMode === "fill" ? "只补空着的地方" : "只为还没有评语的学生生成"}
                      detail={`${aiMode === "fill" ? fillMissingIds.length : missingIds.length} 人，不动你填过的`}
                    />
                    <ScopeOption
                      checked={aiScope === "all"}
                      onSelect={() => setAiScope("all")}
                      title="全部重填"
                      detail={`${aiMode === "fill" ? allIds.length : recordedIds.length} 人，会覆盖 AI 和你填的内容`}
                    />
                  </div>
                  {aiMode === "fill" ? (
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
                      <input
                        type="checkbox"
                        className="accent-brand-600"
                        checked={alsoSummary}
                        onChange={(e) => setAlsoSummary(e.target.checked)}
                      />
                      顺便写一段课堂总评
                    </label>
                  ) : (
                    unrecorded > 0 && <p className="text-xs text-amber-700">{unrecorded} 名学生还没有评价记录，会跳过</p>
                  )}
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!aiTargets.length}
                    onClick={() =>
                      void (aiMode === "fill" ? runFill(aiTargets, aiScope === "all") : generateComments(aiTargets))
                    }
                  >
                    开始（{aiTargets.length} 人）
                  </Button>
                  <p className="text-[11px] leading-relaxed text-slate-400">
                    AI 只依据视频分析和已有记录判断，请老师过目后再导出。
                  </p>
                </div>
              </PopoverButton>
            )}
            <PopoverButton
              label="添加学生"
              icon={<IconPlus className="h-4 w-4" />}
              open={panel === "add"}
              onOpenChange={(open) => setPanel(open ? "add" : null)}
            >
              <AddStudentsPanel
                students={students}
                existing={new Set(draft.entries.map((e) => e.student_id))}
                className={sheet.class_name}
                onAdd={(list) => void addStudents(list)}
              />
            </PopoverButton>
          </div>
        </div>

        {draft.entries.length === 0 ? (
          <EmptyState title="表中还没有学生" description="点右上角「添加学生」把学生加入这张表" />
        ) : isDesktop ? (
          <EntryTable entries={draft.entries} busyRows={busyRows} {...rowProps} />
        ) : (
          <div className="divide-y divide-slate-100">
            {draft.entries.map((e, i) => (
              <EntryCard
                key={e.student_id}
                index={i}
                entry={e}
                busy={busyRows.includes(e.student_id)}
                {...rowProps}
              />
            ))}
          </div>
        )}
      </Card>

      {editingHeader && (
        <EvaluationSheetDialog
          mode="edit"
          schema={schema}
          initial={{
            kind: kind.key as SheetForm["kind"],
            class_name: sheet.class_name,
            title: draft.title,
            lesson_date: draft.lesson_date,
            teacher_name: draft.teacher_name,
            options: draft.options,
          }}
          onClose={() => setEditingHeader(false)}
          onSubmit={saveHeader}
        />
      )}

      <PrintPortal job={printJob} onDone={() => setPrintJob(null)}>
        <EvaluationPrint schema={schema} kind={kind} sheet={header} entries={draft.entries} />
      </PrintPortal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}

function SaveIndicator({ state, savedAt, onRetry }: { state: SaveState; savedAt: Date | null; onRetry: () => void }) {
  if (state === "error") {
    return (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100"
      >
        <IconAlert className="h-3.5 w-3.5" />
        保存失败 · 重试
      </button>
    );
  }
  const time = savedAt
    ? `${String(savedAt.getHours()).padStart(2, "0")}:${String(savedAt.getMinutes()).padStart(2, "0")}`
    : "";
  return (
    <span className="inline-flex items-center gap-1.5 px-2 text-xs text-slate-500" aria-live="polite">
      {state === "saving" ? (
        <>
          <Spinner className="h-3.5 w-3.5" />
          保存中…
        </>
      ) : state === "pending" ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          有改动，稍后自动保存
        </>
      ) : (
        <>
          <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
          已保存{time && ` · ${time}`}
        </>
      )}
    </span>
  );
}

function PopoverButton({
  label,
  icon,
  primary = false,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon?: ReactNode;
  primary?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant={primary ? "primary" : "secondary"} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        {icon}
        {label}
      </Button>
      {open && (
        // 手机上以底部面板形式出现，桌面端挂在按钮下方。
        <div className="animate-fade-up fixed inset-x-4 bottom-4 z-40 max-h-[70svh] overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:bottom-auto sm:mt-2 sm:w-80">
          {children}
        </div>
      )}
    </div>
  );
}

function ScopeOption({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition ${
        checked ? "border-brand-500 bg-brand-50/50" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <input type="radio" checked={checked} onChange={onSelect} className="mt-0.5 accent-brand-600" />
      <span className="text-[13px] text-slate-800">
        {title}
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </label>
  );
}

/** 小分段开关：两三个互斥选项，比下拉更适合手机。 */
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 标记一个由 AI 填出来、老师还没改过的格子。 */
function AIChip() {
  return (
    <span
      title="AI 填的，改一下就算你自己填的"
      className="ml-1 rounded bg-violet-100 px-1 py-px text-[10px] font-medium text-violet-700"
    >
      AI
    </span>
  );
}

function FillButton({ name, busy, onClick }: { name: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="AI 填这一行（含评语）"
      aria-label={`${name} · AI 一键评价`}
      className="rounded-lg p-1.5 text-brand-500 transition hover:bg-brand-50 disabled:text-slate-300"
    >
      {busy ? <Spinner className="h-4 w-4" /> : <IconSpark className="h-4 w-4" />}
    </button>
  );
}

function BatchPanel({
  fields,
  onApply,
}: {
  fields: EvaluationField[];
  onApply: (key: string, value: EvaluationValue, overwrite: boolean) => void;
}) {
  const [key, setKey] = useState(fields[0]?.key ?? "");
  const [value, setValue] = useState<EvaluationValue | undefined>(undefined);
  const [overwrite, setOverwrite] = useState(false);
  const field = fields.find((f) => f.key === key);

  return (
    <div className="space-y-3.5">
      <p className="text-sm font-semibold text-slate-900">批量打分</p>
      <Select
        label="评价项"
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setValue(undefined);
        }}
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-slate-600">
          {field?.type === "choice" ? "选择" : "星级"}
        </span>
        {field?.type === "choice" ? (
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setValue(o)}
                className={`rounded-full px-3 py-1 text-[13px] transition ${
                  value === o ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        ) : (
          <StarInput
            value={typeof value === "number" ? value : undefined}
            onChange={setValue}
            levels={field?.levels}
            label="批量星级"
          />
        )}
      </div>
      <Segmented
        value={overwrite ? "all" : "blank"}
        onChange={(v) => setOverwrite(v === "all")}
        options={[
          { value: "blank", label: "只填空白" },
          { value: "all", label: "覆盖全部" },
        ]}
      />
      <Button
        size="sm"
        className="w-full"
        disabled={value === undefined}
        onClick={() => value !== undefined && onApply(key, value, overwrite)}
      >
        应用到全班
      </Button>
    </div>
  );
}

function AddStudentsPanel({
  students,
  existing,
  className,
  onAdd,
}: {
  students: Student[];
  existing: Set<number>;
  className: string;
  onAdd: (list: Student[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  // 本班学生排在前面，其余按班级、姓名排序。
  const candidates = students
    .filter((s) => !existing.has(s.id))
    .sort(
      (a, b) =>
        Number(a.class_name !== className) - Number(b.class_name !== className) ||
        a.class_name.localeCompare(b.class_name, "zh-CN") ||
        a.name.localeCompare(b.name, "zh-CN"),
    );

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-900">添加学生</p>
      {candidates.length === 0 ? (
        <p className="text-sm text-slate-400">所有学生都已在表中</p>
      ) : (
        <ul className="-mx-1 max-h-60 space-y-0.5 overflow-y-auto">
          {candidates.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="accent-brand-600"
                  checked={picked.includes(s.id)}
                  onChange={(e) =>
                    setPicked((list) => (e.target.checked ? [...list, s.id] : list.filter((id) => id !== s.id)))
                  }
                />
                <span className="text-sm text-slate-800">{s.name}</span>
                <span className="ml-auto text-xs text-slate-400">{classLabel(s.class_name)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        className="w-full"
        disabled={!picked.length}
        onClick={() => onAdd(candidates.filter((s) => picked.includes(s.id)))}
      >
        加入{picked.length ? ` ${picked.length} 名` : ""}学生
      </Button>
    </div>
  );
}

function SubHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h4 className="text-[13px] font-semibold text-slate-700">{title}</h4>
      {aside && <span className="text-xs text-slate-400">{aside}</span>}
    </div>
  );
}

function ClassOverview({
  schema,
  kind,
  entries,
  drill,
}: {
  schema: EvaluationSchema;
  kind: EvaluationKindSchema;
  entries: EvaluationEntry[];
  drill?: Drill;
}) {
  const stats = useMemo(() => fieldStats(kind, entries, drill), [kind, entries, drill]);
  const byPosition = useMemo(
    () => (kind.uses_position ? positionStats(schema, entries) : []),
    [schema, kind, entries],
  );
  const recorded = entries.filter((e) => isRecorded(kind, e.values)).length;
  const commented = entries.filter((e) => e.comment.trim()).length;
  const stars = stats.filter((s) => s.field.type === "stars");
  const numbers = stats.filter((s) => s.field.type === "number");
  const choices = stats.filter((s) => s.field.type === "choice");

  return (
    <Card className="animate-fade-up p-6 lg:col-span-3">
      <SectionHeader icon={<IconReport className="h-4 w-4" />} tint="bg-brand-50 text-brand-600" title="班级概况" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Progress label="已评价" value={recorded} total={entries.length} />
        <Progress label="已写评语" value={commented} total={entries.length} tone="emerald" />
      </div>
      <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
        {stars.length > 0 && (
          <section>
            <SubHead title="星级平均" aside="满分 5 星" />
            <BarList
              max={5}
              rows={stars.map((s) => ({
                label: s.field.label,
                value: s.average,
                display: s.average?.toFixed(1),
                title: s.distribution
                  .filter((d) => d.count)
                  .map((d) => `${d.label} ${d.count} 人`)
                  .join("、"),
              }))}
            />
          </section>
        )}
        {numbers.length > 0 && (
          <section>
            <SubHead title="数据统计" aside={drill ? `${drill.label} · ${drill.measure}` : "合计 / 平均"} />
            <div className="grid grid-cols-2 gap-2.5">
              {numbers.map((s) => {
                const unit = s.field.key === "score" && drill ? drill.unit : s.field.unit;
                return (
                  <div key={s.field.key} className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                    <p className="text-xs text-slate-500">{s.field.key === "score" ? "平均成绩" : s.field.label}</p>
                    <p className="mt-0.5 text-[18px] font-semibold text-slate-900 tabular-nums">
                      {(summable(s.field) ? s.total : s.average) ?? "—"}
                      <span className="ml-0.5 text-xs font-normal text-slate-400">{unit}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {s.field.key === "score"
                        ? `最好 ${s.best ?? "—"}${unit ?? ""}`
                        : summable(s.field)
                          ? `人均 ${s.average ?? "—"}`
                          : "平均"}{" "}
                      · {s.count} 人
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {choices.map((s) => (
          <section key={s.field.key}>
            <SubHead title={s.field.label} aside={`${s.count} 人`} />
            <BarList
              max={Math.max(1, ...s.distribution.map((d) => d.count))}
              rows={s.distribution.map((d) => ({ label: d.label, value: d.count, display: `${d.count} 人` }))}
            />
          </section>
        ))}
        {byPosition.map((p) => (
          <section key={p.position}>
            <SubHead title={`位置专项 · ${p.position}`} aside={`${p.count} 人 · 满分 5 星`} />
            <BarList
              max={5}
              rows={p.items.map((item) => ({
                label: item.label,
                value: item.average,
                display: item.average?.toFixed(1),
                title: `${item.count} 人有评分`,
              }))}
            />
          </section>
        ))}
      </div>
    </Card>
  );
}

function SummaryCard({
  summary,
  busy,
  canGenerate,
  onChange,
  onGenerate,
  onCopy,
}: {
  summary: string;
  busy: boolean;
  canGenerate: boolean;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  return (
    <Card className="animate-fade-up flex flex-col p-6 lg:col-span-2">
      <SectionHeader
        icon={<IconSpark className="h-4 w-4" />}
        tint="bg-emerald-50 text-emerald-600"
        title="课堂总评"
        aside={
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !canGenerate}
            onClick={onGenerate}
            aria-label={`${summary ? "重新生成" : "AI 生成"}课堂总评`}
          >
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <IconSpark className="h-3.5 w-3.5" />}
            {busy ? "生成中…" : summary ? "重新生成" : "AI 生成"}
          </Button>
        }
      />
      <p className="-mt-1.5 mb-3 text-xs text-slate-400">根据全班评分和老师记录生成，可直接修改</p>
      <AutoTextarea
        value={summary}
        onChange={onChange}
        minRows={7}
        maxLength={2000}
        ariaLabel="课堂总评"
        placeholder={canGenerate ? "点右上角「AI 生成」，或直接写这次的总评" : "先给学生打分，再生成总评"}
        className="px-3.5 py-3 text-[13.5px]"
      />
      {summary && (
        <div className="mt-2.5 flex justify-end">
          <button onClick={onCopy} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
            <IconCopy className="h-3.5 w-3.5" />
            复制总评
          </button>
        </div>
      )}
    </Card>
  );
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  maxLength,
  ariaLabel,
  minRows = 1,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  ariaLabel: string;
  minRows?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      maxLength={maxLength}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`block w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 ${className}`}
    />
  );
}

function FieldControl({
  field,
  value,
  onChange,
  unit,
}: {
  field: EvaluationField;
  value: EvaluationValue | undefined;
  onChange: (value: EvaluationValue | undefined) => void;
  unit?: string;
}) {
  if (field.type === "stars") {
    return (
      <StarInput
        value={typeof value === "number" ? value : undefined}
        onChange={onChange}
        levels={field.levels}
        label={field.label}
        allowZero={field.allow_zero}
      />
    );
  }
  if (field.type === "number") {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={field.max}
          aria-label={field.label}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(undefined);
            const n = Math.floor(Number(raw));
            if (Number.isFinite(n)) onChange(Math.min(Math.max(n, 0), field.max ?? 9999));
          }}
          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-[13px] tabular-nums outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
        />
        {(unit ?? field.unit) && <span className="text-xs text-slate-400">{unit ?? field.unit}</span>}
      </div>
    );
  }
  if (field.type === "choice") {
    return (
      <select
        aria-label={field.label}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
      >
        <option value="">—</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <AutoTextarea
      value={typeof value === "string" ? value : ""}
      onChange={(v) => onChange(v || undefined)}
      placeholder={field.placeholder}
      maxLength={200}
      ariaLabel={field.label}
    />
  );
}

/** 位置专项：按这一行的场上位置显示三项星级，悬停可以看到观察要点。 */
function PositionItemsControl({
  schema,
  entry,
  onValue,
}: {
  schema: EvaluationSchema;
  entry: EvaluationEntry;
  onValue: (studentId: number, key: string, value: EvaluationValue | undefined) => void;
}) {
  const items = positionItems(schema, entry.values.position);
  if (!items.length) return <span className="text-[12px] text-slate-300">先选场上位置</span>;
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const key = schema.position_prefix + item.key;
        const v = entry.values[key];
        return (
          <div key={item.key} className="flex items-center gap-1.5" title={`看：${item.look}`}>
            <span className="w-[4.6em] shrink-0 text-[12px] text-slate-600">{item.label}</span>
            <StarInput
              compact
              value={typeof v === "number" ? v : undefined}
              onChange={(n) => onValue(entry.student_id, key, n)}
              label={item.label}
            />
          </div>
        );
      })}
    </div>
  );
}

function VideoLink({ video, prefix }: { video: EvaluationVideoRef; prefix: string }) {
  const d = new Date(video.date);
  return (
    <Link
      to={`/result/${video.id}`}
      title={`${video.training_type} · ${video.level}`}
      className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] whitespace-nowrap text-brand-700 transition hover:bg-brand-100"
    >
      {prefix} · {video.level} · {d.getMonth() + 1}/{d.getDate()}
    </Link>
  );
}

function VideoChips({ kind, entry }: { kind: EvaluationKindSchema; entry: EvaluationEntry }) {
  const { video, video_first: first } = entry;
  if (kind.compare_videos && first && video) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <VideoLink video={first} prefix="期初" />
        <span className="text-[11px] text-slate-300">→</span>
        <VideoLink video={video} prefix="期末" />
      </div>
    );
  }
  if (!video) {
    return kind.same_day_video ? <span className="text-[11px] text-slate-300">当天没有比赛录像</span> : null;
  }
  const prefix = kind.same_day_video
    ? "比赛录像"
    : kind.uses_period
      ? `视频回看${entry.video_count > 1 ? ` ${entry.video_count} 段` : ""}`
      : "视频";
  return <VideoLink video={video} prefix={prefix} />;
}

function StudentCell({
  kind,
  schema,
  index,
  entry,
  onPosition,
}: {
  kind: EvaluationKindSchema;
  schema: EvaluationSchema;
  index: number;
  entry: EvaluationEntry;
  onPosition: (studentId: number, position: string) => void;
}) {
  const position = typeof entry.values.position === "string" ? entry.values.position : "";
  const positionLabel = kind.fields.find((f) => f.key === "position")?.label ?? "场上位置";
  return (
    <div className="flex min-w-[10.5rem] items-start gap-2.5">
      <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-slate-400 tabular-nums">{index + 1}</span>
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-slate-900">{entry.student_name}</p>
        {entry.student_no && <p className="text-[11px] text-slate-400">{entry.student_no}</p>}
        {kind.uses_position && (
          <select
            aria-label={`${entry.student_name}的${positionLabel}`}
            title={positionLabel}
            value={position}
            onChange={(e) => onPosition(entry.student_id, e.target.value)}
            className={`rounded-md border px-1.5 py-0.5 text-[12px] outline-none transition focus:border-brand-500 ${
              position ? "border-slate-200 bg-white text-slate-700" : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <option value="">选位置</option>
            {schema.positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <VideoChips kind={kind} entry={entry} />
      </div>
    </div>
  );
}

function CommentBox({
  entry,
  busy,
  onChange,
  onGenerate,
  onCopy,
}: {
  entry: EvaluationEntry;
  busy: boolean;
  onChange: (text: string) => void;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="font-medium text-slate-500">评语</span>
        {entry.comment && (
          <span
            className={`rounded-full px-1.5 py-px ${
              entry.comment_source === "ai" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {entry.comment_source === "ai" ? "AI 生成" : "老师填写"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onGenerate}
            aria-label={`${entry.student_name}的评语 · ${entry.comment ? "重新生成" : "AI 生成"}`}
            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            {busy ? <Spinner className="h-3 w-3" /> : <IconSpark className="h-3 w-3" />}
            {busy ? "生成中…" : entry.comment ? "重新生成" : "AI 生成"}
          </button>
          {entry.comment && (
            <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
              <IconCopy className="h-3 w-3" />
              复制
            </button>
          )}
        </span>
      </div>
      <AutoTextarea
        value={entry.comment}
        onChange={onChange}
        maxLength={1000}
        ariaLabel={`${entry.student_name}的评语`}
        placeholder="打分后点「AI 生成」，或直接写评语"
      />
    </div>
  );
}

interface RowProps {
  kind: EvaluationKindSchema;
  schema: EvaluationSchema;
  drill?: Drill;
  onValue: (studentId: number, key: string, value: EvaluationValue | undefined) => void;
  onPosition: (studentId: number, position: string) => void;
  onComment: (studentId: number, text: string) => void;
  onGenerate: (studentId: number) => void;
  onFill: (studentId: number) => void;
  onRemove: (entry: EvaluationEntry) => void;
  onCopy: (text: string) => void;
}

/** 判断某一列是不是这一行里 AI 填的：位置专项只要有一项是 AI 填的就算。 */
function aiMarker(schema: EvaluationSchema, entry: EvaluationEntry) {
  const marked = new Set(entry.ai_fields);
  return (field: EvaluationField) =>
    field.type === "position"
      ? positionItems(schema, entry.values.position).some((i) => marked.has(schema.position_prefix + i.key))
      : marked.has(field.key);
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="从表中移除"
      className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
    >
      <IconTrash className="h-4 w-4" />
    </button>
  );
}

function ScoreCell({ field, entry, props }: { field: EvaluationField; entry: EvaluationEntry; props: RowProps }) {
  if (field.type === "position") {
    return <PositionItemsControl schema={props.schema} entry={entry} onValue={props.onValue} />;
  }
  return (
    <FieldControl
      field={field}
      value={entry.values[field.key]}
      unit={field.key === "score" ? props.drill?.unit : undefined}
      onChange={(v) => props.onValue(entry.student_id, field.key, v)}
    />
  );
}

function EntryTable({ entries, busyRows, ...props }: RowProps & { entries: EvaluationEntry[]; busyRows: number[] }) {
  const scoreFields = props.kind.fields.filter((f) => f.type !== "text" && !f.context);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="sticky left-0 z-[1] bg-white py-3 pr-3 pl-6 font-medium">学生</th>
            {scoreFields.map((f) => (
              <th key={f.key} className="px-3 py-3 font-medium whitespace-nowrap">
                {f.type === "stars" || f.type === "choice" ? f.label : columnTitle(f, props.drill)}
                {f.type === "position" && <span className="ml-1 font-normal text-slate-400">按位置</span>}
              </th>
            ))}
            <th className="w-12 px-3 py-3" />
          </tr>
        </thead>
        {entries.map((e, i) => (
          <EntryRows key={e.student_id} index={i} entry={e} busy={busyRows.includes(e.student_id)} {...props} />
        ))}
      </table>
    </div>
  );
}

/** 桌面端每名学生两行：第一行是星级和数据，第二行是文字记录与评语。 */
const EntryRows = memo(function EntryRows(props: RowProps & { index: number; entry: EvaluationEntry; busy: boolean }) {
  const { kind, schema, index, entry, busy, onValue, onPosition, onComment, onGenerate, onFill, onRemove, onCopy } = props;
  const scoreFields = kind.fields.filter((f) => f.type !== "text" && !f.context);
  const textFields = kind.fields.filter((f) => f.type === "text");
  const byAI = aiMarker(schema, entry);
  return (
    <tbody className="border-b border-slate-100 last:border-b-0">
      <tr className="align-top">
        <td className="sticky left-0 z-[1] bg-white pt-4 pr-3 pb-3 pl-6">
          <StudentCell kind={kind} schema={schema} index={index} entry={entry} onPosition={onPosition} />
        </td>
        {scoreFields.map((f) => (
          <td
            key={f.key}
            title={byAI(f) ? "AI 填的，改一下就算你自己填的" : undefined}
            className={`px-3 pt-4 pb-3 ${byAI(f) ? "bg-violet-50/70" : ""}`}
          >
            <ScoreCell field={f} entry={entry} props={props} />
          </td>
        ))}
        <td className="px-3 pt-3 pb-3">
          <div className="flex items-center justify-end">
            <FillButton name={entry.student_name} busy={busy} onClick={() => onFill(entry.student_id)} />
            <RemoveButton onClick={() => onRemove(entry)} />
          </div>
        </td>
      </tr>
      <tr>
        <td colSpan={scoreFields.length + 2} className="pr-6 pb-4 pl-[3.25rem]">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: [...textFields.map(() => "minmax(0,1fr)"), "minmax(0,2fr)"].join(" ") }}
          >
            {textFields.map((f) => (
              <div key={f.key}>
                <span className="mb-1 block text-[11px] font-medium text-slate-500">
                  {f.label}
                  {byAI(f) && <AIChip />}
                </span>
                <FieldControl field={f} value={entry.values[f.key]} onChange={(v) => onValue(entry.student_id, f.key, v)} />
              </div>
            ))}
            <CommentBox
              entry={entry}
              busy={busy}
              onChange={(text) => onComment(entry.student_id, text)}
              onGenerate={() => onGenerate(entry.student_id)}
              onCopy={() => onCopy(entry.comment)}
            />
          </div>
        </td>
      </tr>
    </tbody>
  );
});

/** 手机端每名学生一张卡片。 */
const EntryCard = memo(function EntryCard(props: RowProps & { index: number; entry: EvaluationEntry; busy: boolean }) {
  const { kind, schema, index, entry, busy, onValue, onPosition, onComment, onGenerate, onFill, onRemove, onCopy } = props;
  const byAI = aiMarker(schema, entry);
  return (
    <div className="space-y-3.5 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <StudentCell kind={kind} schema={schema} index={index} entry={entry} onPosition={onPosition} />
        <div className="flex items-center">
          <FillButton name={entry.student_name} busy={busy} onClick={() => onFill(entry.student_id)} />
          <RemoveButton onClick={() => onRemove(entry)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {kind.fields
          .filter((f) => f.type !== "text" && !f.context)
          .map((f) => (
            <div
              key={f.key}
              className={f.type === "stars" || f.type === "position" ? "col-span-2 flex items-start justify-between gap-3" : ""}
            >
              <span className="mb-1 block pt-0.5 text-xs text-slate-500">
                {f.key === "score" ? columnTitle(f, props.drill) : f.label}
                {byAI(f) && <AIChip />}
              </span>
              <ScoreCell field={f} entry={entry} props={props} />
            </div>
          ))}
      </div>
      {kind.fields
        .filter((f) => f.type === "text")
        .map((f) => (
          <div key={f.key}>
            <span className="mb-1 block text-xs text-slate-500">
              {f.label}
              {byAI(f) && <AIChip />}
            </span>
            <FieldControl field={f} value={entry.values[f.key]} onChange={(v) => onValue(entry.student_id, f.key, v)} />
          </div>
        ))}
      <CommentBox
        entry={entry}
        busy={busy}
        onChange={(text) => onComment(entry.student_id, text)}
        onGenerate={() => onGenerate(entry.student_id)}
        onCopy={() => onCopy(entry.comment)}
      />
    </div>
  );
});
