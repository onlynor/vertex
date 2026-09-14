import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { NetPattern, SoccerBall, TurfStripes } from "../components/Football";
import { IconClock, IconTrash, IconUpload, IconVideo } from "../components/Icons";
import { Button, Card, Select, Spinner } from "../components/ui";
import { POSITION_ITEMS, resolvePosition } from "../lib/abilities";
import { api } from "../lib/api";
import { classGroups, classLabel } from "../lib/classes";
import {
  isPreviewable,
  readVideoDuration,
  validateDuration,
  validateFormatAndSize,
} from "../lib/validateVideo";
import type { Student } from "../types";

interface Picked {
  file: File;
  url: string | null;
  duration: number | null;
}

export default function AnalyzePage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [selected, setSelected] = useState<Picked | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => classGroups(students), [students]);
  const selectedStudent = students.find((s) => String(s.id) === studentId) ?? null;
  const focus = selectedStudent?.position ? resolvePosition(selectedStudent.position) : null;

  useEffect(() => {
    api
      .listStudents()
      .then((res) => {
        setStudents(res.items);
        if (res.items.length > 0) setStudentId(String(res.items[0].id));
      })
      .catch(() => undefined);
  }, []);

  async function handleFile(file: File) {
    setError(null);
    const formatCheck = validateFormatAndSize(file);
    if (!formatCheck.ok) {
      setError(formatCheck.message!);
      return;
    }

    setChecking(true);
    try {
      // 为 null 说明浏览器无法解码（如 AVI）：服务端的 ffprobe 校验才是权威，
      // 因此放行而不是在这里拦截。
      const duration = await readVideoDuration(file);
      if (duration !== null) {
        const durationCheck = validateDuration(duration);
        if (!durationCheck.ok) {
          setError(durationCheck.message!);
          return;
        }
      }
      setSelected({
        file,
        url: isPreviewable(file) ? URL.createObjectURL(file) : null,
        duration,
      });
    } finally {
      setChecking(false);
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function clearSelection() {
    if (selected?.url) URL.revokeObjectURL(selected.url);
    setSelected(null);
  }

  async function handleSubmit() {
    if (!selected || !studentId) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.analyzeVideo(selected.file, Number(studentId));
      navigate(`/result/${res.id}`, { state: { previewUrl: selected.url } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败，请重试");
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up">
        <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">视频分析</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          上传一段 1 分钟以内的训练视频，AI 会认出练的是什么，告诉你哪里做得好、哪里要改；设置了场上位置的学生还会重点看位置专项动作
        </p>
      </div>

      {students.length === 0 ? (
        <Card className="animate-fade-up p-10 text-center">
          <SoccerBall className="mx-auto mb-4 h-12 w-12 opacity-70" />
          <p className="text-[15px] font-medium text-slate-800">还没有学生档案</p>
          <p className="mt-1.5 text-sm text-slate-500">
            请先在「学生管理」中添加学生，再上传训练视频
          </p>
          <Button className="mt-5" onClick={() => navigate("/students")}>
            去添加学生
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-3">
          <Card className="animate-fade-up p-6 lg:col-span-2">
            {selected ? (
              <div>
                {selected.url ? (
                  <video
                    src={selected.url}
                    controls
                    className="w-full rounded-xl bg-black"
                    style={{ maxHeight: 380 }}
                  />
                ) : (
                  <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl bg-ink-950 py-16">
                    <TurfStripes className="absolute inset-0" />
                    <SoccerBall className="relative mb-4 h-14 w-14" />
                    <p className="relative text-sm font-medium text-white">
                      {selected.file.name.split(".").pop()?.toUpperCase()} 格式已选中
                    </p>
                    <p className="relative mt-1 text-xs text-slate-400">
                      浏览器无法预览该格式，但不影响 AI 分析
                    </p>
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {selected.file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {(selected.file.size / 1024 / 1024).toFixed(1)} MB
                      {selected.duration !== null
                        ? ` · ${Math.round(selected.duration)} 秒`
                        : " · 时长由服务端校验"}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    <IconTrash className="h-4 w-4" />
                    重新选择
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className={`relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-20 text-center transition-all duration-300 ${
                  dragOver
                    ? "border-brand-500 bg-brand-50/60"
                    : "border-slate-200 hover:border-brand-300 hover:bg-slate-50/60"
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <NetPattern
                  id="drop-net"
                  className="pointer-events-none absolute inset-0 text-brand-600/[0.05]"
                />
                <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                  {checking ? <Spinner className="h-6 w-6" /> : <IconUpload className="h-7 w-7" />}
                </div>
                <p className="display-tight relative text-[17px] font-medium text-slate-800">
                  {checking ? "正在校验视频…" : "点击上传视频"}
                </p>
                <p className="relative mt-1.5 text-sm text-slate-500">
                  支持 MP4、MOV、AVI、WebM 格式，单个文件不超过 100MB
                </p>
                <p className="relative mt-1 text-sm text-slate-400">时长 1 分钟以内，建议 20~30 秒</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/avi,.avi"
                  className="hidden"
                  onChange={onInputChange}
                />
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
            )}

            {/* 参考设计中的特性标签行 */}
            <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-2 border-t border-slate-100 pt-5 text-[13px] text-slate-500">
              <span className="flex items-center gap-2">
                <SoccerBall className="h-4 w-4" />
                自动识别训练项目
              </span>
              <span className="flex items-center gap-2">
                <IconVideo className="h-4 w-4 text-slate-400" />
                上传后自动开始分析
              </span>
              <span className="flex items-center gap-2">
                <IconTrash className="h-4 w-4 text-slate-400" />
                训练视频保留可回放
              </span>
            </div>
          </Card>

          <div className="space-y-5">
            <Card className="animate-fade-up p-6">
              <h2 className="mb-4 text-[15px] font-semibold text-slate-900">本次训练信息</h2>
              <div className="space-y-4">
                <Select
                  label="班级"
                  value={`c:${selectedStudent?.class_name ?? ""}`}
                  onChange={(e) => {
                    const first = students.find((s) => s.class_name === e.target.value.slice(2));
                    if (first) setStudentId(String(first.id));
                  }}
                >
                  {groups.map((g) => (
                    <option key={g.name} value={`c:${g.name}`}>
                      {classLabel(g.name)} · {g.count} 人
                    </option>
                  ))}
                </Select>
                <Select label="学生" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  {students
                    .filter((s) => s.class_name === (selectedStudent?.class_name ?? s.class_name))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.student_no ? ` · ${s.student_no}` : ""}
                      </option>
                    ))}
                </Select>
                <p className="-mt-1 text-xs leading-relaxed text-slate-500">
                  {focus && !focus.isDefault ? (
                    <>
                      场上位置：<span className="font-medium text-slate-700">{focus.position}</span>，AI 会重点看
                      {POSITION_ITEMS[focus.position].map((i) => i.label).join("、")}
                    </>
                  ) : (
                    "还没设置场上位置（可在学生管理里设置），AI 按通用动作分析"
                  )}
                </p>
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium text-slate-600">
                    训练项目
                  </span>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500">
                    由 AI 自动识别
                  </div>
                </div>
              </div>

              <Button
                className="mt-6 w-full !rounded-xl !py-3"
                disabled={!selected || uploading}
                onClick={handleSubmit}
              >
                {uploading ? (
                  <Spinner className="h-4 w-4 border-white/40 border-t-white" />
                ) : (
                  "开始 AI 分析"
                )}
              </Button>
            </Card>

            {/* 拍摄指南卡片，替代参考设计中的示例片段 */}
            <Card className="animate-fade-up overflow-hidden">
              <div className="relative flex h-32 items-center justify-center overflow-hidden bg-ink-950">
                <TurfStripes className="absolute inset-0" />
                <NetPattern id="tips-net" className="absolute inset-0 text-white/[0.06]" />
                <SoccerBall className="ball-bounce relative h-11 w-11" />
              </div>
              <div className="p-5">
                <p className="text-sm font-medium text-slate-800">怎样拍效果最好</p>
                <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-slate-500">
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    横屏拍摄，人和球都完整入镜
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    镜头固定不晃，光线充足
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    单人出镜，背景尽量简洁
                  </li>
                </ul>
                <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-[13px] text-slate-500">
                  <IconClock className="h-4 w-4 text-slate-400" />
                  分析通常需要 30 秒 ~ 2 分钟
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
