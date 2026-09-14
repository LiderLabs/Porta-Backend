import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByVisit = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    return await ctx.db
      .query("visitMessages")
      .withIndex("by_visit", (q) => q.eq("visitId", visitId))
      .order("asc")
      .collect();
  },
});

export const send = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    senderClerkId: v.string(),
    senderName: v.string(),
    senderRole: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("visitMessages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { messageId: v.id("visitMessages") },
  handler: async (ctx, { messageId }) => {
    await ctx.db.delete(messageId);
  },
});
