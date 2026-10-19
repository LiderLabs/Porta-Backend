import { resolveOrgId } from "./getOrgId";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, assertSameOrg } from "./authHelpers";

/**
 * Assign a PA to a staff member.
 * Caller must be admin. Both staff records must belong to the same org.
 */
export const assign = mutation({
  args: { paStaffId: v.id("staff"), targetStaffId: v.id("staff") },
  handler: async (ctx, { paStaffId, targetStaffId }) => {
    const { orgId } = await requireAdmin(ctx);

    const paStaff = await ctx.db.get(paStaffId);
    if (!paStaff) throw new Error("PA staff record not found");
    assertSameOrg(orgId, paStaff.orgId);

    const targetStaff = await ctx.db.get(targetStaffId);
    if (!targetStaff) throw new Error("Target staff record not found");
    assertSameOrg(orgId, targetStaff.orgId);

    const existing = await ctx.db
      .query("paAssignments")
      .filter((q) =>
        q.and(
          q.eq(q.field("paStaffId"), paStaffId),
          q.eq(q.field("targetStaffId"), targetStaffId)
        )
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("paAssignments", { paStaffId, targetStaffId, createdAt: Date.now() });
  },
});

/**
 * Remove a PA assignment.
 * Caller must be admin; the assignment's PA must belong to the same org.
 */
export const unassign = mutation({
  args: { assignmentId: v.id("paAssignments") },
  handler: async (ctx, { assignmentId }) => {
    const { orgId } = await requireAdmin(ctx);

    const assignment = await ctx.db.get(assignmentId);
    if (!assignment) throw new Error("Assignment not found");

    const paStaff = await ctx.db.get(assignment.paStaffId);
    if (!paStaff) throw new Error("PA staff record not found");
    assertSameOrg(orgId, paStaff.orgId);

    await ctx.db.delete(assignmentId);
  },
});

/**
 * List all PA assignments in the caller's org.
 * Falls back to [] when no orgId can be resolved.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    const staff = await ctx.db.query("staff").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const staffIds = new Set(staff.map((s: any) => s._id));
    const assignments = await ctx.db.query("paAssignments").collect();
    return assignments.filter((a: any) => staffIds.has(a.paStaffId) || staffIds.has(a.targetStaffId));
  },
});

/**
 * Get the staff members assigned to a PA.
 * Allowed roles: admin, pa.
 * If the caller is a PA, they can only look up their own assignments.
 */
export const getStaffForPA = query({
  args: { paStaffId: v.id("staff") },
  handler: async (ctx, { paStaffId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Look up the caller's own staff record to determine role + org.
    const callerStaff = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), identity.subject))
      .first();

    const role = callerStaff?.role;
    if (role !== "admin" && role !== "superadmin" && role !== "pa") {
      throw new Error("Not authorized");
    }

    // A PA can only read their own assignments.
    if (role === "pa") {
      if (!callerStaff || callerStaff._id !== paStaffId) {
        throw new Error("Not authorized");
      }
    }

    // Org check: the requested PA must belong to the same org as the caller.
    const paStaffRecord = await ctx.db.get(paStaffId);
    if (!paStaffRecord) return [];
    assertSameOrg(callerStaff?.orgId, paStaffRecord.orgId);

    const assignments = await ctx.db
      .query("paAssignments")
      .filter((q) => q.eq(q.field("paStaffId"), paStaffId))
      .collect();

    const staffList = await Promise.all(
      assignments.map(async (a) => {
        const s = await ctx.db.get(a.targetStaffId);
        return s ? { ...s, assignmentId: a._id } : null;
      })
    );
    return staffList.filter(Boolean);
  },
});

// getPAsForStaff removed — not called from any frontend or backend code.
