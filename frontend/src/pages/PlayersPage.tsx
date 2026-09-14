import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AbilityRadar from "../components/AbilityRadar";
import { IconAlert, IconDownload, IconRadar, IconReport, IconRun, IconSpark } from "../components/Icons";
import PlayerPrint from "../components/print/PlayerPrint";
import { PrintPortal, type PrintJob } from "../components/print/PrintKit";
import {
  BarList,
  Button,
  Card,
  EmptyState,
  levelColor,
  SectionHeader,
  Select,
  SourceBadge,
  Spinner,
  Toast,
} from "../components/ui";
import {
  ABILITY_LABELS,
  buildHistory,
  CHART,
  attendanceSummary,
  currentProfile,
  dataSources,
  evaluationAverages,
  evaluationFields,
  fmtShortDate,
  inRange,
  LEVEL_HEX,
  levelDistribution,
  levelOf,
  liveEvaluations,
  mockEvaluations,
  overallOf,
  playerFilename,
  playerWorkbook,
  POSITION_DIMENSIONS,
  POSITIONS,
  PROFILE_WINDOW,
  rangeLabel,
  recentNotes,
  resolvePosition,
  TIME_RANGES,
  withinRange,
  type AbilityKey,
  type DataSource,
  type Note,
  type Position,
  type Session,
  type TimeRange,
} from "../lib/abilities";
import { api } from "../lib/api";
import { classGroups, classLabel } from "../lib/classes";
import type { Student, StudentEvaluationRecord, VideoRecord } from "../types";

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "0 8px 24px -12px rgba(16,24,40,0.2)",
  fontSize: 13,
};

const ACTIVE_DOT = { r: 5, fill: CHART.brand, stroke: "#fff", strokeWidth: 2 };

