import { resolveOrgId } from "./getOrgId";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, assertSameOrg } from "./authHelpers";

const BUFFER_MS = 10 * 60 * 1000; // 10 min buffer

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const rooms = await ctx.db.query("rooms").collect();
    return orgId ? rooms.filter((r: any) => r.orgId === orgId) : [];
  },
});

export const listActive = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, { orgId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const resolvedOrgId = orgId ?? (identity?.publicMetadata as any)?.orgId;
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_status", q => q.eq("status", "active"))
      .collect();
    if (!resolvedOrgId) return [];
    return rooms.filter(r => r.orgId === resolvedOrgId);
  },
});

export const checkAvailability = query({
  args: {
    proposedStart:   v.number(),
    proposedEnd:     v.number(),
    excludeVisitId:  v.optional(v.id("scheduledVisits")),
  },
  handler: async (ctx, { proposedStart, proposedEnd, excludeVisitId }) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_status", q => q.eq("status", "active"))
      .collect();

    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", q =>
        q.gte("scheduledDate", proposedStart - 2 * 60 * 60 * 1000)
         .lte("scheduledDate", proposedEnd + 2 * 60 * 60 * 1000)
      )
      .collect();

    const bookedRoomIds = new Set<string>();
    for (const v of visits) {
      if (!v.roomId) continue;
      if (excludeVisitId && v._id === excludeVisitId) continue;
      if (["cancelled","rejected","no_show","completed","declined"].includes(v.status)) continue;
      const vEnd = v.scheduledDate + (v.duration ?? 60) * 60 * 1000 + BUFFER_MS;
      const vStart = v.scheduledDate;
      if (proposedStart < vEnd && proposedEnd > vStart) {
        bookedRoomIds.add(v.roomId);
      }
    }

    return rooms.map(r => ({
      ...r,
      available: !bookedRoomIds.has(r._id),
    }));
  },
});

export const create = mutation({
  args: {
    name:      v.string(),
    floor:     v.optional(v.string()),
    capacity:  v.optional(v.number()),
    amenities: v.optional(v.array(v.string())),
    // orgId removed — never trust an orgId argument from the client
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    return await ctx.db.insert("rooms", {
      ...args,
      orgId,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    roomId:    v.id("rooms"),
    name:      v.string(),
    floor:     v.optional(v.string()),
    capacity:  v.optional(v.number()),
    amenities: v.optional(v.array(v.string())),
    status:    v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { roomId, ...rest }) => {
    const { orgId } = await requireAdmin(ctx);
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error("Room not found");
    assertSameOrg(orgId, room.orgId);
    await ctx.db.patch(roomId, rest);
  },
});

export const remove = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const { orgId } = await requireAdmin(ctx);
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error("Room not found");
    assertSameOrg(orgId, room.orgId);
    await ctx.db.delete(roomId);
  },
});
