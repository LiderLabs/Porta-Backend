import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const fixName = internalMutation({
  args: { clerkUserId: v.string(), name: v.string() },
  handler: async (ctx, { clerkUserId, name }) => {
    const rec = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .unique();
    if (rec) await ctx.db.patch(rec._id, { name });
    return rec ? "done" : "not found";
  },
});