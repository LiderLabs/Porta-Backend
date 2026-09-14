import { resolveOrgId } from "./getOrgId";
﻿import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const assign = mutation({
  args: { paStaffId: v.id("staff"), targetStaffId: v.id("staff") },
  handler: async (ctx, { paStaffId, targetStaffId }) => {
    const existing = await ctx.db.query("paAssignments")
      .filter((q) => q.and(q.eq(q.field("paStaffId"), paStaffId), q.eq(q.field("targetStaffId"), targetStaffId)))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("paAssignments", { paStaffId, targetStaffId, createdAt: Date.now() });
  },
});

export const unassign = mutation({
  args: { assignmentId: v.id("paAssignments") },
  handler: async (ctx, { assignmentId }) => { await ctx.db.delete(assignmentId); },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const assignments = await ctx.db.query("paAssignments").collect();
    if (!orgId) return assignments;
    const staff = await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgId)).collect();
    const staffIds = new Set(staff.map((s: any) => s._id));
    return assignments.filter((a: any) => staffIds.has(a.paStaffId) || staffIds.has(a.targetStaffId));
  },
});

export const getStaffForPA = query({
  args: { paStaffId: v.id("staff") },
  handler: async (ctx, { paStaffId }) => {
    const assignments = await ctx.db.query("paAssignments")
      .filter((q) => q.eq(q.field("paStaffId"), paStaffId))
      .collect();
    const staffList = await Promise.all(assignments.map(async (a) => {
      const s = await ctx.db.get(a.targetStaffId);
      return s ? { ...s, assignmentId: a._id } : null;
    }));
    return staffList.filter(Boolean);
  },
});

export const getPAsForStaff = query({
  args: { targetStaffId: v.id("staff") },
  handler: async (ctx, { targetStaffId }) => {
    const assignments = await ctx.db.query("paAssignments")
      .filter((q) => q.eq(q.field("targetStaffId"), targetStaffId))
      .collect();
    const paList = await Promise.all(assignments.map(async (a) => {
      const s = await ctx.db.get(a.paStaffId);
      return s ? { ...s, assignmentId: a._id } : null;
    }));
    return paList.filter(Boolean);
  },
});

