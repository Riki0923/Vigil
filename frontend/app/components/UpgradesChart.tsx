"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";

export type ChartBucket = {
  label: string;
  count: number;
  isCurrent: boolean;
};

type EnrichedBucket = ChartBucket & { fill: string };

function bucketColor(count: number): string {
  if (count === 0) return "#27272a";
  if (count >= 2) return "#f87171";
  return "#22c55e";
}

export function UpgradesChart({ data }: { data: ChartBucket[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = Math.max(...data.map((d) => d.count), 0);

  const enriched: EnrichedBucket[] = data.map((d) => ({
    ...d,
    fill: bucketColor(d.count),
  }));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-5 pt-5 pb-3">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-300">Upgrades over time</h3>
          <p className="mt-0.5 text-xs text-zinc-600">Last 24 hours · hourly buckets</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-xs text-zinc-500">
            {total} event{total === 1 ? "" : "s"}
          </span>
          {peak >= 2 && (
            <span className="ml-2 font-mono text-xs text-red-400">peak {peak}</span>
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
                fill: "#52525b",
                fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
              }}
              axisLine={false}
              tickLine={false}
              interval={5}
            />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                color: "#fafafa",
                boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
              }}
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(v) => {
                const n = Number(v ?? 0);
                return [`${n} upgrade${n === 1 ? "" : "s"}`, ""] as [string, string];
              }}
              labelStyle={{ color: "#71717a", fontSize: 10, marginBottom: 2 }}
              separator=""
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={16} minPointSize={3} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-24 w-full" />
      )}
    </div>
  );
}
