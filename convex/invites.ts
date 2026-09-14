import { resolveOrgId } from "./getOrgId";
﻿import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Which app each role lands on after accepting invite
// admin      ? porta-admin
// receptionist, employee, dept_head, pa ? porta-staff
const STAFF_ROLES = ["receptionist", "employee", "dept_head", "pa"] as const;
const ADMIN_ROLES = ["admin"] as const;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("invites").order("desc").collect();
    if (!orgId) return [];
    return all.filter((i: any) => i.orgId === orgId);
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return await ctx.db
      .query("invites")
      .withIndex("by_token", q => q.eq("token", token))
      .first();
  },
});

export const create = mutation({
  args: {
    name:             v.string(),
    email:            v.string(),
    role:             v.union(
      v.literal("admin"), v.literal("receptionist"),
      v.literal("employee"), v.literal("dept_head"), v.literal("pa")
    ),
    department:       v.optional(v.string()),
    invitedByClerkId: v.string(),
    invitedByName:    v.string(),
    clerkInviteId:    v.optional(v.string()),
    orgId:            v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return await ctx.db.insert("invites", {
      ...args,
      token,
      status:    "pending",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    await ctx.db.patch(inviteId, { status: "revoked" });
  },
});

export const accept = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", q => q.eq("token", token))
      .first();
    if (!invite)                       throw new Error("Invalid invite");
    if (invite.status !== "pending")   throw new Error("Invite already used or revoked");
    if (invite.expiresAt < Date.now()) throw new Error("Invite expired");
    await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: Date.now() });
    return invite;
  },
});

/**
 * sendInvite � called from porta-admin when admin creates a team member.
 *
 * Flow:
 *  1. Sends Clerk invitation email with correct redirect URL per role
 *  2. Sets role + department in Clerk publicMetadata so the right app
 *     recognises them on first login
 *  3. Creates the staff record in Convex (clerkUserId linked later via
 *     linkClerkUser when they first sign in to porta-staff)
 *  4. Records the invite in the invites table
 */
export const sendInvite = action({
  args: {
    name:             v.string(),
    email:            v.string(),
    role:             v.union(
      v.literal("admin"), v.literal("receptionist"),
      v.literal("employee"), v.literal("dept_head"), v.literal("pa")
    ),
    department:       v.optional(v.string()),
    invitedByClerkId: v.string(),
    invitedByName:    v.string(),
    orgId:            v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    // Pick the right redirect URL based on role
    const isAdminRole = (args.role as string) === "admin";
    const redirectUrl = isAdminRole
      ? (process.env.ADMIN_APP_URL  ?? "http://localhost:5176") + "/sign-up"
      : (process.env.STAFF_APP_URL  ?? "http://localhost:5174") + "/sign-up";

    // Send Clerk invitation � sets publicMetadata so role is available
    // immediately after the user signs up via the invite link
    const res = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        "Authorization":  "Bearer " + clerkSecretKey,
        "Content-Type":   "application/json",
      },
      body: JSON.stringify({
        email_address:   args.email,
        public_metadata: {
          role:       args.role,
          department: args.department ?? null,
          orgId:      args.orgId ?? null,
        },
        notify:       true,
        redirect_url: redirectUrl,
      }),
    });

    let clerkInviteId: string | undefined;
    if (res.ok) {
      const data = (await res.json()) as { id: string };
      clerkInviteId = data.id;
    } else {
      const err = (await res.json()) as { errors?: { message: string }[] };
      const msg = err.errors?.[0]?.message ?? "Failed to send Clerk invite";
      if (msg.toLowerCase().includes("duplicate")) throw new Error("An invite was already sent to this email. Please revoke the existing invite first.");
      throw new Error(msg);
    }

    // Create the staff record now � clerkUserId will be linked when they
    // first log in via linkClerkUser mutation below
    await ctx.runMutation(api.staff.createWithRole, {
      name:       args.name,
      email:      args.email,
      department: args.department,
      role:       args.role === "admin" ? "employee" : args.role,
      status:     "active",
      orgId:      args.orgId,
    });

    // Record invite
    const inviteId: string = await ctx.runMutation(api.invites.create, {
      name:             args.name,
      email:            args.email,
      role:             args.role,
      department:       args.department,
      invitedByClerkId: args.invitedByClerkId,
      invitedByName:    args.invitedByName,
      orgId:            args.orgId,
      clerkInviteId,
    });

    return { success: true, inviteId };
  },
});

/**
 * linkClerkUser � called from porta-staff on first login.
 * Finds the staff record by email and stamps the clerkUserId on it
 * so all subsequent queries (listByStaff, getByClerkId, etc.) work.
 */
export const linkClerkUser = mutation({
  args: {
    clerkUserId: v.string(),
    email:       v.string(),
  },
  handler: async (ctx, { clerkUserId, email }) => {
    // Find unlinked staff record matching this email
    const staffMember = await ctx.db
      .query("staff")
      .filter(q => q.eq(q.field("email"), email))
      .first();
    if (!staffMember) return null;
    if (staffMember.clerkUserId) return staffMember; // already linked
    await ctx.db.patch(staffMember._id, { clerkUserId });
    return { ...staffMember, clerkUserId };
  },
});















export const markAccepted = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const invite = await ctx.db.query("invites")
      .filter(q => q.eq(q.field("email"), email))
      .first();
    if (invite && invite.status !== "accepted") {
      await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: Date.now() });
    }
  },
});

export const linkClerkUserInternal = internalMutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (ctx, { clerkUserId, email }) => {
    const allStaff = await ctx.db.query("staff").collect();
    const staffMember = allStaff.find(s => s.email?.toLowerCase().trim() === email.toLowerCase().trim());
    if (!staffMember || staffMember.clerkUserId) return;
    await ctx.db.patch(staffMember._id, { clerkUserId });
  },
});


