import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ClassTabs from "../components/ClassTabs";
import EvaluationSheetDialog, { type SheetForm } from "../components/EvaluationSheetDialog";
import { IconClipboard, IconPlus } from "../components/Icons";
import { Button, Card, EmptyState, Progress, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { classGroups, classLabel } from "../lib/classes";
import {
  defaultOptions,
  defaultTitle,
  findKind,
  fmtLessonDate,
  KIND_LABELS,
  kindTone,
  todayISO,
  useEvaluationSchema,
} from "../lib/evaluation";
import { useAuth } from "../store/auth";
import type { EvaluationKind, EvaluationSheetSummary, Student } from "../types";

const isKind = (v: string | null): v is EvaluationKind => !!v && v in KIND_LABELS;

export default function EvaluationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { teacher } = useAuth();
  const { schema, error: schemaError } = useEvaluationSchema();
  const [sheets, setSheets] = useState<EvaluationSheetSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  // all：全部；legacy：升级前建的旧版评价表；其余为具体类型。
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string | null>(null);
  // 从首页星图点「常规评价」等进来时，直接打开对应类型的新建窗口。
  const [createKind, setCreateKind] = useState<EvaluationKind | null>(() => {
    const requested = params.get("new");
    return isKind(requested) ? requested : null;
  });

  useEffect(() => {
    if (params.has("new")) setParams({}, { replace: true });
    api
      .listEvaluations()
      .then((res) => setSheets(res.items))
      .catch((err: unknown) => {
        setSheets([]);
        setLoadError(err instanceof Error ? err.message : "加载失败");
      });
    api
      .listStudents()
      .then((res) => setStudents(res.items))
      .catch(() => undefined);
    // 只在进入页面时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studentClasses = useMemo(() => classGroups(students), [students]);
  const sheetClasses = useMemo(() => classGroups(sheets ?? []), [sheets]);
  const isLegacy = (kind: string) => kind.startsWith("legacy_");
  const filtered = (sheets ?? []).filter(
    (s) =>
      (kindFilter === "all" || s.kind === kindFilter || (kindFilter === "legacy" && isLegacy(s.kind))) &&
      (classFilter === null || s.class_name === classFilter),
  );
  const hasLegacy = (sheets ?? []).some((s) => isLegacy(s.kind));

  async function create(form: SheetForm) {
    const sheet = await api.createEvaluation(form);
    navigate(`/evaluations/${sheet.id}`);
  }

  const kinds = schema?.kinds ?? [];
  const createSchema = createKind ? kinds.find((k) => k.key === createKind) : undefined;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">智能评价</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
            常规、分层、期中、期末、赛事五种评价，按班级打分，AI 结合视频分析帮你写评语
          </p>
        </div>
        <Button size="sm" disabled={!schema} onClick={() => setCreateKind("routine")}>
          <IconPlus className="h-4 w-4" />
          新建评价表
        </Button>
      </div>

      {schemaError || loadError ? (
        <Card className="animate-fade-up">
          <EmptyState title="评价表加载失败" description={schemaError ?? loadError ?? ""} />
        </Card>
      ) : !sheets || !schema ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : sheets.length === 0 ? (
        <Card className="animate-fade-up p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <IconClipboard className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[15px] font-semibold text-slate-900">从一张评价表开始</p>
              <p className="mt-0.5 text-sm text-slate-500">选类型、选班级，学生自动带进表里，打完星 AI 帮你写评语</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {kinds.map((k) => (
              <button
                key={k.key}
                onClick={() => setCreateKind(k.key as EvaluationKind)}
                className="rounded-2xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_8px_24px_-12px_rgba(16,24,40,0.18)]"
              >
                <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${kindTone(k.key)}`}>
                  {k.label}
                </span>
                <span className="mt-2.5 block text-[13px] leading-relaxed text-slate-500">{k.description}</span>
              </button>
            ))}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-slate-400">
            位置专项（前锋 / 中场 / 后卫 / 门将）会按学生的场上位置自动嵌入常规、期中、期末、赛事四种评价表。
          </p>
        </Card>
      ) : (
        <>
          <Card className="animate-fade-up space-y-3 p-3">
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
              {[
                { key: "all", label: "全部类型" },
                ...kinds,
                ...(hasLegacy ? [{ key: "legacy", label: "旧版评价表" }] : []),
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setKindFilter(t.key)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                    kindFilter === t.key ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-100 pt-3">
              <ClassTabs groups={sheetClasses} value={classFilter} onChange={setClassFilter} total={sheets.length} />
            </div>
          </Card>

          {filtered.length === 0 ? (
            <Card className="animate-fade-up">
              <EmptyState title="没有符合条件的评价表" description="换个类型或班级看看" />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/evaluations/${s.id}`)}
                  className="animate-fade-up rounded-2xl border border-black/[0.06] bg-white p-5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_16px_32px_-16px_rgba(16,24,40,0.22)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${kindTone(s.kind)}`}>
                      {findKind(schema, s.kind)?.label ?? s.kind}
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums">{fmtLessonDate(s.lesson_date)}</span>
                  </div>
                  <p className="mt-3 truncate text-[16px] font-semibold text-slate-900">{s.title}</p>
                  <p className="mt-1 truncate text-[13px] text-slate-500">
                    {classLabel(s.class_name)} · {s.teacher_name || "未填写教师"} · {s.student_count} 人
                    {s.options?.drill ? ` · ${s.options.drill.label}` : ""}
                  </p>
                  <div className="mt-4 space-y-3">
                    <Progress label="已评价" value={s.recorded_count} total={s.student_count} />
                    <Progress label="已写评语" value={s.commented_count} total={s.student_count} tone="emerald" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {createKind && schema && createSchema && (
        <EvaluationSheetDialog
          mode="create"
          schema={schema}
          classes={studentClasses}
          initial={{
            kind: createKind,
            class_name:
              classFilter !== null && studentClasses.some((c) => c.name === classFilter)
                ? classFilter
                : (studentClasses[0]?.name ?? ""),
            title: defaultTitle(createKind),
            lesson_date: todayISO(),
            teacher_name: teacher?.name ?? "",
            options: defaultOptions(createSchema, schema, todayISO()),
          }}
          onClose={() => setCreateKind(null)}
          onSubmit={create}
        />
      )}
    </div>
  );
}
