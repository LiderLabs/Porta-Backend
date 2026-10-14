import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { query, mutation, action, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { requireSuperadmin } from "./authHelpers";

const DEFAULT_FEATURES = {
  checkInEnabled: true,
  badgesEnabled: false,
  schedulingEnabled: true,
  messagingEnabled: true,
  analyticsEnabled: true,
  notificationsEnabled: true,
  attendanceEnabled: false,
  multiLocationEnabled: false,
  apiAccessEnabled: false,
  ssoEnabled: false,
  whitelabelEnabled: false,
  dedicatedSupportEnabled: false,
};

export const listOrgs = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const orgs = await ctx.db.query("organizations").order("desc").collect();
    const staff = await ctx.db.query("staff").collect();
    return orgs.map(org => ({
      ...org,
      userCount: staff.filter(s => s.orgId === org._id).length,
    }));
  },
});

export const platformStats = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const orgs = await ctx.db.query("organizations").collect();
    const users = await ctx.db.query("users").collect();
    const visitors = await ctx.db.query("visitors").collect();
    const visits = await ctx.db.query("scheduledVisits").collect();

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const activeOrgs = orgs.filter(o => o.status === "active").length;
    const blockedOrgs = orgs.filter(o => o.status === "blocked").length;
    const trialOrgs = orgs.filter(o => o.status === "trial").length;
    const proOrgs = orgs.filter(o => o.plan === "pro").length;
    const enterpriseOrgs = orgs.filter(o => o.plan === "enterprise").length;
    const weekVisitors = visitors.filter(v => v.checkInTime >= sevenDaysAgo).length;

    const daily: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      daily[d.toLocaleDateString("en-US", { month: "short", day: "numeric" })] = 0;
    }
    visitors.forEach(v => {
      const key = new Date(v.checkInTime).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (key in daily) daily[key]++;
    });

    const byPlan: Record<string, number> = { free: 0, pro: 0, enterprise: 0, custom: 0 };
    orgs.forEach(o => { byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1; });

    return {
      totalOrgs: orgs.length,
      activeOrgs, blockedOrgs, trialOrgs, proOrgs, enterpriseOrgs,
      totalUsers: users.length,
      totalVisitors: visitors.length,
      weekVisitors,
      totalScheduled: visits.length,
      newOrgs30d: orgs.filter(o => o.createdAt >= thirtyDaysAgo).length,
      byPlan,
      dailyVisitors: Object.entries(daily).map(([label, count]) => ({ label, count })),
    };
  },
});

// -- Create org + immediately send admin invite email -------------------------
export const createOrg = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    ownerEmail: v.string(),
    ownerName: v.optional(v.string()),
    ownerPhone: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise"), v.literal("custom")),
    actorClerkId: v.string(),
    actorName: v.string(),
    adminNotes: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    taxId: v.optional(v.string()),
    maxUsers: v.optional(v.string()),
    maxLocations: v.optional(v.string()),
    bookingRules: v.optional(v.object({
      idRequired: v.boolean(),
      photoRequired: v.boolean(),
      approvalRequired: v.boolean(),
      walkInEnabled: v.boolean(),
    })),
  },
  handler: async (ctx, { actorClerkId, actorName, ...args }) => {
    const admin = await requireSuperadmin(ctx);
    const actorId = admin.clerkUserId || actorClerkId;
    const actor = admin.name || actorName;

    // Check slug not already taken
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", q => q.eq("slug", args.slug))
      .first();
    if (existing) throw new Error(`Slug "${args.slug}" is already taken`);

    const id = await ctx.db.insert("organizations", {
      ...args,
      status: "trial",
      features: DEFAULT_FEATURES as any,
      bookingRules: args.bookingRules ?? {
        idRequired: false, photoRequired: false,
        approvalRequired: true, walkInEnabled: true,
      },
      trialEndsAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });

    await ctx.db.insert("auditLog", {
      action: "CREATE_ORG",
      actorClerkId: actorId, actorName: actor,
      targetType: "organization",
      targetId: id,
      targetLabel: args.name,
      detail: `Plan: ${args.plan} – Owner: ${args.ownerEmail}`,
      createdAt: Date.now(),
    });

    return id;
  },
});


