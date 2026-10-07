import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";
import { requireAdmin, assertSameOrg } from "./authHelpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const orgId = await resolveOrgId(ctx);
    const allDepts = await ctx.db.query("departments").collect();
    if (!orgId) return [];
    const depts = allDepts.filter((d: any) => d.orgId === orgId);
    const staff = orgId
      ? await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("staff").collect();
    return depts.map((d: any) => ({
      ...d,
      headName: d.headStaffId ? staff.find((s: any) => s._id === d.headStaffId)?.name ?? null : null,
      staffCount: staff.filter((s: any) => s.department === d.name).length,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    headStaffId: v.optional(v.id("staff")),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db.insert("departments", {
      ...args,
      orgId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    deptId: v.id("departments"),
    name: v.string(),
    description: v.optional(v.string()),
    headStaffId: v.optional(v.id("staff")),
    color: v.optional(v.string()),
  },
  handler: async (ctx, { deptId, ...rest }) => {
    const { orgId } = await requireAdmin(ctx);
    const dept = await ctx.db.get(deptId);
    if (!dept) throw new Error("Department not found");
    assertSameOrg(orgId, dept.orgId);
    await ctx.db.patch(deptId, rest);
  },
});

export const remove = mutation({
  args: { deptId: v.id("departments") },
  handler: async (ctx, { deptId }) => {
    const { orgId } = await requireAdmin(ctx);
    const dept = await ctx.db.get(deptId);
    if (!dept) throw new Error("Department not found");
    assertSameOrg(orgId, dept.orgId);
    await ctx.db.delete(deptId);
  },
});

export const updateHours = mutation({
  args: {
    deptId: v.id("departments"),
    officeHours: v.object({
      monday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      tuesday:   v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      wednesday: v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      thursday:  v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      friday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      saturday:  v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      sunday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
    }),
  },
  handler: async (ctx, { deptId, officeHours }) => {
    const { orgId } = await requireAdmin(ctx);
    const dept = await ctx.db.get(deptId);
    if (!dept) throw new Error("Department not found");
    assertSameOrg(orgId, dept.orgId);
    await ctx.db.patch(deptId, { officeHours });
  },
});