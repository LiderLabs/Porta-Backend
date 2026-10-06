import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authHelpers";

export const listByVisit = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
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
    message: v.string(),
  },
  handler: async (ctx, { visitId, message }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const staff = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), identity.subject))
      .first();
    const user = !staff
      ? await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
        .unique()
      : null;

    const senderClerkId = identity.subject;
    const senderName = staff?.name ?? user?.name ?? (identity.name as string) ?? identity.email ?? "Unknown";
    const senderRole = staff?.role ?? user?.role ?? "unknown";

    return await ctx.db.insert("visitMessages", {
      visitId,
      senderClerkId,
      senderName,
      senderRole,
      message,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { messageId: v.id("visitMessages") },
  handler: async (ctx, { messageId }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(messageId);
  },
});
