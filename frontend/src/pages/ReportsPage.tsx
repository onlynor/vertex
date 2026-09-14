import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ClassTabs from "../components/ClassTabs";
import { IconDownload, IconTrash } from "../components/Icons";
import {
  AuthImage,
  Button,
  Card,
  EmptyState,
  levelColor,
  Select,
  Spinner,
  StatusBadge,
  Stars,
  Toast,
} from "../components/ui";
import { api, thumbUrl } from "../lib/api";
import { classGroups } from "../lib/classes";
import type { Student, VideoRecord } from "../types";

export default function ReportsPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<VideoRecord[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentFilter, setStudentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const groups = useMemo(() => classGroups(students), [students]);
  const classStudents = activeClass === null ? students : students.filter((s) => s.class_name === activeClass);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.listVideos({
        student_id: studentFilter ? Number(studentFilter) : undefined,
        status: statusFilter || undefined,
        class_name: !studentFilter && activeClass !== null ? activeClass : undefined,
      });
      setRecords(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.listStudents().then((res) => setStudents(res.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentFilter, statusFilter, activeClass]);

  async function handleExport(format: "csv" | "xlsx") {
    setExporting(true);
    try {
      const student = students.find((s) => String(s.id) === studentFilter);
      await api.exportReports(format, {
        student: student ? { id: student.id, name: student.name } : undefined,
        className: activeClass ?? undefined,
      });
      setToast(format === "xlsx" ? "已导出 Excel 文件" : "已导出 CSV 文件");
      setTimeout(() => setToast(null), 2400);
    } catch {
      setToast("导出失败，请重试");
      setTimeout(() => setToast(null), 2400);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定删除这条分析记录吗？")) return;
    await api.deleteVideo(id);
    void load();
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">训练报告</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            每次视频分析的结果都在这里，按班级、学生查看；导出 Excel / CSV 按当前筛选导出，单份报告在详情页导出 PDF
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="secondary" size="sm" disabled={exporting} onClick={() => handleExport("csv")}>
            <IconDownload className="h-4 w-4" />
            导出 CSV
          </Button>
          <Button variant="secondary" size="sm" disabled={exporting} onClick={() => handleExport("xlsx")}>
            <IconDownload className="h-4 w-4" />
            导出 Excel
          </Button>
        </div>
      </div>

      <Card className="animate-fade-up">
        <div className="border-b border-slate-100 px-4 pt-4 pb-3 sm:px-6">
          <ClassTabs
            groups={groups}
            value={activeClass}
            onChange={(value) => {
              setActiveClass(value);
              setStudentFilter("");
            }}
            total={students.length}
          />
        </div>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div className="w-44">
            <Select value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} aria-label="学生">
              <option value="">{activeClass === null ? "全部学生" : "本班全部学生"}</option>
              {classStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              <option value="done">已完成</option>
              <option value="processing">分析中</option>
              <option value="failed">失败</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex h-56 items-center justify-center">
            <Spinner className="h-7 w-7" />
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            title="还没有训练报告"
            description="上传一段训练视频后，报告会显示在这里"
            action={<Button onClick={() => navigate("/analyze")}>去分析视频</Button>}
          />
        ) : (
          <>
            {/* 移动端：卡片式展示。7 列表格在手机上无法阅读。 */}
            <div className="divide-y divide-slate-50 md:hidden">
              {records.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(`/result/${item.id}`)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition active:bg-slate-50"
                >
                  <AuthImage
                    src={thumbUrl(item.id)}
                    alt={item.student_name}
                    className="h-14 w-20 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.student_name}
                      </p>
                      <StatusBadge status={item.status} />
                    </div>
                    {item.report && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`text-[13px] font-medium ${levelColor(item.report.level)}`}>
                          {item.report.level}
                        </span>
                        <Stars rating={item.report.rating} />
                      </div>
                    )}
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {item.report?.summary ?? item.error_msg ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {new Date(item.created_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[13px] text-slate-500">
                  <th className="px-6 py-3 font-medium">训练画面</th>
                  <th className="px-4 py-3 font-medium">学生</th>
                  <th className="px-4 py-3 font-medium">综合表现</th>
                  <th className="px-4 py-3 font-medium">整体总结</th>
                  <th className="px-4 py-3 font-medium">分析时间</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {records.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer transition hover:bg-slate-50/70"
                    onClick={() => navigate(`/result/${item.id}`)}
                  >
                    <td className="px-6 py-3">
                      <AuthImage
                        src={thumbUrl(item.id)}
                        alt={item.student_name}
                        className="h-12 w-20 rounded-lg object-cover"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-800">{item.student_name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.report?.training_type ?? item.training_type}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {item.report ? (
                        <div>
                          <p className={`text-sm font-medium ${levelColor(item.report.level)}`}>
                            {item.report.level}
                          </p>
                          <Stars rating={item.report.rating} className="mt-1" />
                        </div>
                      ) : (
                        <span className="text-sm text-slate-300">—</span>
                      )}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-slate-500">
                        {item.report?.summary ?? item.error_msg ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[13px] whitespace-nowrap text-slate-500">
                      {new Date(item.created_at).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(item.id);
                        }}
                        className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                        title="删除记录"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      {toast && <Toast message={toast} tone={toast.includes("失败") ? "error" : "success"} />}
    </div>
  );
}
