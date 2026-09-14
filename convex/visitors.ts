import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";

export const getTodayStats = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startTs = startOfDay.getTime();
    const endOfDay = new Date(now);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const yesterdayStart = new Date(startTs - 86400000);
    const yesterdayEnd   = new Date(startTs - 1);

    const todayVisitors = await ctx.db
      .query("visitors")
      .withIndex("by_checkInTime", (q) =>
        q.gte("checkInTime", startTs).lte("checkInTime", endOfDay.getTime())
      )
      .collect();

    const yesterdayVisitors = await ctx.db
      .query("visitors")
      .withIndex("by_checkInTime", (q) =>
        q.gte("checkInTime", yesterdayStart.getTime()).lte("checkInTime", yesterdayEnd.getTime())
      )
      .collect();

    return {
      totalToday:     todayVisitors.length,
      currentlyIn:    todayVisitors.filter((v) => v.status === "IN").length,
      checkedOut:     todayVisitors.filter((v) => v.status === "OUT").length,
      totalYesterday: yesterdayVisitors.length,
    };
  },
});

export const getRecentCheckIns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("visitors")
      .withIndex("by_checkInTime")
      .order("desc")
      .take(limit ?? 8);
  },
});

export const getTodayScheduled = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const scheduled = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", startOfDay.getTime()).lte("scheduledDate", endOfDay.getTime())
      )
      .collect();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("visitors").withIndex("by_checkInTime").order("desc").collect();
    if (!orgId) return [];
    return all.filter((v: any) => v.orgId === orgId);
  },
});

export const checkIn = mutation({
  args: {
    fullName:  v.string(),
    phone:     v.optional(v.string()),
    email:     v.optional(v.string()),
    company:   v.optional(v.string()),
    purpose:   v.optional(v.string()),
    hostId:    v.optional(v.id("staff")),
    idType:    v.optional(v.string()),
    idNumber:  v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("visitors", {
      ...args,
      checkInTime: Date.now(),
      status: "IN",
    });
  },
});

export const checkOut = mutation({
  args: { visitorId: v.id("visitors") },
  handler: async (ctx, { visitorId }) => {
    await ctx.db.patch(visitorId, {
      status:       "OUT",
      checkOutTime: Date.now(),
    });
  },
});

export const debugAll = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("visitors").collect();
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    return {
      serverNowHuman:    new Date(now).toISOString(),
      utcMidnightHuman:  startOfDay.toISOString(),
      totalVisitors:     all.length,
      visitors: all.map((v) => ({
        name:         v.fullName,
        status:       v.status,
        checkInHuman: new Date(v.checkInTime).toISOString(),
        isToday:      v.checkInTime >= startOfDay.getTime(),
      })),
    };
  },
});