export const sendAdminInvite = action({
  args: {
    orgId: v.id("organizations"),
    orgName: v.string(),
    adminName: v.string(),
    adminEmail: v.string(),
    actorClerkId: v.string(),
    actorName: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSuperadmin(ctx);
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");
    const adminAppUrl = (process.env.ADMIN_APP_URL ?? "http://localhost:5176") + "/sign-up";

    const res = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + clerkSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: args.adminEmail,
        public_metadata: { role: "admin", orgId: args.orgId, orgName: args.orgName },
        notify: true,
        redirect_url: adminAppUrl,
      }),
    });

    if (!res.ok) {
      const err = await res.json() as { errors?: { message: string }[] };
      const msg = err.errors?.[0]?.message ?? "Failed to send invite";
      if (msg.toLowerCase().includes("duplicate")) throw new Error("An invite was already sent to this email. Revoke the existing invite in Clerk first.");
      throw new Error(msg);
    }

    const data = await res.json() as { id: string };

    await ctx.runMutation(internal.invites.create, {
      name: args.adminName,
      email: args.adminEmail,
      role: "admin",
      invitedByClerkId: args.actorClerkId,
      invitedByName: args.actorName,
      clerkInviteId: data.id,
      orgId: args.orgId,
    });

    await ctx.runMutation(internal.staff.createWithRole, {
      name: args.adminName,
      email: args.adminEmail,
      orgId: args.orgId,
      role: "admin",
      status: "active",
    });


    await ctx.runMutation(internal.superadmin.logAudit, {
      action: "SEND_ADMIN_INVITE",
      actorClerkId: args.actorClerkId,
      actorName: args.actorName,
      targetType: "organization",
      targetId: args.orgId,
      targetLabel: args.orgName,
      detail: `Invited ${args.adminEmail} as admin`,
    });

    return { success: true };
  },
});

export const logAudit = internalMutation({
  args: {
    action: v.string(),
    actorClerkId: v.string(),
    actorName: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    targetLabel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", { ...args, createdAt: Date.now() });
  },
});

export const blockOrg = mutation({
  args: {
    orgId: v.id("organizations"), reason: v.optional(v.string()),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { orgId, reason, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    await ctx.db.patch(orgId, { status: "blocked", blockedReason: reason });
    await ctx.db.insert("auditLog", { action: "BLOCK_ORG", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, detail: reason ?? "No reason", createdAt: Date.now() });
  },
});

export const unblockOrg = mutation({
  args: { orgId: v.id("organizations"), actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { orgId, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    await ctx.db.patch(orgId, { status: "active", blockedReason: undefined });
    await ctx.db.insert("auditLog", { action: "UNBLOCK_ORG", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, createdAt: Date.now() });
  },
});

export const activateOrg = mutation({
  args: { orgId: v.id("organizations"), actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { orgId, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    await ctx.db.patch(orgId, { status: "active", blockedReason: undefined });
    await ctx.db.insert("auditLog", { action: "ACTIVATE_ORG", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, detail: "Manually activated from trial", createdAt: Date.now() });
  },
});

export const expireTrials = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      await requireSuperadmin(ctx);
    }
    const now = Date.now();
    const trialOrgs = await ctx.db.query("organizations").withIndex("by_status", q => q.eq("status", "trial")).collect();
    let count = 0;
    for (const org of trialOrgs) {
      if (org.trialEndsAt && org.trialEndsAt < now) {
        await ctx.db.patch(org._id, { status: "active" });
        count++;
      }
    }
    return { activated: count };
  },
});

