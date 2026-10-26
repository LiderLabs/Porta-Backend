
import type { QueryCtx, MutationCtx } from "./_generated/server";

export async function isOrgBlocked(ctx: QueryCtx | MutationCtx, orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  const id = ctx.db.normalizeId("organizations", orgId);
  if (!id) return false;
  const org = await ctx.db.get(id);
  return !!org && (org.status === "blocked" || org.status === "suspended");
}

// A blocked or suspended organisation resolves to no organisation, so every query scoped by it
// comes back empty. The superadmin is exempt so they can still manage the organisation.
export async function resolveOrgId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const orgId = await resolveOrgIdRaw(ctx);
  if (!orgId) return null;
  const identity = await ctx.auth.getUserIdentity();
  if ((identity?.publicMetadata as any)?.role === "superadmin") return orgId;
  return (await isOrgBlocked(ctx, orgId)) ? null : orgId;
}

async function resolveOrgIdRaw(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const metaOrgId = (identity.publicMetadata as any)?.orgId;
  if (metaOrgId) return metaOrgId as string;

  const staffRecord = await ctx.db
    .query("staff")
    .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (staffRecord?.orgId) return staffRecord.orgId as string;

  const org = await ctx.db
    .query("organizations")
    .filter((q) => q.eq(q.field("ownerEmail"), identity.email))
    .first();
  if (org) return org._id;

  return null;
}
