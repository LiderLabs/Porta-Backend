import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authHelpers";

/**
 * List messages for a visit. Requires the caller to be logged in.
 * We do NOT yet verify that the caller is a participant in the visit —
 * that check is a TODO and is noted in the PR. "Logged in" is sufficient
 * for now to prevent completely unauthenticated reads.
 */
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

/**
 * Send a message in a visit chat.
 * Sender identity (clerkId, name, role) is derived from the authenticated
 * session — never trusted from the client. Removed args: senderClerkId,
 * senderName, senderRole.
 */
export const send = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    message: v.string(),
  },
  handler: async (ctx, { visitId, message }) => {
    // requireAdmin also gives us identity + role from the staff record,
    // mirroring the same lookup pattern used everywhere else in the codebase.
    const { identity, role, staff } = await requireAdmin(ctx);
    const senderClerkId = identity.subject;
    const senderName    = staff?.name ?? (identity.name as string) ?? identity.email ?? "Unknown";
    const senderRole    = role ?? "unknown";

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

/**
 * Delete a visit message.
 * Not yet called from any frontend; requireAdmin gates the door
 * before it is ever wired up.
 */
export const remove = mutation({
  args: { messageId: v.id("visitMessages") },
  handler: async (ctx, { messageId }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(messageId);
  },
});
