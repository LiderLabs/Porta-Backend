import { query, mutation, action } from "./_generated/server";
import { resolveOrgId } from "./getOrgId";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    // Try direct match first, then also check orgSettings._id
    const direct = (await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgId)).collect()).filter(s => s.status !== "inactive");
    if (direct.length > 0) return direct;
    // Fallback: orgId might be orgSettings._id, find the org and retry
    const orgSetting = await ctx.db.query("orgSettings").filter(q => q.eq(q.field("orgId"), orgId)).first();
    if (orgSetting) {
      const byOrgSetting = await ctx.db.query("staff").withIndex("by_org", q => q.eq("orgId", orgSetting._id as any)).collect();
      if (byOrgSetting.length > 0) return byOrgSetting;
    }
    // Last fallback: return all staff with matching orgId string
    const all = await ctx.db.query("staff").collect();
    return all.filter(s => s.orgId === orgId || s.orgId === orgSetting?._id);
  },
});

export const getByClerkId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    // Try direct clerkUserId match first
    const direct = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .first();
    if (direct) return direct;
    // Fallback: match by email from Clerk identity and auto-link
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const email = identity.email ?? (identity as any).emailAddress ?? "";
    if (!email) return null;
    const allStaff = await ctx.db.query("staff").collect();
    return allStaff.find(s => s.email?.toLowerCase().trim() === email.toLowerCase().trim()) ?? null;
  },
});

export const autoLinkByEmail = mutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (ctx, { clerkUserId, email }) => {
    const direct = await ctx.db.query("staff").filter((q) => q.eq(q.field("clerkUserId"), clerkUserId)).first();
    if (direct) return direct;
    const allStaff = await ctx.db.query("staff").collect();
    const byEmail = allStaff.find(s => s.email?.toLowerCase().trim() === email.toLowerCase().trim());
    if (!byEmail) return null;
    await ctx.db.patch(byEmail._id, { clerkUserId });
    return { ...byEmail, clerkUserId };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    department: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const safeRole = args.role === "admin" ? "employee" : args.role;
    return await ctx.db.insert("staff", { availability: "available", ...args, role: safeRole });
  },
});

export const createWithRole = mutation({
  args: {
    name:       v.string(),
    email:      v.optional(v.string()),
    department: v.optional(v.string()),
    phone:      v.optional(v.string()),
    orgId:      v.optional(v.string()),
    role:       v.optional(v.union(
      v.literal("receptionist"), v.literal("employee"),
      v.literal("dept_head"),   v.literal("pa"), v.literal("admin")
    )),
    status:     v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const safeRole = args.role === "admin" ? "employee" : args.role;
    return await ctx.db.insert("staff", { availability: "available", ...args, role: safeRole });
  },
});

export const update = mutation({
  args: {
    staffId: v.id("staff"),
    name: v.string(),
    department: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
      clerkUserId: v.optional(v.string()),
    },
    handler: async (ctx, { staffId, ...rest }) => {
    await ctx.db.patch(staffId, rest);
  },
});

export const remove = mutation({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    await ctx.db.delete(staffId);
  },
});

export const invite = action({
  args: {
    name: v.string(),
    email: v.string(),
    department: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    // Send Clerk invitation
    const res = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + clerkSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: args.email,
        public_metadata: { role: "employee" },
        notify: true,
        redirect_url: process.env.STAFF_APP_URL ?? "http://localhost:5174",
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.errors?.[0]?.message ?? "Failed to send invite");
    }

    const invitation = await res.json();

    // Create staff record
    await ctx.runMutation(api.staff.create, {
      name: args.name,
      email: args.email,
      department: args.department,
      phone: args.phone,
    });

    return { success: true, invitationId: invitation.id };
  },
});

export const updateRole = mutation({
  args: {
    staffId: v.id("staff"),
    role: v.union(
      v.literal("receptionist"), v.literal("employee"),
      v.literal("dept_head"),   v.literal("pa"), v.literal("admin")
    ),
  },
  handler: async (ctx, { staffId, role }) => {
    await ctx.db.patch(staffId, { role });
  },
});

export const resetPassword = action({
  args: { email: v.string() },
  handler: async (_ctx, { email }) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    // Find the Clerk user by email first
    const searchRes = await fetch(
      `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
      { headers: { Authorization: "Bearer " + clerkSecretKey } }
    );
    if (!searchRes.ok) throw new Error("Failed to look up user");
    const users = await searchRes.json() as any[];
    if (!users.length) throw new Error("This staff member has not accepted their invite yet and has no account to reset.");

    // Send reset password email
    const resetRes = await fetch("https://api.clerk.com/v1/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + clerkSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id:    users[0].id,
        email_name: "reset_password",
      }),
    });

    if (!resetRes.ok) {
      // Clerk's recommended way: use forgot_password flow
      // Trigger via magic link as fallback
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
export const listByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const all = await ctx.db.query("staff").collect();
    return all.filter((s: any) => s.orgId === orgId);
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













