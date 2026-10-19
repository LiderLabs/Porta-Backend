import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireSelf } from "./authHelpers";

/**
 * Send a direct message.
 * fromClerkId, fromName and fromRole are derived from the authenticated
 * session + the caller's own staff/user record — never trusted from the
 * client. Removed args: fromClerkId, fromName, fromRole.
 */
export const send = mutation({
  args: {
    toClerkId: v.string(),
    toName:    v.string(),
    message:   v.string(),
  },
  handler: async (ctx, { toClerkId, toName, message }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Resolve sender's own name and role from their staff or user record.
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

    const fromClerkId = identity.subject;
    const fromName    = staff?.name ?? user?.name ?? (identity.name as string) ?? identity.email ?? "Unknown";
    const fromRole    = staff?.role ?? user?.role ?? "unknown";

    return await ctx.db.insert("directMessages", {
      fromClerkId,
      fromName,
      fromRole,
      toClerkId,
      toName,
      message,
      read:      false,
      createdAt: Date.now(),
    });
  },
});

/**
 * Read a conversation between two people.
 * The caller must be one of the two participants.
 */
export const listConversation = query({
  args: { userAClerkId: v.string(), userBClerkId: v.string() },
  handler: async (ctx, { userAClerkId, userBClerkId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (identity.subject !== userAClerkId && identity.subject !== userBClerkId) {
      throw new Error("Not authorized");
    }

    const msgs = await ctx.db.query("directMessages").collect();
    return msgs
      .filter(
        (m) =>
          (m.fromClerkId === userAClerkId && m.toClerkId === userBClerkId) ||
          (m.fromClerkId === userBClerkId && m.toClerkId === userAClerkId)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * List all conversation threads for a user.
 * Caller must be that user.
 */
export const listThreads = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    await requireSelf(ctx, clerkUserId);

    const msgs = await ctx.db.query("directMessages").collect();
    const mine = msgs.filter((m) => m.fromClerkId === clerkUserId || m.toClerkId === clerkUserId);
    const threads: Record<string, any> = {};
    for (const m of mine) {
      const otherId   = m.fromClerkId === clerkUserId ? m.toClerkId   : m.fromClerkId;
      const otherName = m.fromClerkId === clerkUserId ? m.toName      : m.fromName;
      const otherRole = m.fromClerkId === clerkUserId ? m.fromRole    : m.fromRole;
      if (!threads[otherId] || m.createdAt > threads[otherId].lastAt) {
        threads[otherId] = { otherId, otherName, otherRole, lastMessage: m.message, lastAt: m.createdAt, unread: 0 };
      }
      if (m.toClerkId === clerkUserId && !m.read) {
        threads[otherId].unread = (threads[otherId].unread ?? 0) + 1;
      }
    }
    return Object.values(threads).sort((a: any, b: any) => b.lastAt - a.lastAt);
  },
});

/**
 * Unread message count for a user.
 * Caller must be that user.
 */
export const unreadCount = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    await requireSelf(ctx, clerkUserId);
    const msgs = await ctx.db.query("directMessages").collect();
    return msgs.filter((m) => m.toClerkId === clerkUserId && !m.read).length;
  },
});

/**
 * Mark messages from a specific sender as read.
 * Caller must be the recipient (toClerkId) — you can only mark messages
 * sent to yourself, never to someone else.
 */
export const markRead = mutation({
  args: { toClerkId: v.string(), fromClerkId: v.string() },
  handler: async (ctx, { toClerkId, fromClerkId }) => {
    await requireSelf(ctx, toClerkId);
    const msgs = await ctx.db.query("directMessages").collect();
    const unread = msgs.filter(
      (m) => m.toClerkId === toClerkId && m.fromClerkId === fromClerkId && !m.read
    );
    await Promise.all(unread.map((m) => ctx.db.patch(m._id, { read: true })));
  },
});
