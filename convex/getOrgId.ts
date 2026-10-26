
import type { QueryCtx, MutationCtx } from "./_generated/server";

// Finds the signed-in person's staff record. A person who was invited has a staff record before
// they have a login, and the link to their login is only made when Clerk's "invitation accepted"
// webhook arrives. Until then (or if the webhook is not set up) they were treated as unknown and
// every query threw, which left the page blank. A verified email match on an unlinked record is
// the same proof the webhook uses, so accept it here.
export async function findStaffForIdentity(ctx: QueryCtx | MutationCtx, identity: { subject: string; email?: string; emailVerified?: boolean }) {
  const linked = await ctx.db
    .query("staff")
    .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (linked) return linked;
  if (!identity.email || identity.emailVerified !== true) return null;
  const byEmail = await ctx.db
    .query("staff")
    .withIndex("by_email", (q) => q.eq("email", identity.email!.toLowerCase().trim()))
    .collect();
  return byEmail.find((s) => !s.clerkUserId && s.status !== "inactive") ?? null;
}

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

  const staffRecord = await findStaffForIdentity(ctx, identity);
  if (staffRecord?.orgId) return staffRecord.orgId as string;

  // The sign-up webhook stores the organisation on the users row. Use it when there is no staff
  // record and the login token carries no organisation.
  const userRow = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (userRow?.orgId) return userRow.orgId as string;

  const org = await ctx.db
    .query("organizations")
    .filter((q) => q.eq(q.field("ownerEmail"), identity.email))
    .first();
  if (org) return org._id;

  return null;
}
