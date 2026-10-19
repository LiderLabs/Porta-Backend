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
    // legacy argument, ignored on purpose. Remove after the porta-app update ships.
    addedByClerkId: v.optional(v.string()),
    addedByName:    v.optional(v.string()),
  },
  handler: async (ctx, { fullName, email, phone, reason }) => {
    const { identity, orgId } = await requireAdminOrReceptionist(ctx);
    return await ctx.db.insert("blacklist", {
      fullName,
      email,
      phone,
      reason,
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

// Previously disabled: the original check query lacked organization scoping,
// which meant an email blacklisted in one organization would block that person
// across every other organization in the system.
// Now safely re-enabled: scoped to the caller's organization via requireAdminOrReceptionist,
// and correctly matches on either normalized email or digits-only phone.
export const check = query({
  args: { email: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, { email, phone }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const e = email?.toLowerCase().trim();
    const p = phone?.replace(/\D/g, "");
    if (!e && !p) return { blocked: false };
    const rows = await ctx.db.query("blacklist")
      .withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const hit = rows.find((r) => r.active && (
      (e && r.email?.toLowerCase().trim() === e) ||
      (p && r.phone?.replace(/\D/g, "") === p)));
    return hit ? { blocked: true, reason: hit.reason } : { blocked: false };
  },
});
