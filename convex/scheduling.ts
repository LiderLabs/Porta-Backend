import { resolveOrgId } from "./getOrgId";
import { query, mutation } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

async function withHostName(ctx: any, visit: any) {
  if (!visit.hostId) return { ...visit, hostName: null };
  const s = await ctx.db.get(visit.hostId);
  return { ...visit, hostName: s?.name ?? null };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await resolveOrgId(ctx);
    const visits = await ctx.db.query("scheduledVisits").order("desc").collect();
    const staffList = await ctx.db.query("staff").collect();
    const filtered = orgId ? visits.filter((v: any) => v.orgId === orgId) : visits;
    return filtered.map((v: any) => {
      const host = v.hostId ? staffList.find((s: any) => s._id === v.hostId) : null;
      return { ...v, hostName: host?.name ?? null };
    });
  },
});

export const listByStaff = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const staffMember = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .first();
    if (!staffMember) return [];
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_hostId", (q) => q.eq("hostId", staffMember._id))
      .collect();
    return visits.sort((a, b) => b.scheduledDate - a.scheduledDate);
  },
});

export const getLiveCalendar = query({
  args: {
    rangeStart: v.number(),
    rangeEnd: v.number(),
    hostId: v.optional(v.id("staff")),
  },
  handler: async (ctx, { rangeStart, rangeEnd, hostId }) => {
    // Visits in range
    let visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", rangeStart).lte("scheduledDate", rangeEnd),
      )
      .collect();

    if (hostId) visits = visits.filter((v) => v.hostId === hostId);
    const orgId = await resolveOrgId(ctx);
    if (orgId) visits = visits.filter((v: any) => v.orgId === orgId);

    // Blocked slots in range
    let blocked = await ctx.db
      .query("blockedSlots")
      .withIndex("by_startTime", (q) =>
        q.gte("startTime", rangeStart).lte("startTime", rangeEnd),
      )
      .collect();

    if (hostId) blocked = blocked.filter((b) => b.staffId === hostId);

    // Resolve host names for visits
    const staffList = await ctx.db.query("staff").collect();
    const visitsWithHost = visits.map((v) => ({
      ...v,
      hostName: v.hostId ? (staffList.find((s) => s._id === v.hostId)?.name ?? null) : null,
    }));

    // Resolve staff names for blocked slots
    const blockedWithName = blocked.map((b) => ({
      ...b,
      staffName: staffList.find((s) => s._id === b.staffId)?.name ?? null,
    }));

    return { visits: visitsWithHost, blockedSlots: blockedWithName };
  },
});

export const checkConflicts = query({
  args: {
    hostId: v.id("staff"),
    proposedStart: v.number(),
    proposedEnd: v.number(),
    excludeVisitId: v.optional(v.id("scheduledVisits")),
  },
  handler: async (ctx, { hostId, proposedStart, proposedEnd, excludeVisitId }) => {
    const duration = 60 * 60 * 1000; // default 1h window

    // Check scheduled visits
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_hostId", (q) => q.eq("hostId", hostId))
      .collect();

    const visitConflicts = visits.filter((v) => {
      if (excludeVisitId && v._id === excludeVisitId) return false;
      if (["cancelled", "rejected", "no_show", "completed", "declined"].includes(v.status)) return false;
      const vEnd = v.scheduledDate + (v.duration ?? 60) * 60 * 1000;
      return proposedStart < vEnd && proposedEnd > v.scheduledDate;
    });

    // Check blocked slots
    const blocked = await ctx.db
      .query("blockedSlots")
      .withIndex("by_staff", (q) => q.eq("staffId", hostId))
      .collect();

    const blockedConflicts = blocked.filter((b) =>
      proposedStart < b.endTime && proposedEnd > b.startTime,
    );

    return {
      hasConflict: visitConflicts.length > 0 || blockedConflicts.length > 0,
      visitConflicts,
      blockedConflicts,
    };
  },
});

export const getUpcoming = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const staffMember = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .first();
    if (!staffMember) return [];
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_hostId", (q) => q.eq("hostId", staffMember._id))
      .collect();
    return visits
      .filter((v) =>
        ["approved", "accepted"].includes(v.status) &&
        v.scheduledDate >= now &&
        v.scheduledDate <= in24h,
      )
      .sort((a, b) => a.scheduledDate - b.scheduledDate);
  },
});

