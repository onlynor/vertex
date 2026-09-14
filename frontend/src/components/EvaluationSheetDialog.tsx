import { useEffect, useState, type FormEvent } from "react";
import { classLabel, type ClassGroup } from "../lib/classes";
import { defaultOptions, defaultTitle, findKind, termStart } from "../lib/evaluation";
import type { Drill, EvaluationKind, EvaluationOptions, EvaluationSchema } from "../types";
import { IconClipboard } from "./Icons";
import { Button, Card, Input, Select, Spinner } from "./ui";

export interface SheetForm {
  kind: EvaluationKind;
  class_name: string;
  title: string;
  lesson_date: string;
  teacher_name: string;
  options: EvaluationOptions;
}

const CUSTOM = "custom";
const TIER_NAMES = ["基础层", "提高层", "挑战层"] as const;

/** 新建评价表（选类型、班级）或修改已有评价表的表头信息。 */
export default function EvaluationSheetDialog({
  mode,
  schema,
  classes = [],
  initial,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  schema: EvaluationSchema;
  classes?: ClassGroup[];
  initial: SheetForm;
  onClose: () => void;
  onSubmit: (form: SheetForm) => Promise<void>;
}) {
  const [form, setForm] = useState<SheetForm>(initial);
  // 老师还没改过名称时，切换类型会换成新类型的默认名称（如「秋季学期期中评价」）。
  const [titleTouched, setTitleTouched] = useState(mode === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = findKind(schema, form.kind) ?? schema.kinds[0];
  const drill = form.options.drill;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickKind(next: EvaluationKind) {
    const nextKind = schema.kinds.find((k) => k.key === next);
    if (!nextKind) return;
    setForm((f) => ({
      ...f,
      kind: next,
      title: titleTouched ? f.title : defaultTitle(next),
      options: defaultOptions(nextKind, schema, f.lesson_date),
    }));
  }

  const setOptions = (patch: Partial<EvaluationOptions>) => setForm((f) => ({ ...f, options: { ...f.options, ...patch } }));
  const setDrill = (patch: Partial<Drill>) => drill && setOptions({ drill: { ...drill, ...patch } });

  function pickDrill(key: string) {
    if (key === CUSTOM) {
      setOptions({ drill: { key: CUSTOM, label: "", measure: "", unit: "次", lower_is_better: false, thresholds: [5, 10, 20] } });
      return;
    }
    const d = schema.drills.find((x) => x.key === key);
    if (d) setOptions({ drill: { ...d, thresholds: [...d.thresholds] } });
  }

  function setThreshold(i: 0 | 1 | 2, raw: string) {
    if (!drill) return;
    const next = [...drill.thresholds] as [number, number, number];
    next[i] = Math.max(0, Math.min(9999, Math.floor(Number(raw) || 0)));
    setDrill({ thresholds: next });
  }

  function validate(): string | null {
    if (mode === "create" && !classes.some((c) => c.name === form.class_name)) return "请选择班级";
    if (kind?.uses_drill && drill) {
      if (drill.key === CUSTOM && !drill.label.trim()) return "请填写练习项目名称";
      if (drill.key === CUSTOM && !drill.unit.trim()) return "请填写成绩单位";
      const [a, b, c] = drill.thresholds;
      const ordered = drill.lower_is_better ? a >= b && b >= c : a <= b && b <= c;
      if (!ordered) {
        return drill.lower_is_better
          ? "成绩越少越好时，达标线应该从基础层到挑战层逐层变小"
          : "达标线应该从基础层到挑战层逐层提高";
      }
    }
    if (kind?.uses_period && form.options.period_start && form.options.period_start > form.lesson_date) {
      return "开始日期不能晚于评价日期";
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请重试");
      setSubmitting(false);
    }
  }

  if (!kind) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card className="animate-fade-up max-h-[calc(100svh-2rem)] w-full max-w-2xl overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-6 py-5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <IconClipboard className="h-4 w-4" />
            </span>
            <div>
              <h2 className="display-tight text-[17px] font-semibold text-slate-900">
                {mode === "create" ? "新建评价表" : "编辑评价表信息"}
              </h2>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {mode === "create"
                  ? "选好类型和班级，班里的学生会自动加进表里"
                  : `${kind.label} · ${classLabel(form.class_name)}`}
              </p>
            </div>
          </div>

          <form id="sheet-form" onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
            {mode === "create" && (
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-slate-600">评价类型</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {schema.kinds.map((k) => {
                    const active = k.key === form.kind;
                    return (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => pickKind(k.key as EvaluationKind)}
                        aria-pressed={active}
                        className={`rounded-xl border px-3.5 py-3 text-left transition ${
                          active
                            ? "border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10"
                            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span className={`block text-sm font-semibold ${active ? "text-brand-700" : "text-slate-800"}`}>
                          {k.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{k.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            {mode === "create" &&
              (classes.length ? (
                <Select
                  label="班级"
                  value={`c:${form.class_name}`}
                  onChange={(e) => setForm({ ...form, class_name: e.target.value.slice(2) })}
                >
                  {classes.map((c) => (
                    <option key={c.name} value={`c:${c.name}`}>
                      {classLabel(c.name)} · {c.count} 人
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  还没有学生档案，请先在「学生管理」中添加学生。
                </p>
              ))}

            <Input
              label={kind.title_label}
              placeholder={kind.title_placeholder}
              value={form.title}
              maxLength={64}
              onChange={(e) => {
                setTitleTouched(true);
                setForm({ ...form, title: e.target.value });
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={kind.date_label}
                type="date"
                required
                value={form.lesson_date}
                onChange={(e) => setForm({ ...form, lesson_date: e.target.value })}
              />
              <Input
                label="教师"
                maxLength={32}
                value={form.teacher_name}
                onChange={(e) => setForm({ ...form, teacher_name: e.target.value })}
              />
            </div>

            {kind.uses_period && (
              <div>
                <Input
                  label="统计区间开始日期"
                  type="date"
                  value={form.options.period_start ?? termStart(form.lesson_date)}
                  onChange={(e) => setOptions({ period_start: e.target.value })}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  区间从这一天到评价日期
                  {kind.compare_videos ? "；区间内第一段和最后一段训练视频会用来对比期初、期末的变化" : "；区间内的训练视频可以直接回看"}
                </p>
              </div>
            )}

            {kind.record_methods && kind.record_methods.length > 0 && (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-slate-600">记录方式</span>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  {kind.record_methods.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setOptions({ record_method: m })}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                        form.options.record_method === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {kind.uses_drill && drill && (
              <fieldset className="space-y-3 rounded-2xl bg-slate-50 p-4">
                <legend className="sr-only">练习项目</legend>
                <Select label="练习项目" value={drill.key} onChange={(e) => pickDrill(e.target.value)}>
                  {schema.drills.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}（{d.measure}）
                    </option>
                  ))}
                  <option value={CUSTOM}>自定义项目</option>
                </Select>
                {drill.key === CUSTOM ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <Input
                      label="项目名称"
                      placeholder="如：头顶球"
                      maxLength={20}
                      value={drill.label}
                      onChange={(e) => setDrill({ label: e.target.value })}
                    />
                    <Input
                      label="成绩单位"
                      placeholder="次 / 秒 / 个"
                      maxLength={6}
                      value={drill.unit}
                      onChange={(e) => setDrill({ unit: e.target.value })}
                    />
                    <Input
                      label="怎么测（选填）"
                      placeholder="如：连续头顶球次数"
                      maxLength={40}
                      value={drill.measure}
                      onChange={(e) => setDrill({ measure: e.target.value })}
                    />
                    <label className="flex items-end gap-2 pb-2.5 text-[13px] text-slate-600">
                      <input
                        type="checkbox"
                        className="mb-0.5 accent-brand-600"
                        checked={drill.lower_is_better}
                        onChange={(e) => setDrill({ lower_is_better: e.target.checked })}
                      />
                      成绩越少越好
                    </label>
                  </div>
                ) : (
                  drill.method && <p className="text-xs leading-relaxed text-slate-500">测评方法：{drill.method}</p>
                )}
                <div className="grid grid-cols-3 gap-2.5">
                  {TIER_NAMES.map((name, i) => (
                    <Input
                      key={name}
                      label={`${name}（${drill.lower_is_better ? "≤" : "≥"}，${drill.unit || "单位"}）`}
                      type="number"
                      min={0}
                      max={9999}
                      value={drill.thresholds[i]}
                      onChange={(e) => setThreshold(i as 0 | 1 | 2, e.target.value)}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-400">达标线是默认值，可以按本班情况调整；填成绩后会自动判断达到哪一层。</p>
              </fieldset>
            )}

            {error && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          </form>

          <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form="sheet-form" disabled={submitting || (mode === "create" && !classes.length)}>
              {submitting ? (
                <Spinner className="h-4 w-4 border-white/40 border-t-white" />
              ) : mode === "create" ? (
                "创建并开始评价"
              ) : (
                "保存"
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
