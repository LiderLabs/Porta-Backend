import { query, mutation } from "./_generated/server";
import { resolveOrgId } from "./getOrgId";
import { v } from "convex/values";

const DEFAULTS = {
  features: {
    checkInEnabled:       true,
    badgesEnabled:        true,
    schedulingEnabled:    true,
    messagingEnabled:     true,
    analyticsEnabled:     true,
    notificationsEnabled: true,
    attendanceEnabled:    false,
    multiLocationEnabled: false,
  },
  branding: {
    primaryColor: "#45ba50",
    logoUrl: "",
    appName: "Porta",
  },
};

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const orgId = await resolveOrgId(ctx);
    const s = await ctx.db.query("orgSettings").first();
    const base = s ? s : { ...DEFAULTS, _id: null };
    if (orgId) {
      try {
        const org = await ctx.db.get(orgId as any);
        if (org) {
          return {
            ...base,
            branding: {
              ...(base as any).branding,
              appName: (org as any).name,
              logoUrl: (org as any).logoUrl ?? (base as any).branding?.logoUrl ?? "",
            },
          };
        }
      } catch {}
    }
    return base;
  },
});

export const save = mutation({
  args: {
    features: v.object({
      checkInEnabled:       v.boolean(),
      badgesEnabled:        v.boolean(),
      schedulingEnabled:    v.boolean(),
      messagingEnabled:     v.boolean(),
      analyticsEnabled:     v.boolean(),
      notificationsEnabled: v.boolean(),
      attendanceEnabled:    v.boolean(),
      multiLocationEnabled: v.boolean(),
    }),
    branding: v.optional(v.object({
      primaryColor: v.optional(v.string()),
      logoUrl:      v.optional(v.string()),
      appName:      v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("orgSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("orgSettings", { ...args, updatedAt: Date.now() });
    }
  },
});

export const getMyOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const email = identity.email ?? (identity as any).emailAddress ?? "";
    let orgId = await resolveOrgId(ctx);

    if (!orgId) return null;
    try {
      const org = await ctx.db.get(orgId as any);
      if (!org) return null;
      return { name: (org as any).name, logoUrl: (org as any).logoUrl, slug: (org as any).slug };
    } catch { return null; }
  },
});

/** Public config for the booking page - no auth required. */
export const getPublicConfig = query({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    // Get org by slug if provided, otherwise first org
    const org = slug
      ? await ctx.db.query("organizations").withIndex("by_slug", q => q.eq("slug", slug)).first()
      : await ctx.db.query("organizations").first();
    if (!org) return null;

    const settings = await ctx.db.query("orgSettings").first();
    const rules    = await ctx.db.query("bookingRules").first();
    const staff    = await ctx.db.query("staff").collect();

    return {
      org: {
        name:         org.name,
        slug:         org.slug,
        logoUrl:      org.logoUrl ?? null,
      },
      branding: {
        primaryColor: settings?.branding?.primaryColor ?? "#45ba50",
        appName:      settings?.branding?.appName ?? org.name,
        logoUrl:      settings?.branding?.logoUrl ?? org.logoUrl ?? null,
      },
      rules: {
        approvalRequired:  rules?.approvalRequired  ?? true,
        allowedPurposes:   rules?.allowedPurposes   ?? ["Meeting","Interview","Delivery","Consultation","Site visit","Other"],
        allowedDurations:  rules?.allowedDurations  ?? [30,60,90,120],
        defaultDuration:   rules?.defaultDuration   ?? 60,
        minNoticeHours:    rules?.minNoticeHours     ?? 1,
        maxAdvanceDays:    rules?.maxAdvanceDays     ?? 30,
        walkInEnabled:     rules?.walkInEnabled      ?? true,
        phoneRequired:     rules?.phoneRequired     ?? false,
        emailRequired:     rules?.emailRequired     ?? false,
        companyRequired:   rules?.companyRequired   ?? false,
        purposeRequired:   rules?.purposeRequired   ?? false,
      },
      staff: staff
        .filter(s => s.status !== "inactive")
        .map(s => ({
          _id:          s._id,
          name:         s.name,
          department:   s.department ?? null,
          title:        s.title ?? null,
          availability: s.availability ?? "available",
        })),
    };
  },
});








