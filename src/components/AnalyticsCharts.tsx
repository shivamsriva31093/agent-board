"use client";

import useSWR from "swr";
import type { PieLabelRenderProps } from "recharts";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Chart colors matching the dark theme
const ACCENT = "#00ff41";
const CYAN = "#00d4ff";
const CARD = "#1a1a2e";
const BORDER = "#2a2a3e";
const DIM = "#888";
const TEXT = "#e0e0e0";

const PIE_COLORS = ["#00ff41", "#00d4ff", "#ffd700", "#ff4141", "#a855f7", "#f97316"];

interface AnalyticsActivity {
  date: string;
  count: number;
}

interface AnalyticsAgent {
  agent_id: string;
  entries: number;
  reactions: number;
  replies: number;
}

interface AnalyticsEntryType {
  entry_type: string;
  count: number;
}

interface AnalyticsExpertise {
  agent_id: string;
  tags: Record<string, number>;
}

interface AnalyticsData {
  activity: AnalyticsActivity[];
  agents: AnalyticsAgent[];
  types: AnalyticsEntryType[];
  expertise: AnalyticsExpertise[];
}

function ChartCard({
  title,
  children,
  empty,
}: {
  title: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: CARD, borderColor: BORDER }}
    >
      <h3
        className="text-xs font-mono mb-3 uppercase tracking-wider"
        style={{ color: DIM }}
      >
        {title}
      </h3>
      {empty ? (
        <div className="flex items-center justify-center h-40">
          <span className="text-xs font-mono" style={{ color: DIM }}>
            No activity yet
          </span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { background: "#0a0a0a", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 },
  labelStyle: { color: DIM, fontFamily: "monospace" },
  itemStyle: { color: TEXT, fontFamily: "monospace" },
};

function ActivityChart({ data }: { data: AnalyticsActivity[] }) {
  return (
    <ChartCard title="Activity (30d)" empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={ACCENT} stopOpacity={0.3} />
              <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            tickFormatter={(v: string) => v.slice(5)}
            interval="preserveStartEnd"
            axisLine={{ stroke: BORDER }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip {...tooltipStyle} />
          <Area
            type="monotone"
            dataKey="count"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#activityGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function AgentChart({ data }: { data: AnalyticsAgent[] }) {
  const chartData = data.slice(0, 8).map((d) => ({
    ...d,
    label: d.agent_id.split("/").pop() ?? d.agent_id,
  }));

  return (
    <ChartCard title="Top Agents" empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} layout="vertical">
          <XAxis
            type="number"
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            axisLine={{ stroke: BORDER }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip {...tooltipStyle} />
          <Bar dataKey="entries" fill={ACCENT} radius={[0, 4, 4, 0]} />
          <Bar dataKey="reactions" fill={CYAN} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function TypeChart({ data }: { data: AnalyticsEntryType[] }) {
  return (
    <ChartCard title="Entry Types" empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="entry_type"
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={60}
            paddingAngle={2}
            label={(props: PieLabelRenderProps) =>
              `${props.name ?? "other"} ${((props.percent ?? 0) * 100).toFixed(0)}%`
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ExpertiseChart({ data }: { data: AnalyticsExpertise[] }) {
  const allTags = new Set<string>();
  for (const agent of data) {
    const sorted = Object.entries(agent.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [tag] of sorted) allTags.add(tag);
  }
  const tagList = [...allTags].slice(0, 6);

  const chartData = data.slice(0, 8).map((agent) => {
    const row: Record<string, string | number> = {
      label: agent.agent_id.split("/").pop() ?? agent.agent_id,
    };
    for (const tag of tagList) {
      row[tag] = agent.tags[tag] ?? 0;
    }
    return row;
  });

  return (
    <ChartCard title="Agent Expertise" empty={data.length === 0}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} layout="vertical">
          <XAxis
            type="number"
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            axisLine={{ stroke: BORDER }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: DIM, fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip {...tooltipStyle} />
          {tagList.map((tag, i) => (
            <Bar
              key={tag}
              dataKey={tag}
              stackId="expertise"
              fill={PIE_COLORS[i % PIE_COLORS.length]}
              radius={i === tagList.length - 1 ? [0, 4, 4, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export default function AnalyticsCharts() {
  const { data, error, isLoading } = useSWR<AnalyticsData>(
    "/api/analytics",
    fetcher,
    { refreshInterval: 60000 }
  );

  if (error) return null;

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 py-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-lg border h-52 animate-pulse"
            style={{ background: CARD, borderColor: BORDER }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 py-4">
      <ActivityChart data={data.activity} />
      <AgentChart data={data.agents} />
      <TypeChart data={data.types} />
      <ExpertiseChart data={data.expertise} />
    </div>
  );
}
