"use client";
import { useSyncExternalStore } from "react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";

export type ChartBucket = {
  label: string;
  count: number;
  isCurrent: boolean;
};

type EnrichedBucket = ChartBucket & { fill: string };

// Severity-tinted bar palette mirroring the logo's traffic-light dots.
function bucketColor(count: number): string {
  if (count === 0) return "rgba(26, 35, 72, 0.10)"; // empty: faint navy on cream
  if (count >= 3) return "#e74c3c"; // critical-red
  if (count === 2) return "#f39c12"; // high-orange
  return "#2ecc71"; // low-green for a single event
}

// Recharts' ResponsiveContainer measures 0x0 during SSR. useSyncExternalStore
// gates the chart on hydration without the setState-in-effect anti-pattern.
const subscribeNoop = () => () => {};
const isClientSnapshot = () => true;
const isServerSnapshot = () => false;

export function UpgradesChart({ data }: { data: ChartBucket[] }) {
  const mounted = useSyncExternalStore(subscribeNoop, isClientSnapshot, isServerSnapshot);

  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = Math.max(...data.map((d) => d.count), 0);

  const enriched: EnrichedBucket[] = data.map((d) => ({
    ...d,
    fill: bucketColor(d.count),
  }));

  return (
    <div className="card rounded-lg px-5 pb-3 pt-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold text-brand">
            Upgrades over time
          </h3>
          <p className="text-brand-soft mt-0.5 text-xs">
            Last 24 hours · hourly buckets
          </p>
        </div>
        <div className="text-right">
          <span className="text-brand-soft font-mono text-xs">
            {total} event{total === 1 ? "" : "s"}
          </span>
          {peak >= 2 && (
            <span
              className="ml-2 font-mono text-xs font-semibold"
              style={{ color: "var(--severity-critical)" }}
            >
              peak {peak}
            </span>
          )}
        </div>
      </div>

      {mounted ? (
        <ResponsiveContainer width="100%" height={96}>
          <BarChart
            data={enriched}
            barCategoryGap="30%"
            margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 9,
                fill: "rgba(26, 35, 72, 0.55)",
                fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
              }}
              axisLine={false}
              tickLine={false}
              interval={5}
            />
            <Tooltip
              contentStyle={{
                background: "#ffffff",
                border: "1px solid rgba(26, 35, 72, 0.15)",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                color: "#1a2348",
                boxShadow: "0 8px 24px rgba(26, 35, 72, 0.12)",
              }}
              cursor={{ fill: "rgba(26, 35, 72, 0.05)" }}
              formatter={(v) => {
                const n = Number(v ?? 0);
                return [`${n} upgrade${n === 1 ? "" : "s"}`, ""] as [
                  string,
                  string,
                ];
              }}
              labelStyle={{
                color: "rgba(26, 35, 72, 0.6)",
                fontSize: 10,
                marginBottom: 2,
              }}
              separator=""
            />
            <Bar
              dataKey="count"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              minPointSize={3}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-24 w-full" />
      )}
    </div>
  );
}