export const updatePlan = mutation({
  args: {
    orgId: v.id("organizations"),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { orgId, plan, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    const autoFeatures = PLAN_FEATURES[plan] ?? PLAN_FEATURES.free;
    await ctx.db.patch(orgId, { plan, features: autoFeatures as any });
    await ctx.db.insert("auditLog", { action: "UPDATE_PLAN", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, detail: `Changed to ${plan}`, createdAt: Date.now() });
  },
});

export const updateFeatures = mutation({
  args: {
    orgId: v.id("organizations"),
    features: v.object({
      checkInEnabled: v.boolean(), badgesEnabled: v.boolean(),
      schedulingEnabled: v.boolean(), messagingEnabled: v.boolean(),
      analyticsEnabled: v.boolean(), notificationsEnabled: v.boolean(),
      attendanceEnabled: v.boolean(), multiLocationEnabled: v.boolean(),
    }),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { orgId, features, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    await ctx.db.patch(orgId, { features });
    await ctx.db.insert("auditLog", { action: "UPDATE_FEATURES", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, detail: "Feature flags updated", createdAt: Date.now() });
  },
});

export const updateOrg = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.optional(v.string()), slug: v.optional(v.string()),
    ownerEmail: v.optional(v.string()), ownerName: v.optional(v.string()),
    ownerPhone: v.optional(v.string()), logoUrl: v.optional(v.string()),
    address: v.optional(v.string()), website: v.optional(v.string()),
    taxId: v.optional(v.string()), adminNotes: v.optional(v.string()),
    maxUsers: v.optional(v.string()), maxLocations: v.optional(v.string()),
    bookingRules: v.optional(v.object({
      idRequired: v.boolean(), photoRequired: v.boolean(),
      approvalRequired: v.boolean(), walkInEnabled: v.boolean(),
    })),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { orgId, actorClerkId, actorName, ...fields }) => {
    const admin = await requireSuperadmin(ctx);
    const updates: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) updates[k] = v;
    }
    await ctx.db.patch(orgId, updates);
    await ctx.db.insert("auditLog", { action: "UPDATE_ORG", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "org", targetId: orgId, targetLabel: fields.name, detail: "Updated org details", createdAt: Date.now() });
  },
});

export const deleteOrg = mutation({
  args: { orgId: v.id("organizations"), actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { orgId, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const org = await ctx.db.get(orgId);
    await ctx.db.insert("auditLog", { action: "DELETE_ORG", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "organization", targetId: orgId, targetLabel: org?.name, detail: "Permanently deleted", createdAt: Date.now() });
    await ctx.db.delete(orgId);
  },
});

export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireSuperadmin(ctx);
    return await ctx.db.query("auditLog").withIndex("by_createdAt").order("desc").take(limit ?? 50);
  },
});

export const PLAN_FEATURES: Record<string, Record<string, boolean>> = {
  free: { checkInEnabled: true, badgesEnabled: false, schedulingEnabled: false, messagingEnabled: false, analyticsEnabled: false, notificationsEnabled: false, attendanceEnabled: false, multiLocationEnabled: false, apiAccessEnabled: false, ssoEnabled: false, whitelabelEnabled: false, dedicatedSupportEnabled: false },
  pro: { checkInEnabled: true, badgesEnabled: true, schedulingEnabled: true, messagingEnabled: true, analyticsEnabled: true, notificationsEnabled: true, attendanceEnabled: true, multiLocationEnabled: false, apiAccessEnabled: false, ssoEnabled: false, whitelabelEnabled: false, dedicatedSupportEnabled: false },
  enterprise: { checkInEnabled: true, badgesEnabled: true, schedulingEnabled: true, messagingEnabled: true, analyticsEnabled: true, notificationsEnabled: true, attendanceEnabled: true, multiLocationEnabled: true, apiAccessEnabled: true, ssoEnabled: true, whitelabelEnabled: true, dedicatedSupportEnabled: true },
  custom: { checkInEnabled: true, badgesEnabled: true, schedulingEnabled: true, messagingEnabled: true, analyticsEnabled: true, notificationsEnabled: true, attendanceEnabled: true, multiLocationEnabled: true, apiAccessEnabled: true, ssoEnabled: true, whitelabelEnabled: true, dedicatedSupportEnabled: true },
};

export const listPlanDefinitions = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    return await ctx.db.query("planDefinitions").collect();
  },
});

