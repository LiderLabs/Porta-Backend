import { resolveOrgId } from "./getOrgId";
﻿import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("receptionist"), v.literal("employee"), v.literal("pa"), v.literal("dept_head"), v.literal("superadmin")),
    imageUrl: v.optional(v.string()),
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

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("users").collect();
    return orgId ? all.filter((u: any) => u.orgId === orgId) : all;
  },
});

export const getByClerkId = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
  },
});
export const listForMessaging = query({
  args: { excludeClerkId: v.string() },
  handler: async (ctx, { excludeClerkId }) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("users").collect();
    return all
      .filter((u) => u.clerkUserId !== excludeClerkId && (!orgId || (u as any).orgId === orgId))
      .map((u) => ({
        clerkUserId: u.clerkUserId,
        name:        u.name,
        role:        u.role,
        department:  u.department ?? "",
        imageUrl:    u.imageUrl,
      }));
  },
});


import { mutation } from "./_generated/server";
export const createIfMissing = mutation({
  args: { clerkUserId: v.string(), name: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkUserId", args.clerkUserId)).unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", { ...args, role: "pa", createdAt: Date.now() });
  },
});
