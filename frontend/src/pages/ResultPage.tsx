import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import AbilityRadar from "../components/AbilityRadar";
import { BouncingBall, NetPattern, SoccerBall, TurfStripes } from "../components/Football";
import { IconAlert, IconCheck, IconDownload, IconRadar, IconRun, IconSpark } from "../components/Icons";
import { PrintPortal, type PrintJob } from "../components/print/PrintKit";
import ReportPrint from "../components/print/ReportPrint";
import {
  AuthImage,
  Button,
  Card,
  levelColor,
  SectionHeader,
  SourceBadge,
  Spinner,
  Stars,
} from "../components/ui";
import { POSITION_DIMENSIONS, resolvePosition, videoAbilities } from "../lib/abilities";
import { api, getToken, thumbUrl, videoFileUrl } from "../lib/api";
import type { VideoRecord } from "../types";

const POLL_INTERVAL_MS = 3000;
const steps = ["上传视频", "AI 分析中", "生成结果", "完成"];

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const previewUrl = (location.state as { previewUrl?: string } | null)?.previewUrl ?? null;

  const [record, setRecord] = useState<VideoRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [printThumb, setPrintThumb] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function poll() {
      try {
        const data = await api.getVideo(id!);
        if (cancelled) return;
        setRecord(data);
        if (data.status === "pending" || data.status === "processing") {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "获取分析结果失败");
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id]);

  const running = record?.status === "pending" || record?.status === "processing";

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 模型不会给出真实的进度信号，因此这里按已用时间缓步逼近 90%，
  // 只有当任务真正完成时才显示 100%。
  const progress = record?.status === "done" ? 100 : Math.min(90, Math.round(12 + elapsed * 1.6));

  if (error) {
    return (
      <Card className="mx-auto max-w-md p-10 text-center">
        <p className="text-[15px] font-medium text-slate-800">{error}</p>
        <Button className="mt-5" onClick={() => navigate("/analyze")}>
          返回视频分析
        </Button>
      </Card>
    );
  }

  if (!record) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const activeStep = record.status === "pending" ? 1 : record.status === "processing" ? 2 : 4;

  // 封面图在鉴权接口后面，先取成 blob 再交给打印版式，保证打印时图片已经就绪。
  async function exportPdf() {
    if (!record) return;
    setPreparing(true);
    let url: string | null = null;
    try {
      const res = await fetch(thumbUrl(record.id), { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (res.ok) url = URL.createObjectURL(await res.blob());
    } catch {
      // 没有封面图也可以导出
    }
    setPrintThumb(url);
    setPreparing(false);
    setPrintJob({ title: `${record.student_name}_训练报告_${record.created_at.slice(0, 10).replaceAll("-", "")}` });
  }

  function finishPrint() {
    if (printThumb) URL.revokeObjectURL(printThumb);
    setPrintThumb(null);
    setPrintJob(null);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">
            {record.status === "done" ? "分析结果" : "视频分析中"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {record.student_name} · {record.report?.training_type ?? record.training_type} ·{" "}
            {new Date(record.created_at).toLocaleString("zh-CN")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          {record.status === "done" && record.report && (
            <Button
              variant="secondary"
              size="sm"
              disabled={preparing}
              title="打开打印窗口，选择「另存为 PDF」"
              onClick={() => void exportPdf()}
            >
              <IconDownload className="h-4 w-4" />
              导出 PDF
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate("/analyze")}>
            再分析一段
          </Button>
        </div>
      </div>

      <PrintPortal job={printJob} onDone={finishPrint}>
        <ReportPrint record={record} thumb={printThumb} />
      </PrintPortal>

      {(record.status === "pending" || record.status === "processing") && (
        <Card className="animate-fade-up p-8">
          <div className="mb-10 flex items-center">
            {steps.map((label, i) => {
              const stepIndex = i + 1;
              const done = stepIndex < activeStep;
              const active = stepIndex === activeStep;
              return (
                <div key={label} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium transition-all ${
                        done
                          ? "bg-brand-600 text-white"
                          : active
                            ? "border-2 border-brand-600 bg-white text-brand-600"
                            : "border-2 border-slate-200 bg-white text-slate-300"
                      }`}
                    >
                      {done ? <IconCheck className="h-4 w-4" /> : stepIndex}
                    </div>
                    <span
                      className={`text-xs whitespace-nowrap ${
                        active ? "font-medium text-slate-800" : "text-slate-400"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {stepIndex !== steps.length && (
                    <div
                      className={`mx-3 h-0.5 flex-1 rounded-full transition-all ${
                        done ? "bg-brand-600" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-center py-6 text-center">
            <BouncingBall className="mb-5" />
            <p className="display-tight text-[17px] font-medium text-slate-800">
              {record.status === "pending" ? "视频已上传，正在排队…" : "正在分析视频…"}
            </p>
            <p className="mt-2 max-w-sm text-sm text-slate-500">
              AI 正在识别动作并生成训练反馈，请稍候
            </p>

            <div className="mt-7 w-full max-w-md">
              <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-right text-xs font-medium text-brand-600">{progress}%</p>
            </div>

            <p className="mt-6 flex items-center gap-2 rounded-full bg-brand-50/70 px-4 py-2 text-xs text-brand-700">
              <IconSpark className="h-3.5 w-3.5" />
              分析时间与视频时长、网络环境和模型性能有关，请耐心等待
            </p>
          </div>
        </Card>
      )}

      {record.status === "failed" && (
        <Card className="animate-fade-up flex flex-col items-center p-12 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <IconAlert className="h-7 w-7" />
          </div>
          <p className="display-tight text-[17px] font-medium text-slate-800">分析失败</p>
          <p className="mt-2 text-sm text-slate-500">{record.error_msg || "请稍后重试"}</p>
          <Button className="mt-6" onClick={() => navigate("/analyze")}>
            重新上传
          </Button>
        </Card>
      )}

      {record.status === "done" && record.report && (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-2">
            <Card className="animate-fade-up overflow-hidden">
              {record.video_stored ? (
                <video
                  src={videoFileUrl(record.id)}
                  controls
                  playsInline
                  preload="metadata"
                  poster={undefined}
                  className="aspect-video w-full bg-black"
                />
              ) : previewUrl ? (
                <video src={previewUrl} controls playsInline className="aspect-video w-full bg-black" />
              ) : (
                <AuthImage
                  src={thumbUrl(record.id)}
                  alt="训练画面"
                  className="aspect-video w-full object-cover"
                  fallback={
                    <div className="relative flex h-full w-full flex-col items-center justify-center bg-ink-950">
                      <TurfStripes className="absolute inset-0" />
                      <SoccerBall className="relative h-12 w-12" />
                      <span className="relative mt-3 text-xs text-slate-400">
                        训练视频已因容量回收被清理
                      </span>
                    </div>
                  }
                />
              )}
              <div className="px-5 py-4">
                <p className="text-[13px] text-slate-500">
                  {record.video_stored
                    ? "训练视频已保留，可随时回放"
                    : "训练视频已因容量回收被清理，仅保留封面"}
                </p>
              </div>
            </Card>

            <Card className="animate-fade-up relative overflow-hidden p-6">
              <NetPattern
                id="score-net"
                className="absolute inset-0 text-brand-600/[0.045]"
              />
              <div className="relative">
                <p className="text-[13px] text-slate-500">综合表现</p>
                <p
                  className={`display-tight mt-1 text-[34px] font-semibold ${levelColor(record.report.level)}`}
                >
                  {record.report.level}
                </p>
                <Stars rating={record.report.rating} className="mt-2" />
                <p className="mt-4 text-sm leading-relaxed text-slate-600">
                  {record.report.summary}
                </p>
              </div>
            </Card>

            <SessionAbilityCard record={record} />
          </div>

          <div className="space-y-4 lg:col-span-3">
            <Card className="animate-fade-up p-6">
              <SectionHeader
                icon={<IconRun className="h-4 w-4" />}
                tint="bg-brand-50 text-brand-600"
                title="动作表现"
              />
              <p className="text-sm leading-relaxed text-slate-600">{record.report.performance}</p>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="animate-fade-up p-6">
                <SectionHeader
                  icon={<IconCheck className="h-4 w-4" />}
                  tint="bg-emerald-50 text-emerald-600"
                  title="做得好的地方"
                />
                <BulletList items={record.report.highlights} empty="暂无记录" tone="emerald" />
              </Card>

              <Card className="animate-fade-up p-6">
                <SectionHeader
                  icon={<IconAlert className="h-4 w-4" />}
                  tint="bg-amber-50 text-amber-600"
                  title="发现的问题"
                />
                <BulletList items={record.report.issues} empty="未发现明显问题" tone="amber" />
              </Card>
            </div>

            <Card className="animate-fade-up bg-gradient-to-br from-emerald-50/70 to-white p-6">
              <SectionHeader
                icon={<IconSpark className="h-4 w-4" />}
                tint="bg-emerald-100 text-emerald-700"
                title="改进建议"
              />
              <BulletList
                items={record.report.suggestions}
                empty="继续保持当前训练节奏"
                tone="emerald"
              />
            </Card>

            <div className="flex items-end justify-between gap-6 pt-1">
              <p className="text-xs leading-relaxed text-slate-400">
                本分析由 AI 生成，仅供参考。综合表现为四档定性判断，不代表精确评分；触球次数、技术打分等精确指标当前版本不支持。
              </p>
              <Button size="sm" className="shrink-0" onClick={() => navigate("/analyze")}>
                重新分析
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 本次视频的能力雷达。它只描述这一次视频里的表现；长期画像在「球员能力」页由多次训练汇总而成，
 * 两者刻意分开，避免把一次偶然发挥当成学生的真实水平。
 */
function SessionAbilityCard({ record }: { record: VideoRecord }) {
  const { position, isDefault } = resolvePosition(record.student?.position);
  const abilities = videoAbilities(record, position);

  return (
    <Card className="animate-fade-up p-6">
      <SectionHeader
        icon={<IconRadar className="h-4 w-4" />}
        tint="bg-brand-50 text-brand-600"
        title="本次能力分析"
        aside={abilities && <SourceBadge source={abilities.source} />}
      />

      {!abilities ? (
        <p className="text-sm leading-relaxed text-slate-400">
          本次视频未识别到足球训练内容，无法生成能力分析。
        </p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] text-slate-500">综合能力</p>
              <p className="display-tight mt-0.5 text-[30px] leading-tight font-semibold text-slate-900">
                {abilities.overall}
                <span className="ml-1 text-[14px] font-medium text-slate-400">/ 100</span>
              </p>
            </div>
            <p className="pb-1 text-right text-xs leading-relaxed text-slate-500">
              {position}六维
              {isDefault && <span className="block text-slate-400">未设置位置，按中场展示</span>}
            </p>
          </div>

          <AbilityRadar
            scores={abilities.scores}
            dims={POSITION_DIMENSIONS[position]}
            height={260}
            name="本次表现"
          />

          <div className="mt-1 flex items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
            <p className="text-xs leading-relaxed text-slate-400">仅反映本次视频中的表现，不代表长期能力</p>
            <Link
              to={`/players?student=${record.student_id}`}
              className="shrink-0 text-[13px] font-medium text-brand-600 hover:underline"
            >
              查看长期能力 →
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

function BulletList({
  items,
  empty,
  tone,
}: {
  items: string[];
  empty: string;
  tone: "emerald" | "amber";
}) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">{empty}</p>;
  }
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