export const upsertPlanDefinition = mutation({
  args: {
    planId: v.string(), name: v.string(), desc: v.optional(v.string()),
    price: v.number(), annualPrice: v.number(), maxUsers: v.number(),
    maxLocations: v.number(), color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    features: v.object({
      checkInEnabled: v.boolean(), badgesEnabled: v.boolean(),
      schedulingEnabled: v.boolean(), messagingEnabled: v.boolean(),
      analyticsEnabled: v.boolean(), notificationsEnabled: v.boolean(),
      attendanceEnabled: v.boolean(), multiLocationEnabled: v.boolean(),
      apiAccessEnabled: v.boolean(), ssoEnabled: v.boolean(),
      whitelabelEnabled: v.boolean(), dedicatedSupportEnabled: v.boolean(),
    }),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { actorClerkId, actorName, ...args }) => {
    const admin = await requireSuperadmin(ctx);
    const existing = await ctx.db.query("planDefinitions").withIndex("by_planId", q => q.eq("planId", args.planId)).first();
    if (existing) { await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() }); }
    else { await ctx.db.insert("planDefinitions", { ...args, updatedAt: Date.now() }); }
    await ctx.db.insert("auditLog", { action: "UPSERT_PLAN_DEF", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "planDefinition", targetLabel: args.name, detail: `Plan: ${args.planId}`, createdAt: Date.now() });
  },
});

export const deletePlanDefinition = mutation({
  args: { planId: v.string(), actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { planId, actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const existing = await ctx.db.query("planDefinitions").withIndex("by_planId", q => q.eq("planId", planId)).first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLog", { action: "DELETE_PLAN_DEF", actorClerkId: admin.clerkUserId || actorClerkId, actorName: admin.name || actorName, targetType: "planDefinition", targetLabel: planId, createdAt: Date.now() });
  },
});

// kept for backwards compat
export const sendAdminInvites = action({
  args: {
    orgId: v.id("organizations"), orgName: v.string(),
    admins: v.array(v.object({ name: v.string(), email: v.string() })),
    actorClerkId: v.string(), actorName: v.string(),
  },
  handler: async (ctx, { orgId, orgName, admins, actorClerkId, actorName }) => {
    await requireSuperadmin(ctx);
    const results = [];
    for (const admin of admins) {
      try {
        await ctx.runAction(api.superadmin.sendAdminInvite, { orgId, orgName, adminName: admin.name, adminEmail: admin.email, actorClerkId, actorName });
        results.push({ email: admin.email, success: true });
      } catch (err: any) {
        results.push({ email: admin.email, success: false, error: err.message });
      }
    }
    return results;
  },
});
export const setUserMetadata = action({
  args: {
    userClerkId: v.string(),
    orgId: v.id("organizations"),
    orgName: v.string(),
    role: v.union(v.literal("admin"), v.literal("staff")),
  },
  handler: async (ctx, { userClerkId, orgId, orgName, role }) => {
    await requireSuperadmin(ctx);
    const res = await fetch(`https://api.clerk.com/v1/users/${userClerkId}/metadata`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ public_metadata: { role, orgId, orgName } }),
    });
    if (!res.ok) throw new Error("Failed to update metadata");
    return { success: true };
  },
});
// -- Platform Settings ---------------------------------------------------------
const PLATFORM_DEFAULTS = {
  trialDays: 14,
  selfServeSignups: true,
  defaultPlan: "free",
  requireEmailVerify: true,
  apiAccessTier: "pro",
  ssoEnforcement: "optional",
  currency: "USD",
  annualDiscount: 20,
  gracePeriodDays: 7,
  maintenanceMode: false,
  platformName: "Porta",
  supportEmail: "",
};

export const getPlatformSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const s = await ctx.db.query("platformSettings").first();
    return s ?? { ...PLATFORM_DEFAULTS, _id: null };
  },
});

