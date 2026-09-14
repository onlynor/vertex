import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import ClassTabs from "../components/ClassTabs";
import ImportStudentsDialog from "../components/ImportStudentsDialog";
import { IconAlert, IconPencil, IconPlus, IconTrash, IconUpload, IconUsers } from "../components/Icons";
import { Button, Card, EmptyState, Input, Select, Spinner, Toast } from "../components/ui";
import { POSITIONS } from "../lib/abilities";
import { api } from "../lib/api";
import { classLabel, normalizeClassName } from "../lib/classes";
import type { ClassInfo, Student } from "../types";

const emptyForm = { name: "", student_no: "", class_name: "", gender: "男", age: 10, position: "" };

export default function StudentsPage() {
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 首页星图的「Excel 导入名单」会带 ?import=1 过来，直接打开导入窗口。
  const [showImport, setShowImport] = useState(() => params.get("import") === "1");
  const [renaming, setRenaming] = useState<ClassInfo | null>(null);
  const [normalizing, setNormalizing] = useState(false);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  async function load(search = keyword) {
    setLoading(true);
    try {
      const [list, cls] = await Promise.all([api.listStudents(search), api.listClasses()]);
      setStudents(list.items);
      setClasses(cls.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.has("import")) setParams({}, { replace: true });
    void load("");
    // 只在进入页面时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = classes.find((c) => c.name === activeClass) ?? null;
  const visible = activeClass === null ? students : students.filter((s) => s.class_name === activeClass);
  const suggestions = classes.filter((c) => c.normalized !== c.name);
  const total = classes.reduce((n, c) => n + c.count, 0);
  const preview = normalizeClassName(form.class_name);
  const showPreview = form.class_name.trim() !== "" && preview !== form.class_name.trim();

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, class_name: activeClass ?? "" });
    setShowForm(true);
  }

  function openEdit(student: Student) {
    setEditing(student);
    setForm({
      name: student.name,
      student_no: student.student_no,
      class_name: student.class_name,
      gender: student.gender || "男",
      age: student.age,
      position: student.position ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.updateStudent(editing.id, form);
        flash("学生信息已更新");
      } else {
        await api.createStudent(form);
        flash("学生已添加");
      }
      setShowForm(false);
      void load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(student: Student) {
    if (!confirm(`确定删除学生「${student.name}」吗？`)) return;
    await api.deleteStudent(student.id);
    void load();
  }

  async function normalize() {
    setNormalizing(true);
    try {
      const res = await api.normalizeClasses();
      flash(`已统一 ${res.changes.length} 个班级的写法`);
      setActiveClass(null);
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "统一失败");
    } finally {
      setNormalizing(false);
    }
  }

  async function rename(from: ClassInfo, to: string) {
    const res = await api.renameClass(from.name, to);
    flash(`已改为「${res.name}」，${res.students} 名学生一起调整`);
    setRenaming(null);
    setActiveClass(res.name);
    await load();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">学生管理</h1>
          <p className="mt-1.5 text-sm text-slate-500">按班级管理学生档案，名单可以从 Excel / CSV 一次导入</p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
            <IconUpload className="h-4 w-4" />
            批量导入
          </Button>
          <Button size="sm" onClick={openCreate}>
            <IconPlus className="h-4 w-4" />
            添加学生
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="animate-fade-up flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-5 py-4">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-[13px] text-amber-900">
            <p className="font-medium">
              有 {suggestions.length} 个班级的写法可以统一，统一后同一个班的学生会归到一起
            </p>
            <p className="mt-1 text-amber-800/80">
              {suggestions.map((s) => `${s.name} → ${s.normalized}（${s.count} 人）`).join("；")}
            </p>
          </div>
          <Button size="sm" disabled={normalizing} onClick={() => void normalize()}>
            {normalizing ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "一键统一"}
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Card className="animate-fade-up hidden h-fit p-2 lg:block">
          <p className="px-3 pt-2 pb-1.5 text-xs font-medium text-slate-400">班级</p>
          <ClassRow label="全部学生" count={total} active={activeClass === null} onClick={() => setActiveClass(null)} />
          {classes.map((c) => (
            <ClassRow
              key={c.name || "__none"}
              label={classLabel(c.name)}
              count={c.count}
              detail={`男 ${c.boys} · 女 ${c.girls}`}
              active={activeClass === c.name}
              onClick={() => setActiveClass(c.name)}
              onRename={() => setRenaming(c)}
            />
          ))}
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="lg:hidden">
            <ClassTabs
              groups={classes.map((c) => ({ name: c.name, count: c.count }))}
              value={activeClass}
              onChange={setActiveClass}
              total={total}
              allLabel="全部学生"
            />
          </div>

          <Card className="animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-[15px] font-semibold text-slate-900">{current ? classLabel(current.name) : "全部学生"}</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  {current
                    ? `${current.count} 人 · 男 ${current.boys} · 女 ${current.girls}`
                    : `${total} 人 · ${classes.length} 个班级`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {current && (
                  <Button variant="ghost" size="sm" onClick={() => setRenaming(current)}>
                    <IconPencil className="h-4 w-4" />
                    改班级名
                  </Button>
                )}
                <div className="w-full sm:w-56">
                  <Input
                    placeholder="搜索姓名 / 学号"
                    value={keyword}
                    onChange={(e) => {
                      setKeyword(e.target.value);
                      void load(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex h-56 items-center justify-center">
                <Spinner className="h-7 w-7" />
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                title={keyword ? "没有找到匹配的学生" : "还没有学生档案"}
                description={keyword ? "换个关键字试试" : "添加学生后即可为其上传训练视频"}
                action={!keyword && <Button onClick={openCreate}>添加学生</Button>}
              />
            ) : (
              <div className="divide-y divide-slate-50">
                {visible.map((student) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:px-6"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-semibold text-white">
                      {student.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{student.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[
                          student.student_no,
                          activeClass === null ? classLabel(student.class_name) : "",
                          student.gender,
                          student.age ? `${student.age} 岁` : "",
                          student.position,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "暂无详细信息"}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(student)}>
                      编辑
                    </Button>
                    <button
                      onClick={() => void handleDelete(student)}
                      className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="删除学生"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-sm"
          onClick={() => setShowForm(false)}
        >
          <Card className="animate-fade-up w-full max-w-md p-6">
            <div onClick={(e) => e.stopPropagation()}>
              <div className="mb-5 flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <IconUsers className="h-4 w-4" />
                </span>
                <h2 className="display-tight text-[17px] font-semibold text-slate-900">
                  {editing ? "编辑学生" : "添加学生"}
                </h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input label="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="学号"
                    value={form.student_no}
                    onChange={(e) => setForm({ ...form, student_no: e.target.value })}
                  />
                  <Input
                    label="班级"
                    list="class-options"
                    placeholder="如：2年级1班、大班"
                    value={form.class_name}
                    onChange={(e) => setForm({ ...form, class_name: e.target.value })}
                  />
                  <datalist id="class-options">
                    {classes
                      .filter((c) => c.name)
                      .map((c) => (
                        <option key={c.name} value={c.name} />
                      ))}
                  </datalist>
                </div>
                {showPreview && (
                  <p className="-mt-2 text-xs text-brand-600">班级会保存为「{preview}」，和同班同学归在一起</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Select label="性别" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </Select>
                  <Input
                    label="年龄"
                    type="number"
                    min={3}
                    max={30}
                    value={form.age}
                    onChange={(e) => setForm({ ...form, age: Number(e.target.value) })}
                  />
                </div>

                <Select
                  label="场上位置"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                >
                  <option value="">未设置</option>
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>

                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>
                    取消
                  </Button>
                  <Button type="submit" className="flex-1" disabled={saving}>
                    {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "保存"}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>
      )}

      {renaming && <RenameDialog info={renaming} onClose={() => setRenaming(null)} onSubmit={(to) => rename(renaming, to)} />}

      {showImport && <ImportStudentsDialog onClose={() => setShowImport(false)} onImported={() => void load()} />}

      {toast && <Toast message={toast} tone={toast.includes("失败") ? "error" : "success"} />}
    </div>
  );
}

function ClassRow({
  label,
  count,
  detail,
  active,
  onClick,
  onRename,
}: {
  label: string;
  count: number;
  detail?: string;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
}) {
  return (
    <div
      className={`group flex items-center rounded-xl transition ${
        active ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail && <span className="block text-[11px] text-slate-400">{detail}</span>}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
            active ? "bg-white text-brand-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      </button>
      {onRename && (
        <button
          type="button"
          onClick={onRename}
          title="改班级名"
          className={`mr-1.5 rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700 ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <IconPencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function RenameDialog({
  info,
  onClose,
  onSubmit,
}: {
  info: ClassInfo;
  onClose: () => void;
  onSubmit: (to: string) => Promise<void>;
}) {
  const [value, setValue] = useState(info.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = normalizeClassName(value);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview) {
      setError("请填写新的班级名称");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card className="animate-fade-up w-full max-w-sm p-6">
        <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="space-y-4">
          <div>
            <h2 className="display-tight text-[17px] font-semibold text-slate-900">改班级名</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              「{classLabel(info.name)}」的 {info.count} 名学生和相关评价表会一起改
            </p>
          </div>
          <Input label="新的班级名称" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          {preview && preview !== value.trim() && (
            <p className="-mt-2 text-xs text-brand-600">会保存为「{preview}」</p>
          )}
          {error && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "保存"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
