import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./authHelpers";

/** Booking activity for the admin's own organisation, newest first. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db
      .query("activityLog")
      .withIndex("by_org_createdAt", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 200, 1), 500));
  },
});
