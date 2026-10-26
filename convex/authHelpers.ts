import { QueryCtx, MutationCtx, ActionCtx, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveOrgId, isOrgBlocked, findStaffForIdentity } from "./getOrgId";
import type { UserIdentity } from "convex/server";
import type { Doc } from "./_generated/dataModel";

export interface AuthResult {
  identity: UserIdentity;
  orgId: string;
  staff: Doc<"staff"> | null;
  role: string | undefined;
}

export const checkAdminQuery = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuthResult> => {
    return await requireAdminInternal(ctx);
  },
});

export const checkAdminOrReceptionistQuery = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuthResult> => {
    return await requireAdminOrReceptionistInternal(ctx);
  },
});

export const checkStaffMemberQuery = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuthResult> => {
    return await requireStaffMemberInternal(ctx);
  },
});

async function requireRoleInternal(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: string[]
): Promise<AuthResult> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const staff = await findStaffForIdentity(ctx, identity);

  let role: string | undefined = staff?.role;
  let orgId: string | undefined = staff?.orgId ?? (identity.publicMetadata as any)?.orgId;

  if (!staff) {
    const org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("ownerEmail"), identity.email))
      .first();
    if (org) {
      role = "admin";
      orgId = org._id;
    } else {
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
        .unique();
      if (user) {
        role = user.role;
        if (!orgId && user.orgId) orgId = user.orgId;
      }
    }
  }

  if (!role || !allowedRoles.includes(role)) {
    throw new Error("Not authorized");
  }

  if (!orgId) {
    const resolved = await resolveOrgId(ctx);
    if (resolved) orgId = resolved;
  }

  if (!orgId) {
    throw new Error("Organization not found");
  }

  // A blocked or suspended organisation loses access for everyone except the superadmin.
  // Before this, blocking only hid the public booking page; logged-in staff carried on as normal.
  if (role !== "superadmin" && (await isOrgBlocked(ctx, orgId))) {
    throw new Error("This organisation has been blocked. Please contact support.");
  }

  return { identity, orgId, staff, role };
}

async function requireAdminInternal(ctx: QueryCtx | MutationCtx): Promise<AuthResult> {
  return requireRoleInternal(ctx, ["admin", "superadmin"]);
}

async function requireAdminOrReceptionistInternal(ctx: QueryCtx | MutationCtx): Promise<AuthResult> {
  return requireRoleInternal(ctx, ["admin", "superadmin", "receptionist"]);
}

// Any logged-in staff role. Use for functions every staff member may call.
const STAFF_ROLES = ["admin", "superadmin", "receptionist", "pa", "dept_head", "employee"];

async function requireStaffMemberInternal(ctx: QueryCtx | MutationCtx): Promise<AuthResult> {
  return requireRoleInternal(ctx, STAFF_ROLES);
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<AuthResult> {
  if ("runQuery" in ctx && !("db" in ctx)) {
    return await (ctx as ActionCtx).runQuery(internal.authHelpers.checkAdminQuery);
  }
  return await requireAdminInternal(ctx as QueryCtx | MutationCtx);
}

export async function requireAdminOrReceptionist(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<AuthResult> {
  if ("runQuery" in ctx && !("db" in ctx)) {
    return await (ctx as ActionCtx).runQuery(internal.authHelpers.checkAdminOrReceptionistQuery);
  }
  return await requireAdminOrReceptionistInternal(ctx as QueryCtx | MutationCtx);
}

export async function requireStaffMember(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<AuthResult> {
  if ("runQuery" in ctx && !("db" in ctx)) {
    return await (ctx as ActionCtx).runQuery(internal.authHelpers.checkStaffMemberQuery);
  }
  return await requireStaffMemberInternal(ctx as QueryCtx | MutationCtx);
}

export function assertSameOrg(
  callerOrgId: string | undefined | null,
  recordOrgId: string | undefined | null
) {
  if (!callerOrgId) {
    throw new Error("Not authorized for this organization");
  }
  if (!recordOrgId || callerOrgId !== recordOrgId) {
    throw new Error("Not authorized for this organization");
  }
}

export async function requireSelf(ctx: QueryCtx | MutationCtx, clerkUserId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  if (identity.subject !== clerkUserId) throw new Error("Not authorized");
  return identity;
}

async function requireSuperadminInternal(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const user = await ctx.db.query("users")
    .withIndex("by_clerk_id", q => q.eq("clerkUserId", identity.subject)).unique();
  const isSuperadmin = user?.role === "superadmin" || (identity.publicMetadata as any)?.role === "superadmin";
  if (!isSuperadmin) throw new Error("Not authorized");
  return { clerkUserId: user?.clerkUserId ?? identity.subject, name: user?.name ?? (identity.name as string) ?? "Superadmin" };
}
export const checkSuperadminQuery = internalQuery({
  args: {}, handler: async (ctx) => requireSuperadminInternal(ctx),
});
export async function requireSuperadmin(ctx: QueryCtx | MutationCtx | ActionCtx) {
  if ("runQuery" in ctx && !("db" in ctx))
    return await (ctx as ActionCtx).runQuery(internal.authHelpers.checkSuperadminQuery);
  return await requireSuperadminInternal(ctx as QueryCtx | MutationCtx);
}