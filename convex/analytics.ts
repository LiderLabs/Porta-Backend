import { resolveOrgId } from "./getOrgId";
﻿import { query } from "./_generated/server";
import { v } from "convex/values";

export const getSummary = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const orgId = await resolveOrgId(ctx);
    const numDays = days ?? 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (numDays - 1));
    startDate.setHours(0, 0, 0, 0);
    const startTs = startDate.getTime();
    const allVisitors = await ctx.db.query("visitors").collect();
    const rangeVisitors = allVisitors.filter((v: any) => v.checkInTime >= startTs && (!orgId || v.orgId === orgId));

    // Daily counts
    const daily: Record<string, number> = {};
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      daily[key] = 0;
    }
    rangeVisitors.forEach((v) => {
      const key = new Date(v.checkInTime).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (key in daily) daily[key]++;
    });

    // Purpose breakdown
    const purposeMap: Record<string, number> = {};
    rangeVisitors.forEach((v) => {
      const p = v.purpose ?? "Unknown";
      purposeMap[p] = (purposeMap[p] ?? 0) + 1;
    });

    // Peak hours (0-23)
    const hourMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourMap[h] = 0;
    rangeVisitors.forEach((v) => {
      const hour = new Date(v.checkInTime).getHours();
      hourMap[hour]++;
    });
    const peakHours = Object.entries(hourMap)
      .map(([hour, count]) => ({
        hour: formatHour(parseInt(hour)),
        count,
      }))
      .filter((h) => parseInt(Object.keys(hourMap).find((k) => formatHour(parseInt(k)) === h.hour) ?? "0") >= 7 &&
        parseInt(Object.keys(hourMap).find((k) => formatHour(parseInt(k)) === h.hour) ?? "0") <= 19);

    // Unique visitors by email or name
    const uniqueSet = new Set(rangeVisitors.map((v) => v.email ?? v.fullName));

    return {
      totalVisits: rangeVisitors.length,
      uniqueVisitors: uniqueSet.size,
      avgDaily: Math.round(rangeVisitors.length / numDays),
      dailyCounts: Object.entries(daily).map(([label, count]) => ({ label, count })),
      purposes: Object.entries(purposeMap)
        .map(([purpose, count]) => ({ purpose, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      peakHours,
    };
  },
});

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return h + "am";
  if (h === 12) return "12pm";
  return (h - 12) + "pm";
}

// Keep old summary export for backwards compat
export const summary = getSummary;
