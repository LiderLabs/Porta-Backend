import { resolveOrgId } from "./getOrgId";
﻿import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_FIELDS = [
  { key: "fullName", label: "Full name", type: "text", enabled: true, required: true },
  { key: "phone", label: "Phone", type: "text", enabled: true, required: false },
  { key: "email", label: "Email", type: "email", enabled: true, required: false },
  { key: "company", label: "Company", type: "text", enabled: true, required: false },
  { key: "purpose", label: "Purpose", type: "select", enabled: true, required: false },
  { key: "hostId", label: "Host", type: "select", enabled: true, required: false },
  { key: "idType", label: "ID type", type: "text", enabled: false, required: false },
  { key: "idNumber", label: "ID number", type: "text", enabled: false, required: false },
];

export const getCheckInSettings = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const settings = orgId ? (await ctx.db.query("checkInSettings").collect()).find((s: any) => s.orgId === orgId) : await ctx.db.query("checkInSettings").first();
    if (settings) return { fields: settings.fields, saved: true };
    return { fields: DEFAULT_FIELDS, saved: false };
  },
});
export const saveCheckInSettings = mutation({
  args: {
    fields: v.array(v.object({
      key: v.string(),
      label: v.string(),
      type: v.string(),
      enabled: v.boolean(),
      required: v.boolean(),
      custom: v.optional(v.boolean()),
      options: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, { fields }) => {
    const existing = await ctx.db.query("checkInSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { fields, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("checkInSettings", { fields, updatedAt: Date.now() });
    }
  },
});

export const getBadgeSettings = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const settings = orgId ? (await ctx.db.query("badgeSettings").collect()).find((s: any) => s.orgId === orgId) : await ctx.db.query("badgeSettings").first();
    return settings ?? { enabled: false, format: "pdf" as const, autoSend: false, deliveryMethods: [] };
  },
});

export const saveBadgeSettings = mutation({
  args: {
    enabled: v.boolean(),
    format: v.union(v.literal("pdf"), v.literal("image")),
    autoSend: v.boolean(),
    deliveryMethods: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("badgeSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("badgeSettings", { ...args, updatedAt: Date.now() });
    }
  },
});
