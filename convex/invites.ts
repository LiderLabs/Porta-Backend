import { resolveOrgId } from "./getOrgId";
import { query, mutation, action, internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin, assertSameOrg } from "./authHelpers";

const STAFF_ROLES = ["receptionist", "employee", "dept_head", "pa"] as const;
const ADMIN_ROLES = ["admin"] as const;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    return await ctx.db
      .query("invites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
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

export const create = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("admin"), v.literal("receptionist"),
      v.literal("employee"), v.literal("dept_head"), v.literal("pa"),
      v.literal("superadmin")
    ),
    department: v.optional(v.string()),
    invitedByClerkId: v.string(),
    invitedByName: v.string(),
    clerkInviteId: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return await ctx.db.insert("invites", {
      ...args,
      email: args.email.toLowerCase().trim(),
      token,
      status: "pending",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
  },
});

export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const { orgId } = await requireAdmin(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) throw new Error("Invite not found");
    assertSameOrg(orgId, invite.orgId);

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
    if (!invite) throw new Error("Invalid invite");
    if (invite.status !== "pending") throw new Error("Invite already used or revoked");
    if (invite.expiresAt < Date.now()) throw new Error("Invite expired");
    await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: Date.now() });
    return invite;
  },
});

export const sendInvite = action({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("admin"), v.literal("receptionist"),
      v.literal("employee"), v.literal("dept_head"), v.literal("pa")
    ),
    department: v.optional(v.string()),
    invitedByClerkId: v.optional(v.string()),
    invitedByName: v.optional(v.string()),
    whatsappNumber: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    // The inviter and the organisation come from the signed-in admin, not from the request.
    // The admin screen no longer sends the inviter, which is what made every invite fail.
    if (args.orgId && args.orgId !== admin.orgId) {
      throw new ConvexError("You can only invite people to your own organisation");
    }
    const orgId = admin.orgId;
    const invitedByClerkId = admin.identity.subject;
    const invitedByName = admin.staff?.name ?? admin.identity.name ?? "Admin";
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    const normalizedEmail = args.email.toLowerCase().trim();
    const isAdminRole = (args.role as string) === "admin";
    const redirectUrl = isAdminRole
      ? (process.env.ADMIN_APP_URL ?? "http://localhost:5176") + "/sign-up"
      : (process.env.STAFF_APP_URL ?? "http://localhost:5174") + "/sign-up";

    const res = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + clerkSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: normalizedEmail,
        public_metadata: {
          role: args.role,
          department: args.department ?? null,
          orgId: orgId ?? null,
        },
        notify: true,
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
      if (msg.toLowerCase().includes("duplicate")) throw new ConvexError("An invite was already sent to this email. Please revoke the existing invite first.");
      throw new ConvexError(msg);
    }

    // Create the staff record now – clerkUserId will be linked when they
    // first log in via linkClerkUserInternal mutation
    await ctx.runMutation(internal.staff.createWithRole, {
      name: args.name,
      email: normalizedEmail,
      department: args.department,
      role: args.role,
      status: "active",
      phone: args.whatsappNumber?.trim() || undefined,
      orgId,
    });

    // Record invite
    const inviteId: string = await ctx.runMutation(internal.invites.create, {
      name: args.name,
      email: normalizedEmail,
      role: args.role,
      department: args.department,
      invitedByClerkId,
      invitedByName,
      orgId,
      clerkInviteId,
    });

    return { success: true, inviteId };
  },
});

export const markAccepted = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.toLowerCase().trim();
    await acceptPendingInvites(ctx, normalized);
  },
});

// Closes every pending invite for an email. The old code only looked at the first invite found,
// so a person invited twice kept a pending invite forever.
async function acceptPendingInvites(ctx: MutationCtx, email: string) {
  const rows = await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect();
  for (const r of rows) {
    if (r.status === "pending") await ctx.db.patch(r._id, { status: "accepted", acceptedAt: Date.now() });
  }
}

// One-off cleanup for invites left pending for people who already signed up. After deploying, run
// invites:reconcileAcceptedInvites from the Convex dashboard (Functions, Run function).
export const reconcileAcceptedInvites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db.query("invites").withIndex("by_status", (q) => q.eq("status", "pending")).collect();
    let closed = 0;
    for (const inv of pending) {
      const signedUp = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", inv.email)).first();
      if (!signedUp) continue;
      await ctx.db.patch(inv._id, { status: "accepted", acceptedAt: Date.now() });
      const rows = await ctx.db.query("staff").withIndex("by_email", (q) => q.eq("email", inv.email)).collect();
      const waiting = rows.find((s) => !s.clerkUserId);
      if (waiting) await ctx.db.patch(waiting._id, { clerkUserId: signedUp.clerkUserId });
      closed++;
    }
    return { closed };
  },
});

// Called by the app right after sign-in. Links the person's login to the staff record made when
// they were invited, so they do not depend on the Clerk webhook arriving.
export const linkMe = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { linked: false };
    // Signing in proves the invite was accepted, so close any invite still marked pending.
    // The dashboard counted these as "pending invites" for people who were already logged in.
    const verified = !!identity.email && identity.emailVerified === true;
    const email = verified ? identity.email!.toLowerCase().trim() : "";
    if (email) await acceptPendingInvites(ctx, email);
    const already = await ctx.db.query("staff").withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject)).first();
    if (already) return { linked: true };
    if (!email) return { linked: false };
    const candidates = await ctx.db.query("staff").withIndex("by_email", (q) => q.eq("email", email)).collect();
    const target = candidates.find((s) => !s.clerkUserId && s.status !== "inactive");
    if (!target) return { linked: false };
    await ctx.db.patch(target._id, { clerkUserId: identity.subject });
    return { linked: true };
  },
});

export const linkClerkUserInternal = internalMutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (ctx, { clerkUserId, email }) => {
    const staffMember = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase().trim()))
      .first();
    if (!staffMember || staffMember.clerkUserId) return;
    await ctx.db.patch(staffMember._id, { clerkUserId });
  },
});