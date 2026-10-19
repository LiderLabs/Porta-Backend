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
      const needsEmailLower = row.email && row.email !== row.email.toLowerCase().trim();
      const needsOrg = !row.orgId;
      if (!needsOrg && !needsEmailLower) continue;

      let orgId = row.orgId ?? onlyOrg;
      if (!orgId && row.addedByClerkId) {
        const staff = await ctx.db
          .query("staff")
          .filter((q) => q.eq(q.field("clerkUserId"), row.addedByClerkId))
          .first();
        if (staff?.orgId) orgId = staff.orgId;
      }

      if (needsOrg && !orgId) { unresolved++; continue; } // never guess

      const patch: Record<string, any> = {};
      if (needsOrg && orgId) patch.orgId = orgId;
      if (needsEmailLower) patch.email = row.email!.toLowerCase().trim();

      await ctx.db.patch(row._id, patch);
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

export const backfillStaffOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const orgs = await ctx.db.query("organizations").take(2);
    const onlyOrg = orgs.length === 1 ? (orgs[0]._id as string) : undefined;

    const page = await ctx.db.query("staff")
      .paginate({ numItems: 200, cursor: cursor ?? null });
    let fixed = 0, unresolved = 0;
    for (const row of page.page) {
      const needsEmailLower = row.email && row.email !== row.email.toLowerCase().trim();
      const needsOrg = !row.orgId;
      if (!needsOrg && !needsEmailLower) continue;

      let orgId = row.orgId ?? onlyOrg;
      if (!orgId && row.clerkUserId) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", row.clerkUserId!))
          .unique();
        if ((user as any)?.orgId) orgId = (user as any).orgId;
      }

      if (needsOrg && !orgId) { unresolved++; continue; } // never guess

      const patch: Record<string, any> = {};
      if (needsOrg && orgId) patch.orgId = orgId;
      if (needsEmailLower) patch.email = row.email!.toLowerCase().trim();

      await ctx.db.patch(row._id, patch);
      fixed++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0,
        internal.oneOffBackfills.backfillStaffOrgId,
        { cursor: page.continueCursor });
    }
    return { fixed, unresolved, done: page.isDone };
  },
});

export const backfillInvitesOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const orgs = await ctx.db.query("organizations").take(2);
    const onlyOrg = orgs.length === 1 ? (orgs[0]._id as string) : undefined;

    const page = await ctx.db.query("invites")
      .paginate({ numItems: 200, cursor: cursor ?? null });
    let fixed = 0, unresolved = 0;
    for (const row of page.page) {
      const needsEmailLower = row.email && row.email !== row.email.toLowerCase().trim();
      const needsOrg = !row.orgId;
      if (!needsOrg && !needsEmailLower) continue;

      let orgId = row.orgId ?? onlyOrg;
      if (!orgId && row.invitedByClerkId) {
        const inviter = await ctx.db
          .query("staff")
          .filter((q) => q.eq(q.field("clerkUserId"), row.invitedByClerkId))
          .first();
        if (inviter?.orgId) orgId = inviter.orgId;
      }

      if (needsOrg && !orgId) { unresolved++; continue; } // never guess

      const patch: Record<string, any> = {};
      if (needsOrg && orgId) patch.orgId = orgId;
      if (needsEmailLower) patch.email = row.email.toLowerCase().trim();

      await ctx.db.patch(row._id, patch);
      fixed++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0,
        internal.oneOffBackfills.backfillInvitesOrgId,
        { cursor: page.continueCursor });
    }
    return { fixed, unresolved, done: page.isDone };
  },
});

export const backfillScheduledVisitsOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Only fall back to "the one org" if exactly one org exists.
    const orgs = await ctx.db.query("organizations").take(2);
    const onlyOrg = orgs.length === 1 ? (orgs[0]._id as string) : undefined;

    const page = await ctx.db.query("scheduledVisits")
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
        internal.oneOffBackfills.backfillScheduledVisitsOrgId,
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
    const staff = await ctx.db.query("staff").collect();
    const invites = await ctx.db.query("invites").collect();
    const scheduledVisits = await ctx.db.query("scheduledVisits").collect();

    return {
      visitorsWithoutOrg: visitors.filter((v) => !v.orgId).length,
      blacklistWithoutOrg: blacklist.filter((b) => !b.orgId).length,
      staffWithoutOrg: staff.filter((s) => !s.orgId).length,
      invitesWithoutOrg: invites.filter((i) => !i.orgId).length,
      scheduledVisitsWithoutOrg: scheduledVisits.filter((s) => !s.orgId).length,
      staffUnnormalizedEmails: staff.filter((s) => s.email && s.email !== s.email.toLowerCase().trim()).length,
      invitesUnnormalizedEmails: invites.filter((i) => i.email !== i.email.toLowerCase().trim()).length,
    };
  },
});