export default function PlayersPage() {
  const [params, setParams] = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [view, setView] = useState<{
    studentId: number;
    videos: VideoRecord[];
    evaluations: StudentEvaluationRecord[];
  } | null>(null);
  const [range, setRange] = useState<TimeRange>("all");
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  useEffect(() => {
    api
      .listStudents()
      .then((res) => setStudents(res.items))
      .catch(() => undefined)
      .finally(() => setLoadingStudents(false));
  }, []);

  // 地址栏里的学生不存在（例如已被删除）时，退回到列表中的第一个学生。
  const paramId = Number(params.get("student"));
  const selected = students.find((s) => s.id === paramId) ?? students[0] ?? null;
  const selectedId = selected?.id ?? 0;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    // 课堂评价读取失败时按没有记录处理，不影响视频数据的展示。
    Promise.all([
      api
        .listVideos({ student_id: selectedId, limit: 500 })
        .then((res) => res.items)
        .catch((): VideoRecord[] => []),
      api
        .studentEvaluations(selectedId)
        .then((res) => res.items)
        .catch((): StudentEvaluationRecord[] => []),
    ]).then(([videos, evaluations]) => {
      if (!cancelled) setView({ studentId: selectedId, videos, evaluations });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // 切换学生时，新数据到达前继续显示上一位学生的图表（半透明），到达后整体替换，页面不跳动。
  const loading = selectedId !== 0 && view?.studentId !== selectedId;
  const shown = view ? (students.find((s) => s.id === view.studentId) ?? null) : null;
  const shownPosition = resolvePosition(shown?.position);
  const position = shownPosition.position;
  const dims = POSITION_DIMENSIONS[position];

  const history = useMemo(
    () => (view ? buildHistory(view.studentId, view.videos, position) : null),
    [view, position],
  );
  const sessions = useMemo(
    () => (history ? withinRange(history.sessions, range) : []),
    [history, range],
  );
  const profile = useMemo(() => currentProfile(sessions, dims), [sessions, dims]);
  // 教学评价优先用「智能评价」技能评价表里老师的打分；所选时间范围内没有记录时才用示例值。
  const liveEvals = useMemo(
    () => (view ? liveEvaluations(view.evaluations, position).filter((e) => inRange(e.date, range)) : []),
    [view, range, position],
  );
  const evaluations = useMemo(
    () => (liveEvals.length ? liveEvals : view ? mockEvaluations(view.studentId, sessions, position) : []),
    [liveEvals, view, sessions, position],
  );
  const evaluationSource: DataSource = liveEvals.length ? "live" : "mock";
  const evalFields = useMemo(() => evaluationFields(position), [position]);
  const attendance = useMemo(() => (view ? attendanceSummary(view.evaluations, range) : null), [view, range]);
  const classes = useMemo(() => classGroups(students), [students]);
  const yDomain = useMemo(() => trendDomain(sessions, dims), [sessions, dims]);

  const overall = overallOf(profile, dims);
  const firstSession = sessions[0];
  const lastSession = sessions[sessions.length - 1];
  const overallDelta =
    firstSession && lastSession && sessions.length >= 2
      ? lastSession.overall - firstSession.overall
      : null;
  const realCount = sessions.filter((s) => !s.isMock).length;
  const mockCount = sessions.length - realCount;
  const scoreSource: DataSource = sessions.some((s) => s.scoreSource === "mock") ? "mock" : "live";
  const profileSize = Math.min(PROFILE_WINDOW, sessions.length);
  const selectedPosition = resolvePosition(selected?.position);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2400);
  }

  // 导出内容与页面上看到的一致：当前学生、当前时间范围。
  const exportData =
    shown && sessions.length
      ? {
          student: shown,
          position,
          positionIsDefault: shownPosition.isDefault,
          range,
          sessions,
          dims,
          profile,
          overall,
          evaluations,
        }
      : null;

  async function exportExcel() {
    if (!exportData) return;
    setExporting(true);
    try {
      await api.exportXlsx(playerFilename(exportData.student), playerWorkbook(exportData));
      flash("已导出 Excel 文件");
    } catch (err) {
      flash(err instanceof Error ? `导出失败：${err.message}` : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  // 位置是学生档案的属性而不是页面筛选条件，所以改动会写回学生档案，
  // 结果页的「本次能力分析」也随之使用新的维度。
  async function changePosition(next: Position) {
    if (!selected) return;
    try {
      await api.updateStudent(selected.id, {
        name: selected.name,
        student_no: selected.student_no,
        class_name: selected.class_name,
        gender: selected.gender,
        age: selected.age,
        position: next,
      });
      setStudents((list) => list.map((s) => (s.id === selected.id ? { ...s, position: next } : s)));
      flash(`已将 ${selected.name} 的位置设为「${next}」`);
    } catch (err) {
      flash(err instanceof Error ? err.message : "位置保存失败");
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-tight text-[22px] font-semibold text-slate-900 sm:text-[28px]">
            球员能力
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            汇总学生历次训练视频的分析结果和课堂评价，形成长期能力画像
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={!exportData || loading || exporting}
            onClick={() => void exportExcel()}
          >
            <IconDownload className="h-4 w-4" />
            导出 Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!exportData || loading}
            title="打开打印窗口，选择「另存为 PDF」"
            onClick={() => exportData && setPrintJob({ title: playerFilename(exportData.student) })}
          >
            <IconDownload className="h-4 w-4" />
            导出 PDF
          </Button>
        </div>
      </div>

      {loadingStudents ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : !selected ? (
        <Card className="animate-fade-up">
          <EmptyState
            title="还没有学生档案"
            description="先在「学生管理」中添加学生，再为其上传训练视频"
            action={
              <Link
                to="/students"
                className="inline-flex items-center rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
              >
                去添加学生
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="animate-fade-up p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_auto_auto] lg:items-end">
              <Select
                label="班级"
                value={`c:${selected.class_name}`}
                onChange={(e) => {
                  const first = students.find((s) => s.class_name === e.target.value.slice(2));
                  if (first) setParams({ student: String(first.id) });
                }}
              >
                {classes.map((c) => (
                  <option key={c.name} value={`c:${c.name}`}>
                    {classLabel(c.name)} · {c.count} 人
                  </option>
                ))}
              </Select>
              <Select
                label="学生"
                value={selected.id}
                onChange={(e) => setParams({ student: e.target.value })}
              >
                {students
                  .filter((s) => s.class_name === selected.class_name)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.student_no ? ` · ${s.student_no}` : ""}
                    </option>
                  ))}
              </Select>
              <Select
                label="位置"
                value={selectedPosition.position}
                onChange={(e) => void changePosition(e.target.value as Position)}
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
              <div>
                <span className="mb-1.5 block text-[13px] font-medium text-slate-600">时间范围</span>
                <Segmented options={TIME_RANGES} value={range} onChange={setRange} />
              </div>
              <div className="lg:min-w-[92px] lg:text-right">
                <span className="mb-1.5 block text-[13px] font-medium text-slate-600">训练次数</span>
                <p className="py-[7px] text-[17px] font-semibold text-slate-900">
                  {loading ? "—" : realCount}
                  <span className="ml-1 text-[13px] font-medium text-slate-500">次</span>
                </p>
              </div>
            </div>
            {(selectedPosition.isDefault || (history?.unrecognised ?? 0) > 0) && (
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                {selectedPosition.isDefault && (
                  <p>
                    {selected.name} 尚未设置场上位置，当前按中场维度展示；选择位置后会保存到学生档案。
                  </p>
                )}
                {!loading && (history?.unrecognised ?? 0) > 0 && (
                  <p>另有 {history?.unrecognised} 条视频未识别到足球训练内容，未计入能力统计。</p>
                )}
              </div>
            )}
          </Card>

          {!view ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="h-8 w-8" />
            </div>
          ) : (
            <div
              className={`space-y-6 transition-opacity duration-200 ${
                loading ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {scoreSource === "mock" && sessions.length > 0 && (
                <div className="animate-fade-up flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-5 py-3.5">
                  <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p className="text-[13px] leading-relaxed text-amber-900">
                    {realCount === 0
                      ? "该学生还没有可用的训练视频，以下能力图表全部为示例数据，仅用于展示页面结构。"
                      : "AI 分析结果暂未输出分项能力分，能力相关图表为依据已有记录（训练项目、综合表现）推算的示例数据。"}
                    {realCount > 0 &&
                      mockCount > 0 &&
                      ` 另补充了 ${mockCount} 次示例训练，用于展示变化趋势。`}
                    {" "}接入真实数据后自动切换，字段见页面底部「数据来源说明」。
                    {realCount === 0 && (
                      <Link to="/analyze" className="ml-1 font-medium underline underline-offset-2">
                        去上传训练视频
                      </Link>
                    )}
                  </p>
                </div>
              )}

              {sessions.length === 0 || !firstSession || !lastSession ? (
                <Card className="animate-fade-up">
                  <EmptyState
                    title="该时间范围内没有训练记录"
                    description="把时间范围切换为「全部」看看"
                  />
                </Card>
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-5">
                    <Card className="animate-fade-up flex flex-col p-6 lg:col-span-2">
                      <SectionHeader
                        icon={<IconSpark className="h-4 w-4" />}
                        tint="bg-brand-50 text-brand-600"
                        title="综合能力"
                        aside={<SourceBadge source={scoreSource} />}
                      />
                      <div className="flex items-end gap-4">
                        <p className="display-tight text-[56px] leading-none font-semibold text-slate-900">
                          {overall}
                        </p>
                        <div className="pb-1.5">
                          <p className={`text-[15px] font-semibold ${levelColor(levelOf(overall))}`}>
                            {levelOf(overall)}
                          </p>
                          {overallDelta !== null && (
                            <p className="mt-0.5 text-xs text-slate-500">
                              较首次{" "}
                              <span
                                className={`font-medium ${
                                  overallDelta >= 0 ? "text-emerald-600" : "text-red-500"
                                }`}
                              >
                                {overallDelta >= 0 ? "↑" : "↓"} {Math.abs(overallDelta)}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-slate-400">
                        满分 100 · 近 {profileSize} 次训练平均 · {position}维度
                      </p>

                      <div className="mt-auto pt-6">
                        <p className="mb-1 text-xs text-slate-500">历次综合能力</p>
                        <OverallSpark sessions={sessions} />
                        <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                          <span>{fmtShortDate(firstSession.date)}</span>
                          <span>{fmtShortDate(lastSession.date)}</span>
                        </div>
                      </div>
                    </Card>

                    <Card className="animate-fade-up p-6 lg:col-span-3">
                      <SectionHeader
                        icon={<IconRadar className="h-4 w-4" />}
                        tint="bg-brand-50 text-brand-600"
                        title="能力雷达"
                        aside={<SourceBadge source={scoreSource} />}
                      />
                      <p className="-mt-1.5 text-xs text-slate-400">
                        近 {profileSize} 次训练平均的{position}六维画像
                      </p>
                      <AbilityRadar scores={profile} dims={dims} height={300} name="能力画像" />
                    </Card>
                  </div>

                  <Card className="animate-fade-up p-6">
                    <SectionHeader
                      icon={<IconRun className="h-4 w-4" />}
                      tint="bg-brand-50 text-brand-600"
                      title="能力变化"
                      aside={<SourceBadge source={scoreSource} />}
                    />
                    <div className="-mt-1.5 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
                      <span>按训练先后展示每项能力的变化，六张小图纵轴统一为 {yDomain[0]}~100 分</span>
                      {mockCount > 0 && (
                        <span className="flex items-center gap-3 text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-brand-600" />
                            训练记录
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full border-[1.5px] border-brand-600 bg-white" />
                            示例数据
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {dims.map((d) => (
                        <TrendPanel key={d} dim={d} sessions={sessions} domain={yDomain} />
                      ))}
                    </div>
                  </Card>

                  <Card className="animate-fade-up p-6">
                    <SectionHeader
                      icon={<IconReport className="h-4 w-4" />}
                      tint="bg-brand-50 text-brand-600"
                      title="训练表现统计"
                    />
                    <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
                      <section>
                        <SubHead
                          title="各项平均评分"
                          aside={
                            <SourceBadge
                              source={evaluationSource}
                              label={
                                evaluationSource === "live"
                                  ? `课堂评价 · ${liveEvals.length} 次`
                                  : "课堂评价 · 示例"
                              }
                            />
                          }
                        />
                        <BarList
                          max={5}
                          rows={evaluationAverages(evaluations, evalFields).map((r) => ({
                            label: r.label,
                            value: r.value,
                            display: r.value?.toFixed(1),
                            title: r.count ? `${r.count} 次课有评分` : "暂无评分",
                          }))}
                        />
                        <p className="mt-3 text-xs leading-relaxed text-slate-400">
                          满分 5 星。
                          {attendance &&
                            `出勤 ${attendance.present}/${attendance.total} 次${attendance.detail ? `（${attendance.detail}）` : ""}。`}
                          {evaluationSource === "live" ? (
                            "来自「智能评价」里的常规、期中、期末和赛事评价。"
                          ) : (
                            <>
                              该学生在此范围内还没有课堂评价记录，当前为示例；在
                              <Link to="/evaluations" className="mx-0.5 text-brand-600 hover:underline">
                                智能评价
                              </Link>
                              中填写后自动改用真实评分。
                            </>
                          )}
                        </p>
                      </section>

                      <section>
                        <SubHead
                          title="表现等级占比"
                          aside={
                            <SourceBadge
                              source={mockCount > 0 ? "mock" : "live"}
                              label={mockCount > 0 ? "含示例训练" : "分析记录"}
                            />
                          }
                        />
                        <LevelDonut levels={levelDistribution(sessions)} total={sessions.length} />
                      </section>

                      <section className="space-y-5">
                        <div>
                          <SubHead
                            title="本课亮点"
                            aside={<SourceBadge source="live" label="真实记录" />}
                          />
                          <NoteList
                            notes={recentNotes(sessions, evaluations, "highlights")}
                            tone="emerald"
                            empty="暂无亮点记录"
                          />
                        </div>
                        <div>
                          <SubHead title="需改进" />
                          <NoteList
                            notes={recentNotes(sessions, evaluations, "issues")}
                            tone="amber"
                            empty="暂未发现明显问题"
                          />
                        </div>
                      </section>
                    </div>
                  </Card>
                </>
              )}

              <DataSourceNotes evaluationsLive={evaluationSource === "live"} />
            </div>
          )}
        </>
      )}

      {exportData && (
        <PrintPortal job={printJob} onDone={() => setPrintJob(null)}>
          <PlayerPrint
            student={exportData.student}
            position={position}
            positionIsDefault={shownPosition.isDefault}
            rangeText={rangeLabel(range)}
            sessions={sessions}
            dims={dims}
            profile={profile}
            overall={overall}
            overallDelta={overallDelta}
            realCount={realCount}
            mockCount={mockCount}
            scoreSource={scoreSource}
            domain={yDomain}
            evaluationRows={evaluationAverages(evaluations, evalFields)}
            evaluationSource={evaluationSource}
            levels={levelDistribution(sessions)}
            highlights={recentNotes(sessions, evaluations, "highlights")}
            issues={recentNotes(sessions, evaluations, "issues")}
          />
        </PrintPortal>
      )}

      {toast && <Toast message={toast} tone={toast.includes("失败") ? "error" : "success"} />}
    </div>
  );
}

/** 六张小图共用同一个纵轴范围，否则同样的起伏在不同小图里看起来幅度不同。 */
function trendDomain(sessions: Session[], dims: AbilityKey[]): [number, number] {
  const values = sessions
    .flatMap((s) => dims.map((d) => s.scores[d]))
    .filter((v): v is number => typeof v === "number");
  if (!values.length) return [0, 100];
  return [Math.max(0, Math.floor((Math.min(...values) - 6) / 10) * 10), 100];
}

interface TrendRow {
  label: string;
  date: string;
  trainingType: string;
  v: number | null;
  mock: boolean;
}

function toRows(sessions: Session[], pick: (s: Session) => number | undefined): TrendRow[] {
  return sessions.map((s) => ({
    label: s.label,
    date: fmtShortDate(s.date),
    trainingType: s.trainingType,
    v: pick(s) ?? null,
    mock: s.isMock,
  }));
}

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { mock?: boolean };
}

/** 实心点是真实训练，空心点是补齐结构用的示例训练。 */
function renderSessionDot({ cx, cy, index, payload }: DotProps) {
  if (typeof cx !== "number" || typeof cy !== "number") return <g key={`d${index}`} />;
  return payload?.mock ? (
    <circle key={`d${index}`} cx={cx} cy={cy} r={3.25} fill="#fff" stroke={CHART.brand} strokeWidth={1.5} />
  ) : (
    <circle key={`d${index}`} cx={cx} cy={cy} r={4} fill={CHART.brand} stroke="#fff" strokeWidth={2} />
  );
}

function TrendTooltip({
  active,
  payload,
  title,
}: {
  active?: boolean;
  payload?: { payload?: TrendRow }[];
  title: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-xs shadow-[0_8px_24px_-12px_rgba(16,24,40,0.25)]">
      <p className="font-medium text-slate-800">
        {row.label} · {row.date}
      </p>
      <p className="mt-0.5 text-slate-500">
        {title} <span className="font-semibold text-slate-900">{row.v ?? "—"}</span>
      </p>
      <p className="mt-0.5 text-slate-400">{row.mock ? "示例数据" : row.trainingType}</p>
    </div>
  );
}

function OverallSpark({ sessions }: { sessions: Session[] }) {
  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={toRows(sessions, (s) => s.overall)} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={["dataMin - 8", "dataMax + 4"]} />
          <Tooltip content={<TrendTooltip title="综合能力" />} cursor={{ stroke: CHART.grid }} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={CHART.brand}
            strokeWidth={2}
            fill={CHART.brand}
            fillOpacity={0.08}
            dot={renderSessionDot}
            activeDot={ACTIVE_DOT}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendPanel({
  dim,
  sessions,
  domain,
}: {
  dim: AbilityKey;
  sessions: Session[];
  domain: [number, number];
}) {
  const rows = toRows(sessions, (s) => s.scores[dim]);
  const values = rows.map((r) => r.v).filter((v): v is number => v !== null);
  const first = values[0];
  const latest = values[values.length - 1];
  const delta = values.length >= 2 && first !== undefined && latest !== undefined ? latest - first : null;
  // 与需求示例一致的「68 → 72 → 78」写法，过长时只保留最近四次。
  const sequence = (values.length > 4 ? "… " : "") + values.slice(-4).join(" → ");

  return (
    <div className="rounded-xl bg-slate-50/80 px-4 pt-3.5 pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-700">{ABILITY_LABELS[dim]}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[20px] leading-none font-semibold text-slate-900">{latest ?? "—"}</span>
          {delta !== null && delta !== 0 && (
            <span className={`text-xs font-medium ${delta > 0 ? "text-emerald-600" : "text-red-500"}`}>
              {delta > 0 ? "↑" : "↓"}
              {Math.abs(delta)}
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={domain} />
            <Tooltip content={<TrendTooltip title={ABILITY_LABELS[dim]} />} cursor={{ stroke: CHART.grid }} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={CHART.brand}
              strokeWidth={2}
              fill={CHART.brand}
              fillOpacity={0.08}
              dot={renderSessionDot}
              activeDot={ACTIVE_DOT}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1.5 text-xs text-slate-400 tabular-nums">{sequence}</p>
    </div>
  );
}

function LevelDonut({ levels, total }: { levels: { level: string; count: number }[]; total: number }) {
  const data = levels.filter((l) => l.count > 0);
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[136px] w-[136px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="level"
              innerRadius={44}
              outerRadius={64}
              startAngle={90}
              endAngle={-270}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="#fff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((l) => (
                <Cell key={l.level} fill={LEVEL_HEX[l.level]} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [`${value} 次`, String(name)]} contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] leading-none font-semibold text-slate-900">{total}</span>
          <span className="mt-1 text-[11px] text-slate-400">次训练</span>
        </div>
      </div>
      {/* 图例同时给出档位、次数和占比，颜色之外还有文字可读。 */}
      <ul className="min-w-0 flex-1 space-y-2.5">
        {levels.map((l) => (
          <li key={l.level} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LEVEL_HEX[l.level] }} />
            <span className={l.count ? "text-slate-700" : "text-slate-400"}>{l.level}</span>
            <span className="ml-auto text-slate-500 tabular-nums">
              {l.count} 次 · {total ? Math.round((l.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteList({ notes, tone, empty }: { notes: Note[]; tone: "emerald" | "amber"; empty: string }) {
  if (!notes.length) return <p className="text-sm text-slate-400">{empty}</p>;
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <ul className="space-y-2.5">
      {notes.map((n) => (
        <li key={n.text} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span className="min-w-0">
            {n.text}
            <span className="ml-1.5 text-xs whitespace-nowrap text-slate-400">
              {fmtShortDate(n.date)} · {n.origin}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function SubHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h4 className="text-[13px] font-semibold text-slate-700">{title}</h4>
      {aside}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all ${
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DataSourceNotes({ evaluationsLive }: { evaluationsLive: boolean }) {
  return (
    <details className="group rounded-2xl border border-black/[0.06] bg-white px-6 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        数据来源说明
        <span className="text-xs text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead>
            <tr className="text-xs text-slate-400">
              <th className="pb-2 pr-4 font-medium">指标</th>
              <th className="pb-2 pr-4 font-medium">数据字段</th>
              <th className="pb-2 pr-4 font-medium">来源</th>
              <th className="pb-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {dataSources(evaluationsLive).map((row) => (
              <tr key={row.metric} className="border-t border-slate-100">
                <td className="py-2.5 pr-4 text-slate-700">{row.metric}</td>
                <td className="py-2.5 pr-4 font-mono text-[12px] text-slate-500">{row.field}</td>
                <td className="py-2.5 pr-4 text-slate-500">{row.origin}</td>
                <td className="py-2.5">
                  <SourceBadge source={row.status} label={row.status === "live" ? "已接入" : "示例"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          能力键：
          {Object.entries(ABILITY_LABELS)
            .map(([key, label]) => `${key}（${label}）`)
            .join("、")}
        </p>
      </div>
    </details>
  );
}
