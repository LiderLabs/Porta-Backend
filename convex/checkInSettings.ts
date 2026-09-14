import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) return null;
    return await ctx.db
      .query("checkInSettings")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
  },
});

export const save = mutation({
  args: {
    fields: v.array(
      v.object({
        key:     v.string(),
        label:   v.string(),
        type:    v.string(),
        enabled: v.boolean(),
        required:v.boolean(),
        custom:  v.optional(v.boolean()),
        options: v.optional(v.array(v.string())),
      })
    ),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const orgId = await resolveOrgId(ctx);
    if (!orgId) throw new Error("No orgId found");

    const existing = await ctx.db
      .query("checkInSettings")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        fields:    args.fields,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert("checkInSettings", {
        orgId,
        fields:    args.fields,
        updatedAt: args.updatedAt,
      });
    }
  },
});

