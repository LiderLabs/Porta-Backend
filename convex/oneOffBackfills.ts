// TEMPORARY — delete after production backfills are confirmed complete.
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const backfillVisitorsOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Only fall back to "the one org" if exactly one org exists.
    const orgs = await ctx.db.query("organizations").take(2);
    const onlyOrg = orgs.length === 1 ? (orgs[0]._id as string) : undefined;

    const page = await ctx.db.query("visitors")
      .paginate({ numItems: 200, cursor: cursor ?? null });
    let fixed = 0, unresolved = 0;
    for (const row of page.page) {
      if (row.orgId) continue;
      let orgId = onlyOrg;
      if (row.hostId) {
        const host = await ctx.db.get(row.hostId);
        if (host?.orgId) orgId = host.orgId;
      }
      if (!orgId) { unresolved++; continue; }   // never guess
      await ctx.db.patch(row._id, { orgId });
      fixed++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0,
        internal.oneOffBackfills.backfillVisitorsOrgId,
        { cursor: page.continueCursor });
    }
    return { fixed, unresolved, done: page.isDone };
  },
});

export const backfillBlacklistOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Only fall back to "the one org" if exactly one org exists.
    const orgs = await ctx.db.query("organizations").take(2);
    const onlyOrg = orgs.length === 1 ? (orgs[0]._id as string) : undefined;

    const page = await ctx.db.query("blacklist")
      .paginate({ numItems: 200, cursor: cursor ?? null });
    let fixed = 0, unresolved = 0;
    for (const row of page.page) {
      if (row.orgId) continue;
      let orgId = onlyOrg;
      if (row.addedByClerkId) {
        const staff = await ctx.db
          .query("staff")
          .filter((q) => q.eq(q.field("clerkUserId"), row.addedByClerkId))
          .first();
        if (staff?.orgId) orgId = staff.orgId;
      }
      if (!orgId) { unresolved++; continue; }   // never guess
      await ctx.db.patch(row._id, { orgId });
      fixed++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0,
        internal.oneOffBackfills.backfillBlacklistOrgId,
        { cursor: page.continueCursor });
    }
    return { fixed, unresolved, done: page.isDone };
  },
});

export const countMissingOrgId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const visitors = await ctx.db.query("visitors").collect();
    const blacklist = await ctx.db.query("blacklist").collect();
    return {
      visitorsWithoutOrg: visitors.filter((v) => !v.orgId).length,
      blacklistWithoutOrg: blacklist.filter((b) => !b.orgId).length,
    };
  },
});
