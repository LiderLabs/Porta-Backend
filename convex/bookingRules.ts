import { resolveOrgId } from "./getOrgId";
﻿import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
const DEFAULTS = {
  approvalRequired:  true,
  maxVisitorsPerDay: 50,
  walkInEnabled:     true,
  idRequired:        false,
  photoRequired:     false,
  qrCheckInEnabled:  false,
  whatsappEnabled:   false,
  minNoticeHours:    1,
  maxAdvanceDays:    30,
  blacklistEnabled:  true,
  allowedPurposes:   ["Meeting","Interview","Delivery","Consultation","Site visit","Other"],
  defaultDuration:   60,
  allowedDurations:  [30, 60, 90, 120],
  minDuration:       30,
  maxDuration:       120,
};
export const get = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const all = await ctx.db.query("bookingRules").collect();
    if (!orgId) return DEFAULTS;
    const rule = all.find((r: any) => r.orgId === orgId);
    return rule ?? DEFAULTS;
  },
});
export const save = mutation({
  args: {
    approvalRequired:    v.boolean(),
    maxVisitorsPerDay:   v.optional(v.number()),
    walkInEnabled:       v.boolean(),
    idRequired:          v.boolean(),
    photoRequired:       v.boolean(),
    qrCheckInEnabled:    v.boolean(),
    whatsappEnabled:     v.boolean(),
    minNoticeHours:      v.optional(v.number()),
    maxAdvanceDays:      v.optional(v.number()),
    allowedPurposes:     v.optional(v.array(v.string())),
    blacklistEnabled:    v.boolean(),
    defaultDuration:     v.optional(v.number()),
    allowedDurations:    v.optional(v.array(v.number())),
    minDuration:         v.optional(v.number()),
    maxDuration:         v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await resolveOrgId(ctx);
    const existing = orgId ? (await ctx.db.query("bookingRules").collect()).find((r: any) => r.orgId === orgId) : await ctx.db.query("bookingRules").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("bookingRules", { ...args, orgId: orgId ?? undefined, updatedAt: Date.now() });
    }
  },
});

