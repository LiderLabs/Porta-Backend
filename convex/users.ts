import { resolveOrgId } from "./getOrgId";
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSelf } from "./authHelpers";


export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("receptionist"), v.literal("employee"), v.literal("pa"), v.literal("dept_head"), v.literal("superadmin")),
    imageUrl: v.optional(v.string()),
    orgId: v.optional(v.string()),
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
        ...(args.orgId !== undefined ? { orgId: args.orgId } : {}),
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
 * Falls back to [] when no orgId can be resolved.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return [];
    const directUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    if (directUsers.length > 0) return directUsers;

    // Fallback: look up users corresponding to staff in this org
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const clerkIds = staff.map((s) => s.clerkUserId).filter(Boolean) as string[];
    if (clerkIds.length === 0) return [];

    const matchedUsers: Array<any> = [];
    for (const cid of clerkIds) {
      const u = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", cid))
        .unique();
      if (u) matchedUsers.push(u);
    }
    return matchedUsers;
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

    const staffMembers = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const seenClerkIds = new Set<string>();
    const results: Array<{
      clerkUserId: string;
      name: string;
      role: string;
      department: string;
      imageUrl?: string;
    }> = [];

    for (const s of staffMembers) {
      if (s.status !== "inactive" && s.clerkUserId && s.clerkUserId !== excludeClerkId && !seenClerkIds.has(s.clerkUserId)) {
        seenClerkIds.add(s.clerkUserId);
        results.push({
          clerkUserId: s.clerkUserId,
          name: s.name,
          role: s.role ?? "employee",
          department: s.department ?? "",
          imageUrl: s.avatarUrl,
        });
      }
    }

    const orgUsers = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    for (const u of orgUsers) {
      if (u.clerkUserId !== excludeClerkId && !seenClerkIds.has(u.clerkUserId)) {
        seenClerkIds.add(u.clerkUserId);
        results.push({
          clerkUserId: u.clerkUserId,
          name: u.name,
          role: u.role,
          department: u.department ?? "",
          imageUrl: u.imageUrl,
        });
      }
    }

    return results;
  },
});

// createIfMissing was removed — it was a public, unauthenticated mutation that
// let anyone create a user record with role "pa" for any clerkUserId/email they
// chose. It was not called from porta-app, porta-booking, or porta-superadmin.