export const getTodayForReceptionist = query({
  args: {},
  handler: async (ctx) => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const all = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", start.getTime()).lte("scheduledDate", end.getTime()),
      )
      .collect();
    const staffList = await ctx.db.query("staff").collect();
    return all
      .map((v) => ({ ...v, hostName: staffList.find((s) => s._id === v.hostId)?.name ?? null }))
      .sort((a, b) => a.scheduledDate - b.scheduledDate);
  },
});

export const getById = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const visit = await ctx.db.get(visitId);
    if (!visit) return null;
    return withHostName(ctx, visit);
  },
});

export const getBlockedSlots = query({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const now = Date.now();
    const slots = await ctx.db
      .query("blockedSlots")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    // Return future + today's slots only
    return slots
      .filter((s) => s.endTime >= now)
      .sort((a, b) => a.startTime - b.startTime);
  },
});

export const listStaffPublic = query({
  args: {},
  handler: async (ctx) => {
    const staff = await ctx.db.query("staff").collect();
    return staff
      .filter((s) => s.status !== "inactive")
      .map((s) => ({
        _id: s._id,
        name: s.name,
        department: s.department,
        title: s.title,
        availability: s.availability ?? "available",
      }));
  },
});

export const create = mutation({
  args: {
    visitorName: v.string(),
    visitorEmail: v.optional(v.string()),
    visitorPhone: v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    purpose: v.optional(v.string()),
    hostStaffId: v.optional(v.id("staff")),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    source: v.optional(v.union(v.literal("walkin"), v.literal("online"), v.literal("admin"))),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, ...rest } = args;
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "pending",
    });
  },
});

export const publicBook = mutation({
  args: {
    visitorName: v.string(),
    visitorEmail: v.optional(v.string()),
    visitorPhone: v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    purpose: v.optional(v.string()),
    hostStaffId: v.optional(v.id("staff")),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
    orgSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, orgSlug, ...rest } = args;

    // Resolve host name for the email
    const host = hostStaffId ? await ctx.db.get(hostStaffId) : null;

    // Resolve orgId from slug for booking isolation
    let orgId: string | undefined;
    if (orgSlug) {
      const org = await ctx.db.query("organizations").withIndex("by_slug", q => q.eq("slug", orgSlug)).first();
      orgId = org?._id;
    } else {
      const org = await ctx.db.query("organizations").first();
      orgId = org?._id;
    }

    // Conflict check — block if host already has an approved/pending visit overlapping this slot
    if (hostStaffId) {
      const duration = args.duration ?? 60;
      const newStart = args.scheduledDate;
      const newEnd = newStart + duration * 60 * 1000;
      const existing = await ctx.db.query("scheduledVisits")
        .filter(q => q.eq(q.field("hostId"), hostStaffId))
        .collect();
      const conflict = existing.find(v => {
        if (!["pending", "approved", "checked_in", "in_meeting"].includes(v.status)) return false;
        const vStart = v.scheduledDate;
        const vEnd = vStart + (v.duration ?? 60) * 60 * 1000;
        return newStart < vEnd && newEnd > vStart;
      });
      if (conflict) throw new Error("That time slot is already booked for this person. Please choose a different time.");
    }

    const visitId = await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "pending",
      source: "online",
      orgId,
    });

    // Send "booking received" email to visitor (only if they gave an email)
    if (args.visitorEmail) {
      await ctx.scheduler.runAfter(0, api.email.sendBookingReceived, {
        to: args.visitorEmail,
        visitorName: args.visitorName,
        hostName: host?.name ?? undefined,
        scheduledDate: args.scheduledDate,
        purpose: args.purpose ?? undefined,
        visitorCompany: args.visitorCompany ?? undefined,
        notes: args.notes ?? undefined,
      });
    }

    return visitId;
  },
});

