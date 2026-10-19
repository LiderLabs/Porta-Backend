import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSelf } from "./authHelpers";

// push and markRead removed — both were public with no auth, and neither is
// called from any frontend or backend code. push was a fake-notification
// vector; markRead is subsumed by markAllRead below.

/**
 * List the 20 most-recent notifications for a user.
 * Caller must be that user.
 */
export const listForUser = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    await requireSelf(ctx, clerkUserId);
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("clerkUserId", clerkUserId))
      .order("desc")
      .take(20);
  },
});

/**
 * Mark all of a user's notifications as read.
 * Caller must be that user.
 */
export const markAllRead = mutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    await requireSelf(ctx, clerkUserId);
    const notifs = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("clerkUserId", clerkUserId))
      .collect();
    await Promise.all(notifs.filter((n) => !n.read).map((n) => ctx.db.patch(n._id, { read: true })));
  },
});
