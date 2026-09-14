import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const ONLINE_THRESHOLD_MS = 60 * 1000; // 60 seconds

export const update = mutation({
  args: {
    clerkUserId: v.string(),
    isTypingTo:  v.optional(v.string()),
  },
  handler: async (ctx, { clerkUserId, isTypingTo }) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_clerk", q => q.eq("clerkUserId", clerkUserId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: Date.now(), isTypingTo: isTypingTo ?? null });
    } else {
      await ctx.db.insert("presence", { clerkUserId, lastSeen: Date.now(), isTypingTo: isTypingTo ?? null });
    }
  },
});

export const getOnline = query({
  args: { clerkUserIds: v.array(v.string()) },
  handler: async (ctx, { clerkUserIds }) => {
    const threshold = Date.now() - ONLINE_THRESHOLD_MS;
    const result: Record<string, boolean> = {};
    for (const id of clerkUserIds) {
      const p = await ctx.db
        .query("presence")
        .withIndex("by_clerk", q => q.eq("clerkUserId", id))
        .first();
      result[id] = p ? p.lastSeen >= threshold : false;
    }
    return result;
  },
});

export const getTyping = query({
  args: { toClerkId: v.string() },
  handler: async (ctx, { toClerkId }) => {
    const threshold = Date.now() - ONLINE_THRESHOLD_MS;
    const all = await ctx.db.query("presence").collect();
    return all
      .filter(p => p.isTypingTo === toClerkId && p.lastSeen >= threshold)
      .map(p => p.clerkUserId);
  },
});
