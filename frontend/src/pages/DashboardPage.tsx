import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import pitchPhoto from "../assets/pitch.jpg";
import { BRAND } from "../components/Brand";
import FeatureGalaxy from "../components/FeatureGalaxy";
import { NetPattern, SoccerBall } from "../components/Football";
import { IconClock, IconReport, IconScreen, IconVideo } from "../components/Icons";
import { AuthImage, Card, EmptyState, Spinner, StatusBadge } from "../components/ui";
import { api, thumbUrl } from "../lib/api";
import { useAuth } from "../store/auth";
import type { StatsOverview, VideoRecord } from "../types";

/** 计算周环比变化；没有可对比的上一周数据时返回 null。 */
function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export default function DashboardPage() {
  const { teacher } = useAuth();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [recent, setRecent] = useState<VideoRecord[]>([]);
  const [counts, setCounts] = useState({ sheets: 0, classes: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.stats(),
      api.listVideos({ limit: 3 }),
      api.listEvaluations().catch(() => ({ items: [] })),
      api.listClasses().catch(() => ({ items: [] })),
    ])
      .then(([statsData, videos, sheets, classes]) => {
        setStats(statsData);
        setRecent(videos.items);
        setCounts({ sheets: sheets.items.length, classes: classes.items.filter((c) => c.name).length });
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // 视频通常远短于一分钟，此时“0.3 分钟”不如直接用秒数好读，到一分钟才切换单位。
  const avgSeconds = stats?.avg_duration_sec ?? 0;
  const avgDuration =
    avgSeconds >= 60
      ? { value: (avgSeconds / 60).toFixed(1), unit: "分钟" }
      : { value: String(Math.round(avgSeconds)), unit: "秒" };

  // 三张统计卡片，与参考布局一致：左侧图标、中间数值、右侧周环比。
  const cards = [
    {
      label: "本周分析视频",
      value: String(stats?.week_videos ?? 0),
      unit: "",
      delta: percentDelta(stats?.week_videos ?? 0, stats?.prev_week_videos ?? 0),
      icon: IconVideo,
      tint: "bg-brand-50 text-brand-600",
    },
    {
      label: "已生成报告",
      value: String(stats?.week_reports ?? 0),
      unit: "",
      delta: percentDelta(stats?.week_reports ?? 0, stats?.prev_week_reports ?? 0),
      icon: IconReport,
      tint: "bg-sky-50 text-sky-600",
    },
    {
      label: "平均训练时长",
      value: avgDuration.value,
      unit: avgDuration.unit,
      delta: null,
      icon: IconClock,
      tint: "bg-violet-50 text-violet-600",
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[24px] font-semibold text-slate-900 sm:text-[30px]">
            你好，{teacher?.name}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            今天是 {today}。不知道从哪开始？点下面星图里的任意一个亮点，直接去你要用的功能。
          </p>
        </div>
        <Link
          to="/screen"
          className="group inline-flex items-center gap-2 rounded-full bg-ink-950 px-4 py-2.5 text-[13px] font-medium text-white shadow-[0_8px_24px_-12px_rgba(10,22,40,0.8)] transition hover:bg-ink-900"
        >
          <IconScreen className="h-4 w-4 text-emerald-300" />
          打开数据大屏
          <span className="text-slate-400 transition group-hover:translate-x-0.5">→</span>
        </Link>
      </div>

      <FeatureGalaxy
        badges={{
          students: `${stats?.total_students ?? 0} 名学生 · ${counts.classes} 个班`,
          analyze: `本周 ${stats?.week_videos ?? 0} 段视频`,
          reports: `本周 ${stats?.week_reports ?? 0} 份报告`,
          players: "能力雷达 · 成长曲线",
          evaluations: `${counts.sheets} 张评价表`,
          screen: "全屏展示",
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, unit, delta, icon: Icon, tint }, i) => (
          <Card key={label} className="animate-fade-up p-5">
            <div
              style={{ animationDelay: `${i * 60}ms` }}
              className="flex items-center gap-4"
            >
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tint}`}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-slate-500">{label}</p>
                <p className="display-tight mt-0.5 text-[26px] leading-tight font-semibold text-slate-900">
                  {value}
                  {unit && <span className="ml-1 text-[15px] font-medium">{unit}</span>}
                </p>
              </div>
              {delta !== null && (
                <span
                  className={`shrink-0 text-[13px] font-medium ${
                    delta >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="animate-fade-up p-6 lg:col-span-3">
          <h2 className="text-[15px] font-semibold text-slate-900">训练分析趋势</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.trend ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="#eef0f3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#98a2b3" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#98a2b3" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.06)",
                    boxShadow: "0 8px 24px -12px rgba(16,24,40,0.2)",
                    fontSize: 13,
                  }}
                />
                <Legend
                  align="right"
                  verticalAlign="top"
                  height={28}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, color: "#667085" }}
                />
                <Line
                  type="monotone"
                  dataKey="videos"
                  name="视频分析"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, strokeWidth: 0, fill: "#2563eb" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="reports"
                  name="训练报告"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3.5, strokeWidth: 0, fill: "#10b981" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="animate-fade-up lg:col-span-2">
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <h2 className="text-[15px] font-semibold text-slate-900">最近分析</h2>
          </div>

          {recent.length === 0 ? (
            <EmptyState title="还没有分析记录" description="上传第一段训练视频试试" />
          ) : (
            <>
              <div className="divide-y divide-slate-100">
                {recent.map((item) => (
                  <Link
                    key={item.id}
                    to={`/result/${item.id}`}
                    className="flex items-center gap-3.5 px-6 py-3.5 transition hover:bg-slate-50"
                  >
                    <AuthImage
                      src={thumbUrl(item.id)}
                      alt={item.student_name}
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {item.student_name} · {item.report?.training_type ?? item.training_type}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {new Date(item.created_at).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </Link>
                ))}
              </div>
              <div className="px-6 py-4 text-right">
                <Link to="/reports" className="text-[13px] font-medium text-brand-600 hover:underline">
                  查看全部 →
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* 草地上足球的横幅区，填满首屏下方的留白区域 */}
      <div className="animate-fade-up relative overflow-hidden rounded-3xl bg-ink-950">
        <img
          src={pitchPhoto}
          alt="草地上的足球"
          className="h-56 w-full object-cover object-[62%_72%] sm:h-72"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/45 to-transparent" />
        <NetPattern id="band-net" className="absolute top-0 right-0 h-full w-1/3 text-white/[0.07]" />

        <div className="absolute inset-0 flex items-center px-7 sm:px-10">
          <div className="max-w-lg">
            <div className="mb-3 flex items-center gap-2.5">
              <SoccerBall className="ball-bounce h-8 w-8" />
              <span className="text-[13px] font-medium text-emerald-300">
                {BRAND.latin} {BRAND.chinese}
              </span>
            </div>
            <h2 className="display-tight text-[22px] leading-snug font-semibold text-white sm:text-[26px]">
              上传训练视频，生成分析报告
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-300 sm:text-[14px]">
              支持颠球、运球、传接球、射门等训练项目，
              <br className="hidden sm:block" />
              系统自动识别项目类型并生成动作分析与改进建议
            </p>
            <Link
              to="/analyze"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-slate-100 active:scale-[0.98]"
            >
              上传训练视频
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
