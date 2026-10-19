import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveOrgId } from "./getOrgId";
import { requireAdminOrReceptionist, assertSameOrg } from "./authHelpers";

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
    fullName: v.optional(v.string()),
    email:    v.optional(v.string()),
    phone:    v.optional(v.string()),
    reason:   v.string(),
  },
  handler: async (ctx, args) => {
    const { identity, orgId } = await requireAdminOrReceptionist(ctx);
    return await ctx.db.insert("blacklist", {
      ...args,
      orgId,
      addedByClerkId: identity.subject,
      addedByName: (identity.name as string) ?? identity.email ?? "Unknown",
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { blacklistId: v.id("blacklist") },
  handler: async (ctx, { blacklistId }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const record = await ctx.db.get(blacklistId);
    if (!record) throw new Error("Blacklist entry not found");
    assertSameOrg(orgId, record.orgId);

    await ctx.db.patch(blacklistId, { active: false });
  },
});

export const check = query({
  args: { email: v.optional(v.string()), phone: v.optional(v.string()) },
  // TEMP: real logic disabled during rollout — re-enable once backfill is verified in prod.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handler: async (_ctx, _args) => {
    // Real logic (re-enable after prod backfill is confirmed):
    // if (email) {
    //   const hit = await ctx.db.query("blacklist").withIndex("by_email", q => q.eq("email", email)).first();
    //   if (hit?.active) return { blocked: true, reason: hit.reason };
    // }
    return { blocked: false };
  },
});
