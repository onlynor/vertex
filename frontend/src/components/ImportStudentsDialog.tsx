import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { api } from "../lib/api";
import type { StudentImportResult } from "../types";
import { IconAlert, IconCheck, IconDownload, IconUpload } from "./Icons";
import { Button, Card, Spinner } from "./ui";

const ACCEPTED = [".csv", ".xlsx"];
const MAX_SIZE = 5 * 1024 * 1024;

export default function ImportStudentsDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudentImportResult | null>(null);

  async function handleFile(file: File) {
    setError(null);
    const name = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
      setError("仅支持 CSV 或 Excel(.xlsx) 文件");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("文件过大，请上传 5MB 以内的名单");
      return;
    }

    setUploading(true);
    try {
      const res = await api.importStudents(file);
      setResult(res);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card className="animate-fade-up w-full max-w-lg">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="display-tight text-[18px] font-semibold text-slate-900">
              批量导入学生
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              支持 Excel(.xlsx) 和 CSV，可包含姓名、学号、性别、年龄、班级、位置；班级写成「二年级一班」也行，会统一成「2年级1班」
            </p>
          </div>

          <div className="px-6 py-5">
            {result ? (
              <ImportSummary result={result} />
            ) : (
              <>
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all ${
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
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                    {uploading ? <Spinner className="h-6 w-6" /> : <IconUpload className="h-6 w-6" />}
                  </div>
                  <p className="text-[15px] font-medium text-slate-800">
                    {uploading ? "正在导入…" : "点击或拖拽上传学生名单"}
                  </p>
                  <p className="mt-1.5 text-[13px] text-slate-500">
                    支持 .xlsx / .csv，单个文件不超过 5MB
                  </p>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={onInputChange}
                  />
                </div>

                {error && (
                  <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">
                    {error}
                  </p>
                )}

                <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3.5">
                  <p className="text-[13px] font-medium text-slate-700">不知道格式？下载模板</p>
                  <p className="mt-1 text-xs text-slate-500">
                    模板已包含正确的表头和一行示例，填好后直接上传即可
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void api.downloadImportTemplate("xlsx")}
                    >
                      <IconDownload className="h-4 w-4" />
                      Excel 模板
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void api.downloadImportTemplate("csv")}
                    >
                      <IconDownload className="h-4 w-4" />
                      CSV 模板
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
            {result ? (
              <>
                <Button variant="secondary" onClick={() => setResult(null)}>
                  继续导入
                </Button>
                <Button onClick={onClose}>完成</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                取消
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function ImportSummary({ result }: { result: StudentImportResult }) {
  const stats = [
    { label: "新增", value: result.created, tone: "text-emerald-600" },
    { label: "更新", value: result.updated, tone: "text-brand-600" },
    { label: "跳过", value: result.skipped, tone: "text-slate-500" },
  ];

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <IconCheck className="h-4 w-4" />
        </span>
        <p className="text-[15px] font-medium text-slate-800">导入完成</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {stats.map(({ label, value, tone }) => (
          <div key={label} className="rounded-xl bg-slate-50 px-4 py-3 text-center">
            <p className={`display-tight text-[22px] font-semibold ${tone}`}>{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {result.errors.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-amber-600">
            <IconAlert className="h-4 w-4" />
            {result.errors.length} 行未能导入
          </div>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-amber-100 bg-amber-50/60">
            <ul className="divide-y divide-amber-100/70">
              {result.errors.map((err, i) => (
                <li key={i} className="px-3.5 py-2 text-[13px] text-slate-600">
                  <span className="font-medium text-amber-700">第 {err.row} 行：</span>
                  {err.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
