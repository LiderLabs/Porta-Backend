import { QueryCtx, MutationCtx, ActionCtx, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveOrgId } from "./getOrgId";
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

async function requireAdminInternal(ctx: QueryCtx | MutationCtx): Promise<AuthResult> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const staff = await ctx.db
    .query("staff")
    .filter((q) => q.eq(q.field("clerkUserId"), identity.subject))
    .first();

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
      }
    }
  }

  if (role !== "admin" && role !== "superadmin") {
    throw new Error("Not authorized");
  }

  if (!orgId) {
    const resolved = await resolveOrgId(ctx);
    if (resolved) orgId = resolved;
  }

  if (!orgId) {
    throw new Error("Organization not found");
  }

  return { identity, orgId, staff, role };
}

async function requireAdminOrReceptionistInternal(ctx: QueryCtx | MutationCtx): Promise<AuthResult> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const staff = await ctx.db
    .query("staff")
    .filter((q) => q.eq(q.field("clerkUserId"), identity.subject))
    .first();

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
      }
    }
  }

  if (role !== "admin" && role !== "superadmin" && role !== "receptionist") {
    throw new Error("Not authorized");
  }

  if (!orgId) {
    const resolved = await resolveOrgId(ctx);
    if (resolved) orgId = resolved;
  }

  if (!orgId) {
    throw new Error("Organization not found");
  }

  return { identity, orgId, staff, role };
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

export function assertSameOrg(callerOrgId: string | undefined | null, recordOrgId: string | undefined | null) {
  if (!callerOrgId || !recordOrgId || callerOrgId !== recordOrgId) {
    throw new Error("Not authorized for this organization");
  }
}

/**
 * Identity-match guard. Verifies the authenticated caller IS the person
 * identified by `clerkUserId`. Use this wherever the check is "are you
 * the right person?" rather than "do you have the right role?"
 */
export async function requireSelf(ctx: QueryCtx | MutationCtx, clerkUserId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  if (identity.subject !== clerkUserId) throw new Error("Not authorized");
  return identity;
}