export const approve = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    actorClerkId: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, actorClerkId, actorName }) => {
    await ctx.db.patch(visitId, {
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: actorName ?? actorClerkId ?? "receptionist",
    });

    // Send "booking confirmed" email to visitor
    const visit = await ctx.db.get(visitId);
    if (visit?.visitorEmail) {
      const host = visit.hostId ? await ctx.db.get(visit.hostId) : null;
      await ctx.scheduler.runAfter(0, api.email.sendBookingConfirmed, {
        to: visit.visitorEmail,
        visitorName: visit.visitorName,
        hostName: host?.name ?? undefined,
        scheduledDate: visit.scheduledDate,
        purpose: visit.purpose ?? undefined,
        visitorCompany: visit.visitorCompany ?? undefined,
        notes: visit.notes ?? undefined,
        approvedBy: actorName ?? undefined,
      });
    }
  },
});

export const accept = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { status: "approved", approvedAt: Date.now() });
  },
});

export const reject = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, reason }) => {
    await ctx.db.patch(visitId, {
      status: "rejected",
      cancelReason: reason,
      cancelledAt: Date.now(),
    });
  },
});

export const decline = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { status: "rejected", cancelledAt: Date.now() });
  },
});

export const markCheckedIn = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const now = Date.now();
    await ctx.db.patch(visitId, { status: "checked_in", checkedInAt: now });

    // Send smart check-in alert to host
    const visit = await ctx.db.get(visitId);
    if (visit?.hostId) {
      const host = await ctx.db.get(visit.hostId);
      if (host?.email) {
        await ctx.scheduler.runAfter(0, api.email.sendHostCheckInAlert, {
          to: host.email,
          hostName: host.name,
          visitorName: visit.visitorName,
          visitorCompany: visit.visitorCompany ?? undefined,
          purpose: visit.purpose ?? undefined,
          scheduledDate: visit.scheduledDate,
          checkedInAt: now,
        });
      }
    }
  },
});

export const searchByVisitor = query({
  args: { slug: v.string(), search: v.string() },
  handler: async (ctx, { slug, search }) => {
    if (!search || search.trim().length < 2) return [];
    const org = await ctx.db.query("organizations").withIndex("by_slug", q => q.eq("slug", slug)).first();
    if (!org) return [];
    const term = search.toLowerCase().trim();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_org", q => q.eq("orgId", org._id))
      .collect();
    return visits.filter(v =>
      (v.status === "approved" || v.status === "pending") &&
      v.scheduledDate >= today.getTime() &&
      (v.visitorName?.toLowerCase().includes(term) || v.visitorEmail?.toLowerCase().includes(term))
    ).slice(0, 5);
  },
});

/** Visitor is now in the meeting room. */
export const markInMeeting = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { status: "in_meeting" });
  },
});

/** Visit is done. */
export const markCompleted = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { status: "completed", completedAt: Date.now() });
  },
});

/** Visitor no-showed (was approved but never arrived). */
export const markNoShow = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { status: "no_show" });
  },
});

/** Cancel a visit. */
export const cancel = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, reason }) => {
    await ctx.db.patch(visitId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelReason: reason,
    });
  },
});

/** Reschedule â€” update date + reset to pending. */
export const reschedule = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, scheduledDate, duration, notes }) => {
    const existing = await ctx.db.get(visitId);
    if (!existing) throw new Error("Visit not found");
    await ctx.db.patch(visitId, {
      scheduledDate,
      duration,
      notes,
      status: "pending",
      rescheduledFrom: existing.scheduledDate,
    });
  },
});

/** Hard delete. */
export const remove = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.delete(visitId);
  },
});

/** Mark reminder sent. */
export const markReminderSent = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    await ctx.db.patch(visitId, { reminderSent: true });
  },
});

