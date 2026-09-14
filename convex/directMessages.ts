import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  args: {
    fromClerkId: v.string(),
    fromName:    v.string(),
    fromRole:    v.string(),
    toClerkId:   v.string(),
    toName:      v.string(),
    message:     v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("directMessages", {
      ...args,
      read:      false,
      createdAt: Date.now(),
    });
  },
});

export const listConversation = query({
  args: { userAClerkId: v.string(), userBClerkId: v.string() },
  handler: async (ctx, { userAClerkId, userBClerkId }) => {
    const msgs = await ctx.db.query("directMessages").collect();
    return msgs
      .filter(m =>
        (m.fromClerkId === userAClerkId && m.toClerkId === userBClerkId) ||
        (m.fromClerkId === userBClerkId && m.toClerkId === userAClerkId)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const listThreads = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const msgs = await ctx.db.query("directMessages").collect();
    const mine = msgs.filter(m => m.fromClerkId === clerkUserId || m.toClerkId === clerkUserId);
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

export const unreadCount = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const msgs = await ctx.db.query("directMessages").collect();
    return msgs.filter(m => m.toClerkId === clerkUserId && !m.read).length;
  },
});

export const markRead = mutation({
  args: { toClerkId: v.string(), fromClerkId: v.string() },
  handler: async (ctx, { toClerkId, fromClerkId }) => {
    const msgs = await ctx.db.query("directMessages").collect();
    const unread = msgs.filter(m => m.toClerkId === toClerkId && m.fromClerkId === fromClerkId && !m.read);
    await Promise.all(unread.map(m => ctx.db.patch(m._id, { read: true })));
  },
});