export const savePlatformSettings = mutation({
  args: {
    trialDays: v.number(),
    selfServeSignups: v.boolean(),
    defaultPlan: v.string(),
    requireEmailVerify: v.boolean(),
    apiAccessTier: v.string(),
    ssoEnforcement: v.string(),
    currency: v.string(),
    annualDiscount: v.number(),
    gracePeriodDays: v.number(),
    maintenanceMode: v.optional(v.boolean()),
    platformName: v.optional(v.string()),
    supportEmail: v.optional(v.string()),
    actorClerkId: v.string(),
    actorName: v.string(),
  },
  handler: async (ctx, { actorClerkId, actorName, ...settings }) => {
    const admin = await requireSuperadmin(ctx);
    const existing = await ctx.db.query("platformSettings").first();
    const data = { ...settings, updatedAt: Date.now(), updatedBy: admin.name || actorName };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("platformSettings", data);
    }
    await ctx.db.insert("auditLog", {
      action: "UPDATE_PLATFORM_SETTINGS",
      actorClerkId: admin.clerkUserId || actorClerkId,
      actorName: admin.name || actorName,
      targetType: "platform",
      targetId: "platform",
      targetLabel: "Platform Settings",
      detail: "Updated global platform configuration",
      createdAt: Date.now(),
    });
  },
});

export const clearAuditLog = mutation({
  args: { actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const logs = await ctx.db.query("auditLog").collect();
    await Promise.all(logs.map(l => ctx.db.delete(l._id)));
    await ctx.db.insert("auditLog", {
      action: "CLEAR_AUDIT_LOG",
      actorClerkId: admin.clerkUserId || actorClerkId,
      actorName: admin.name || actorName,
      targetType: "platform",
      targetId: "platform",
      targetLabel: "Audit Log",
      detail: "Cleared all audit log entries",
      createdAt: Date.now(),
    });
  },
});

export const resetAllFeatureFlags = mutation({
  args: { actorClerkId: v.string(), actorName: v.string() },
  handler: async (ctx, { actorClerkId, actorName }) => {
    const admin = await requireSuperadmin(ctx);
    const orgs = await ctx.db.query("organizations").collect();
    const defaults = {
      checkInEnabled: true, badgesEnabled: false, schedulingEnabled: true,
      messagingEnabled: true, analyticsEnabled: true, notificationsEnabled: true,
      attendanceEnabled: false, multiLocationEnabled: false, apiAccessEnabled: false,
      ssoEnabled: false, whitelabelEnabled: false, dedicatedSupportEnabled: false,
    };
    await Promise.all(orgs.map(o => ctx.db.patch(o._id, { features: defaults })));
    await ctx.db.insert("auditLog", {
      action: "RESET_FEATURE_FLAGS",
      actorClerkId: admin.clerkUserId || actorClerkId,
      actorName: admin.name || actorName,
      targetType: "platform",
      targetId: "platform",
      targetLabel: "All Orgs",
      detail: `Reset feature flags for ${orgs.length} organisations`,
      createdAt: Date.now(),
    });
  },
});

export const migrateStaffClerkMetadata = action({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("Missing CLERK_SECRET_KEY");

    const staff = await ctx.runQuery(internal.superadmin.listAllStaff);
    const results = { updated: 0, skipped: 0, failed: 0, errors: [] as string[] };

    for (const member of staff) {
      if (!member.clerkUserId || !member.orgId) { results.skipped++; continue; }
      try {
        const res = await fetch(`https://api.clerk.com/v1/users/${member.clerkUserId}/metadata`, {
          method: "PATCH",
          headers: {
            "Authorization": "Bearer " + clerkSecretKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            public_metadata: {
              orgId: member.orgId,
              role: member.role ?? "employee",
            },
          }),
        });
        if (res.ok) { results.updated++; }
        else { results.failed++; results.errors.push(`${member.clerkUserId}: ${res.status}`); }
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${member.clerkUserId}: ${e.message}`);
      }
    }
    return results;
  },
});

export const listAllStaff = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("staff").collect();
  },
});

export const migrateRoomsOrgId = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireSuperadmin(ctx);
    const rooms = await ctx.db.query("rooms").collect();
    const unlinked = rooms.filter((r: any) => !r.orgId);
    for (const room of unlinked) {
      await ctx.db.patch(room._id, { orgId });
    }
    return { patched: unlinked.length, total: rooms.length };
  },
});