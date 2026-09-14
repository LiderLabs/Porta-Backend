import { mutation } from "./_generated/server";

export const fixStaffOrgIds = mutation({
  args: {},
  handler: async (ctx) => {
    // Get the organization
    const org = await ctx.db.query("organizations").first();
    if (!org) throw new Error("No organization found");
    
    // Get all staff missing orgId
    const allStaff = await ctx.db.query("staff").collect();
    const unlinked = allStaff.filter(s => !s.orgId);
    
    // Patch all of them
    await Promise.all(unlinked.map(s => ctx.db.patch(s._id, { orgId: org._id })));
    
    // Also link clerkUserId from users table by email
    const allUsers = await ctx.db.query("users").collect();
    for (const s of allStaff) {
      if (s.clerkUserId) continue;
      const match = allUsers.find(u => u.email?.toLowerCase().trim() === s.email?.toLowerCase().trim());
      if (match?.clerkUserId) {
        await ctx.db.patch(s._id, { clerkUserId: match.clerkUserId });
      }
    }
    
    return { fixed: unlinked.length };
  },
});
