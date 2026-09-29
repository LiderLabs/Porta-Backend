import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { resolveOrgId } from "./getOrgId";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin, assertSameOrg } from "./authHelpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    const direct = (await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgId)).collect()).filter(s => s.status !== "inactive");
    if (direct.length > 0) return direct;
    const orgSetting = await ctx.db.query("orgSettings").filter(q => q.eq((q.field as any)("orgId"), orgId)).first();
    if (orgSetting) {
      const byOrgSetting = await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgSetting._id as any)).collect();
      if (byOrgSetting.length > 0) return byOrgSetting;
    }
    const all = await ctx.db.query("staff").collect();
    return all.filter(s => s.orgId === orgId || s.orgId === orgSetting?._id);
  },
});

export const getByClerkId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== clerkUserId) return null;

    const direct = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .first();
    if (direct) return direct;

    const email = (identity.email ?? (identity as any).emailAddress ?? "").toLowerCase().trim();
    if (!email) return null;
    const allStaff = await ctx.db.query("staff").collect();
    return allStaff.find(s => !s.clerkUserId && s.email?.toLowerCase().trim() === email) ?? null;
  },
});

export const autoLinkByEmail = mutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (ctx, { clerkUserId, email }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== clerkUserId) return null;
    const verified = (identity.email ?? "").toLowerCase().trim();
    if (!verified || verified !== email.toLowerCase().trim()) return null;

    const direct = await ctx.db.query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId)).first();
    if (direct) return direct;

    const all = await ctx.db.query("staff").collect();
    const match = all.find((s) => !s.clerkUserId &&
      s.email?.toLowerCase().trim() === verified);
    if (!match) return null;
    await ctx.db.patch(match._id, { clerkUserId });
    return { ...match, clerkUserId };
  },
});

export const createWithRole = internalMutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    department: v.optional(v.string()),
    phone: v.optional(v.string()),
    orgId: v.optional(v.string()),
    role: v.optional(v.union(
      v.literal("receptionist"), v.literal("employee"),
      v.literal("dept_head"), v.literal("pa"), v.literal("admin")
    )),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("staff", { availability: "available", ...args });
  },
});

export const add = mutation({
  args: {
    name: v.string(),
    phone: v.string(),
    department: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db.insert("staff", {
      name: args.name.trim(),
      phone: args.phone.trim(),
      department: args.department?.trim(),
      email: args.email?.trim(),
      orgId,
      role: "employee",
      status: "active",
      availability: "available",
    });
  },
});

export const update = mutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    phone: v.string(),
    department: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, name, phone, department, email }) => {
    const { orgId } = await requireAdmin(ctx);
    const record = await ctx.db.get(staffId);
    if (!record) throw new Error("Staff member not found");
    assertSameOrg(orgId, record.orgId);
    await ctx.db.patch(staffId, {
      name: name.trim(),
      phone: phone.trim(),
      department: department?.trim(),
      email: email?.trim(),
    });
  },
});

export const remove = mutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const { identity, orgId } = await requireAdmin(ctx);
    const record = await ctx.db.get(staffId);
    if (!record) return;
    assertSameOrg(orgId, record.orgId);
    if (record.clerkUserId === identity.subject)
      throw new Error("You can't remove yourself");
    await ctx.db.delete(staffId);
  },
});

export const updateRole = mutation({
  args: {
    staffId: v.id("staff"),
    role: v.union(
      v.literal("receptionist"), v.literal("employee"),
      v.literal("dept_head"), v.literal("pa"), v.literal("admin")
    ),
  },
  handler: async (ctx, { staffId, role }) => {
    const { identity, orgId } = await requireAdmin(ctx);
    const record = await ctx.db.get(staffId);
    if (!record) throw new Error("Staff member not found");
    assertSameOrg(orgId, record.orgId);
    if (record.clerkUserId === identity.subject)
      throw new Error("You can't change your own role");
    await ctx.db.patch(staffId, { role });
  },
});

export const assertCanManageEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const { orgId } = await requireAdmin(ctx);
    const target = email.toLowerCase().trim();
    const inOrg = await ctx.db.query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (!inOrg.some((s) => s.email?.toLowerCase().trim() === target))
      throw new Error("Not authorized for this staff member");
    return true;
  },
});

export const resetPassword = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ success: boolean }> => {
    await ctx.runQuery(internal.staff.assertCanManageEmail, { email });
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    const searchRes = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
      { headers: { Authorization: "Bearer " + clerkSecretKey } }
    );
    if (!searchRes.ok) throw new Error("Failed to look up user");
    const users = await searchRes.json() as any[];
    if (!users.length) throw new Error("This staff member has not accepted their invite yet and has no account to reset.");

    const resetRes = await fetch("https://api.clerk.com/v1/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + clerkSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: users[0].id,
        email_name: "reset_password",
      }),
    });

    if (!resetRes.ok) {
      const linkRes = await fetch("https://api.clerk.com/v1/magic_links", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + clerkSecretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address_id: users[0].email_addresses?.[0]?.id,
          redirect_url: process.env.STAFF_APP_URL ?? "http://localhost:5174",
          expires_in_seconds: 3600,
        }),
      });
      if (!linkRes.ok) throw new Error("Failed to send reset email");
    }

    return { success: true };
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), identity.subject))
      .first();
  },
});