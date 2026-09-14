import { internalMutation } from "./_generated/server";
export const fixNames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const updates = [
      { clerkUserId: "user_3DwKKwBBAwkpwZNPyhTxGdcmMuj", name: "Receptionist" },
      { clerkUserId: "user_3DwKKvfu5BBd84AlnNgf70yfhPw", name: "Staff" },
      { clerkUserId: "user_3DwKL48L3jHvujwb6DHT0hrW1BC", name: "Admin" },
    ];
    for (const u of updates) {
      const rec = await ctx.db.query("users").filter((q) => q.eq(q.field("clerkUserId"), u.clerkUserId)).unique();
      if (rec) await ctx.db.patch(rec._id, { name: u.name });
    }
    return "done";
  },
});
