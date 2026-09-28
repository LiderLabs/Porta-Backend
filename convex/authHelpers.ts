import { QueryCtx, MutationCtx } from "./_generated/server";
import { resolveOrgId } from "./getOrgId";

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
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

export async function requireAdminOrReceptionist(ctx: QueryCtx | MutationCtx) {
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

export function assertSameOrg(callerOrgId: string | undefined | null, recordOrgId: string | undefined | null) {
  if (!callerOrgId || !recordOrgId || callerOrgId !== recordOrgId) {
    throw new Error("Not authorized for this organization");
  }
}