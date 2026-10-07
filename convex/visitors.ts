import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";
import { requireAdminOrReceptionist, assertSameOrg } from "./authHelpers";

export const getTodayStats = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) {
      return {
        totalToday:     0,
        currentlyIn:    0,
        checkedOut:     0,
        totalYesterday: 0,
      };
    }

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

    const filteredToday = todayVisitors.filter((v) => v.orgId === orgId);
    const filteredYesterday = yesterdayVisitors.filter((v) => v.orgId === orgId);

    return {
      totalToday:     filteredToday.length,
      currentlyIn:    filteredToday.filter((v) => v.status === "IN").length,
      checkedOut:     filteredToday.filter((v) => v.status === "OUT").length,
      totalYesterday: filteredYesterday.length,
    };
  },
});

export const getRecentCheckIns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];

    const targetLimit = limit ?? 8;
    const fetchLimit = Math.max(targetLimit * 5, 50);
    const recent = await ctx.db
      .query("visitors")
      .withIndex("by_checkInTime")
      .order("desc")
      .take(fetchLimit);

    return recent.filter((v) => v.orgId === orgId).slice(0, targetLimit);
  },
});

export const getTodayScheduled = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];

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

    return scheduled.filter((v) => v.orgId === orgId);
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
    const { orgId } = await requireAdminOrReceptionist(ctx);
    return await ctx.db.insert("visitors", {
      ...args,
      orgId,
      checkInTime: Date.now(),
      status: "IN",
    });
  },
});

export const checkOut = mutation({
  args: { visitorId: v.id("visitors") },
  handler: async (ctx, { visitorId }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const visitor = await ctx.db.get(visitorId);
    if (!visitor) throw new Error("Visitor not found");
    assertSameOrg(orgId, visitor.orgId);

    await ctx.db.patch(visitorId, {
      status:       "OUT",
      checkOutTime: Date.now(),
    });
  },
});

