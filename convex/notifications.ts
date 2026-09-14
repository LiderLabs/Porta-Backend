import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const push = mutation({
  args: {
    clerkUserId: v.string(),
    type: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      ...args,
      read: false,
      createdAt: Date.now(),
    });
  },
});

export const listForUser = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("clerkUserId", clerkUserId))
      .order("desc")
      .take(20);
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    await ctx.db.patch(notificationId, { read: true });
  },
});

export const markAllRead = mutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const notifs = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("clerkUserId", clerkUserId))
      .collect();
    await Promise.all(notifs.filter(n => !n.read).map(n => ctx.db.patch(n._id, { read: true })));
  },
});
