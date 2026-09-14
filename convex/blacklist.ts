import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("blacklist").withIndex("by_active", q => q.eq("active", true)).collect();
    if (!orgId) return [];
    return all.filter((i: any) => i.orgId === orgId);
  },
});

export const add = mutation({
  args: {
    fullName:       v.optional(v.string()),
    email:          v.optional(v.string()),
    phone:          v.optional(v.string()),
    reason:         v.string(),
    addedByClerkId: v.string(),
    addedByName:    v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("blacklist", { ...args, active: true, createdAt: Date.now() });
  },
});

export const remove = mutation({
  args: { blacklistId: v.id("blacklist") },
  handler: async (ctx, { blacklistId }) => {
    await ctx.db.patch(blacklistId, { active: false });
  },
});

export const check = query({
  args: { email: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, { email, phone }) => {
    if (email) {
      const hit = await ctx.db.query("blacklist").withIndex("by_email", q => q.eq("email", email)).first();
      if (hit?.active) return { blocked: true, reason: hit.reason };
    }
    return { blocked: false };
  },
});

