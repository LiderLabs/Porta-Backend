
import { mutation } from "./_generated/server";

export const fixDepartmentsOrgId = mutation({
  args: {},
  handler: async (ctx) => {
    const TARGET_ORG_ID = "kn77hzyznnc66eyjm51eg1wnr5883byp";
    const depts = await ctx.db.query("departments").collect();
    let fixed = 0;
    for (const d of depts) {
      if (!d.orgId) {
        await ctx.db.patch(d._id, { orgId: TARGET_ORG_ID });
        fixed++;
      }
    }
    return { fixed };
  },
});

export const fixMargueritaStaff = mutation({
  args: {},
  handler: async (ctx) => {
    const TARGET_ORG_ID = "kn77hzyznnc66eyjm51eg1wnr5883byp";
    const MARG_EMAIL = "marguerita.gbebleou@liderlabs.com";
    const MARG_CLERK_ID = "user_3Eie0eSR6w8Sga8AeHFvQqwWDnV";

    // Check if staff record already exists
    const existing = await ctx.db.query("staff")
      .filter(q => q.eq(q.field("clerkUserId"), MARG_CLERK_ID))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { orgId: TARGET_ORG_ID });
      return { action: "patched existing", id: existing._id };
    }

    // Also check by email
    const byEmail = await ctx.db.query("staff")
      .filter(q => q.eq(q.field("email"), MARG_EMAIL))
      .first();
    if (byEmail) {
      await ctx.db.patch(byEmail._id, { clerkUserId: MARG_CLERK_ID, orgId: TARGET_ORG_ID });
      return { action: "linked by email", id: byEmail._id };
    }

    // Create fresh staff record for her
    const id = await ctx.db.insert("staff", {
      name: "Marguerita",
      email: MARG_EMAIL,
      clerkUserId: MARG_CLERK_ID,
      orgId: TARGET_ORG_ID,
      role: "admin",
      status: "active",
      availability: "available",
    });
    return { action: "created", id };
  },
});
