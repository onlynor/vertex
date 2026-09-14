import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ABILITY_LABELS, CHART, type AbilityKey, type Scores } from "../lib/abilities";

interface RadarTickProps {
  x?: number | string;
  y?: number | string;
  cy?: number | string;
  textAnchor?: string;
  payload?: { value?: string };
}

/**
 * 六维能力雷达。每个顶点直接标出「名称 + 分数」，不必悬停也能读到全部数值。
 */
export default function AbilityRadar({
  scores,
  dims,
  height = 260,
  name = "能力",
}: {
  scores: Scores;
  dims: AbilityKey[];
  height?: number;
  name?: string;
}) {
  const data = dims.map((d) => ({ label: ABILITY_LABELS[d], value: scores[d] ?? 0 }));
  const byLabel = new Map(data.map((row) => [row.label, row.value]));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="66%" margin={{ top: 18, right: 32, bottom: 18, left: 32 }}>
          <PolarGrid stroke={CHART.grid} />
          <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
          <PolarAngleAxis
            dataKey="label"
            tick={(props: RadarTickProps) => <RadarTick {...props} scores={byLabel} />}
          />
          <Tooltip
            formatter={(value) => [`${value} 分`, name]}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 8px 24px -12px rgba(16,24,40,0.2)",
              fontSize: 13,
            }}
          />
          <Radar
            dataKey="value"
            name={name}
            stroke={CHART.brand}
            strokeWidth={2}
            fill={CHART.brand}
            fillOpacity={0.14}
            dot={{ r: 4, fill: CHART.brand, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 顶点标签：上半部分的标签向上排、下半部分向下排，避免压到图形上。 */
function RadarTick({ x, y, cy, textAnchor, payload, scores }: RadarTickProps & { scores: Map<string, number> }) {
  const label = payload?.value ?? "";
  const top = Number(y) < Number(cy) - 4;
  const bottom = Number(y) > Number(cy) + 4;
  const firstDy = top ? "-0.95em" : bottom ? "0.85em" : "-0.2em";

  return (
    <text
      x={x}
      y={y}
      // Recharts 传入的是普通字符串，取值只会是 start / middle / end 之一。
      textAnchor={textAnchor as "start" | "middle" | "end" | "inherit" | undefined}
      fontSize={12.5}
    >
      <tspan x={x} dy={firstDy} fill={CHART.ink} fontWeight={500}>
        {label}
      </tspan>
      <tspan x={x} dy="1.25em" fill={CHART.muted} fontSize={12}>
        {scores.get(label) ?? "—"}
      </tspan>
    </text>
  );
}
