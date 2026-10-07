import { resolveOrgId } from "./getOrgId";
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSelf } from "./authHelpers";

// ── internal (called from Clerk webhooks only) ──────────────────────────────

export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("receptionist"), v.literal("employee"), v.literal("pa"), v.literal("dept_head"), v.literal("superadmin")),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", args.clerkUserId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        email: args.email,
        role: args.role,
        imageUrl: args.imageUrl,
      });
    } else {
      await ctx.db.insert("users", {
        ...args,
        createdAt: Date.now(),
      });
    }
  },
});

export const deleteByClerkId = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (user) await ctx.db.delete(user._id);
  },
});

// ── public queries ───────────────────────────────────────────────────────────

/**
 * Returns the user record for `clerkUserId`.
 * The caller must BE that user — enforced via requireSelf.
 * (Same fix shape as staff.getByClerkId.)
 */
export const getByClerkId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    await requireSelf(ctx, clerkUserId);
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
  },
});

/**
 * Lists users scoped to the caller's org.
 * Falls back to [] (not everyone) when no orgId can be resolved.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    const all = await ctx.db.query("users").collect();
    return all.filter((u: any) => u.orgId === orgId);
  },
});

/**
 * Returns users in the same org for the messaging contact list,
 * excluding the caller themselves.
 * Falls back to [] when no orgId can be resolved.
 */
export const listForMessaging = query({
  args: { excludeClerkId: v.string() },
  handler: async (ctx, { excludeClerkId }) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    const all = await ctx.db.query("users").collect();
    return all
      .filter((u) => u.clerkUserId !== excludeClerkId && (u as any).orgId === orgId)
      .map((u) => ({
        clerkUserId: u.clerkUserId,
        name:        u.name,
        role:        u.role,
        department:  u.department ?? "",
        imageUrl:    u.imageUrl,
      }));
  },
});

// createIfMissing was removed — it was a public, unauthenticated mutation that
// let anyone create a user record with role "pa" for any clerkUserId/email they
// chose. It was not called from porta-app, porta-booking, or porta-superadmin.
