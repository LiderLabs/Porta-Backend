import { query } from "./_generated/server";
import { v } from "convex/values";

export const buildCheckInNotifyMessage = query({
    args: { visitorId: v.id("visitors") },
    handler: async (ctx, { visitorId }) => {
        const visitor = await ctx.db.get(visitorId);
        if (!visitor) throw new Error("Visitor not found");

        const host = visitor.hostId ? await ctx.db.get(visitor.hostId) : null;
        const hostName = host?.name ?? "there";

        const time = new Date(visitor.checkInTime).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });

        const message =
            `Hi ${hostName},\n\n*${visitor.fullName}* has arrived at reception for your *${time}* ` +
            `${visitor.purpose ? `${visitor.purpose} ` : ""}meeting.\n\nPlease come to reception or send directions. 🙏`;

        return {
            phone: host?.phone ?? null,
            message,
        };
    },
});
