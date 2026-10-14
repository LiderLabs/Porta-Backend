
import type { QueryCtx, MutationCtx } from "./_generated/server";

export async function resolveOrgId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
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