export const blockSlot = mutation({
  args: {
    staffId: v.id("staff"),
    startTime: v.number(),
    endTime: v.number(),
    reason: v.optional(v.string()),
    createdByClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("blockedSlots", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Remove a blocked slot. */
export const unblockSlot = mutation({
  args: { slotId: v.id("blockedSlots") },
  handler: async (ctx, { slotId }) => {
    await ctx.db.delete(slotId);
  },
});

export const setAvailability = mutation({
  args: {
    clerkUserId: v.string(),
    availability: v.union(
      v.literal("available"),
      v.literal("busy"),
      v.literal("away"),
      v.literal("off"),
    ),
  },
  handler: async (ctx, { clerkUserId, availability }) => {
    const staffMember = await ctx.db
      .query("staff")
      .filter((q) => q.eq(q.field("clerkUserId"), clerkUserId))
      .first();
    if (!staffMember) throw new Error("Staff member not found");
    await ctx.db.patch(staffMember._id, { availability });
  },
});

export const updateStatus = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    status: v.union(
      v.literal("pending"), v.literal("approved"), v.literal("accepted"),
      v.literal("rejected"), v.literal("declined"), v.literal("checked_in"),
      v.literal("in_meeting"), v.literal("completed"), v.literal("cancelled"),
      v.literal("no_show"), v.literal("rescheduled"),
    ),
  },
  handler: async (ctx, { visitId, status }) => {
    await ctx.db.patch(visitId, { status });
  },
});

export const listAllBlockedSlots = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const slots = await ctx.db.query("blockedSlots").collect();
    return slots
      .filter((s) => s.endTime >= now)
      .map((s) => ({
        _id: s._id,
        staffId: s.staffId,
        startTime: s.startTime,
        endTime: s.endTime,
        reason: s.reason,
        date: new Date(s.startTime).toISOString().split("T")[0],
        startTimeStr: new Date(s.startTime).toTimeString().slice(0, 5),
        endTimeStr: new Date(s.endTime).toTimeString().slice(0, 5),
      }));
  },
});

export const listApprovedVisits = query({
  args: {},
  handler: async (ctx) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) => q.gte("scheduledDate", todayStart.getTime()))
      .collect();
    return visits
      .filter((v) => ["approved", "checked_in", "in_meeting", "accepted"].includes(v.status))
      .map((v) => ({
        _id: v._id,
        hostStaffId: v.hostId,
        hostId: v.hostId,
        scheduledDate: v.scheduledDate,
        duration: v.duration ?? 60,
        visitorName: v.visitorName,
        visitorEmail: v.visitorEmail ?? "",
        visitorPhone: v.visitorPhone ?? "",
        visitorCompany: v.visitorCompany ?? "",
        purpose: v.purpose ?? "",
        status: v.status,
        orgId: v.orgId ?? "",
      }));
  },
});

export const createByStaff = mutation({
  args: {
    visitorName: v.string(),
    visitorEmail: v.optional(v.string()),
    visitorPhone: v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    purpose: v.optional(v.string()),
    hostStaffId: v.optional(v.id("staff")),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, ...rest } = args;
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: "staff",
      source: "staff",
    });
  },
});

export const createByPA = mutation({
  args: {
    visitorName: v.string(),
    visitorEmail: v.optional(v.string()),
    visitorPhone: v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    purpose: v.optional(v.string()),
    hostStaffId: v.optional(v.id("staff")),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, ...rest } = args;
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: "pa",
      source: "admin",
    });
  },
});

export const listByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const visits = await ctx.db.query("scheduledVisits").collect();
    const staffList = await ctx.db.query("staff").collect();
    return visits
      .filter(v => v.orgId === orgId)
      .map((v) => {
        const host = v.hostId ? staffList.find((s) => s._id === v.hostId) : null;
        return { ...v, hostName: host?.name ?? null };
      });
  },
});

const IN_SESSION_STATUSES = new Set(["checked_in", "in_meeting"]);
const UPCOMING_STATUSES = new Set(["pending", "approved", "accepted"]);

export const searchStaffAppointments = query({
  args: { nameQuery: v.string() },
  handler: async (ctx, { nameQuery }) => {
    const needle = nameQuery.trim().toLowerCase();
    if (!needle) return [];

    const orgId = await resolveOrgId(ctx);

    const allStaff = await ctx.db.query("staff").collect();
    const matches = allStaff.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) &&
        (!orgId || s.orgId === orgId),
    );
    if (matches.length === 0) return [];

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);

    const todaysVisits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", start.getTime()).lte("scheduledDate", end.getTime()),
      )
      .collect();

    return matches.map((staff) => {
      const staffVisits = todaysVisits.filter((v) => v.hostId === staff._id);
      return {
        staff,
        inSession: staffVisits.filter((v) => IN_SESSION_STATUSES.has(v.status)),
        upcoming: staffVisits.filter((v) => UPCOMING_STATUSES.has(v.status)),
      };
    });
  },
});