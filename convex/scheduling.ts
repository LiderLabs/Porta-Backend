import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import {
  requireAdminOrReceptionist,
  requireStaffMember,
  assertSameOrg,
} from "./authHelpers";
import type { AuthResult } from "./authHelpers";

async function withHostName(ctx: any, visit: any) {
  if (!visit.hostId) return { ...visit, hostName: null };
  const s = await ctx.db.get(visit.hostId);
  return { ...visit, hostName: s?.name ?? null };
}

// ── Shared guards ─────────────────────────────────────────────────────────────

function isAdminRole(role: string | undefined) {
  return role === "admin" || role === "superadmin";
}

/** Name to record in audit fields. Always comes from the logged-in identity. */
function actingName(auth: AuthResult) {
  return auth.staff?.name ?? (auth.identity.name as string | undefined) ?? auth.identity.email ?? "Staff";
}

/** Record a booking action in the org's activity log (shown to admins). */
async function logActivity(
  ctx: MutationCtx, auth: AuthResult, visit: Doc<"scheduledVisits">, action: string,
  extra?: { detail?: string; fromDate?: number; toDate?: number },
) {
  await ctx.db.insert("activityLog", {
    orgId: auth.orgId, visitId: visit._id, action, actorName: actingName(auth),
    targetLabel: visit.visitorName, createdAt: Date.now(), ...extra,
  });
}

/** Load a visit and make sure it belongs to the caller's org (strict: a visit with no orgId is refused). */
async function loadVisitInOrg(ctx: MutationCtx, visitId: Id<"scheduledVisits">, orgId: string) {
  const visit = await ctx.db.get(visitId);
  if (!visit) throw new Error("Visit not found");
  assertSameOrg(orgId, visit.orgId);
  return visit;
}

/** Load a staff member and make sure they belong to the caller's org. */
async function loadStaffInOrg(ctx: QueryCtx | MutationCtx, staffId: Id<"staff">, orgId: string) {
  const staff = await ctx.db.get(staffId);
  if (!staff) throw new Error("Staff member not found");
  assertSameOrg(orgId, staff.orgId);
  return staff;
}

/** Non-admins may only act on their own staff record. Admins may act on anyone in their org. */
function assertOwnStaffOrAdmin(auth: AuthResult, target: Doc<"staff">) {
  if (isAdminRole(auth.role)) return;
  if (!auth.staff || auth.staff._id !== target._id) throw new Error("Not authorized");
}

/** Resolve the staff member a clerkUserId argument points at, applying the own-record / same-org rules. */
async function staffForClerkId(ctx: QueryCtx | MutationCtx, auth: AuthResult, clerkUserId: string) {
  const isSelf = clerkUserId === auth.identity.subject;
  if (!isSelf && !isAdminRole(auth.role)) throw new Error("Not authorized");
  const target = await ctx.db
    .query("staff")
    .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
    .first();
  if (!target) return null;
  // The caller's own record is already what their org comes from. Anyone else must be in the caller's org.
  if (!isSelf) assertSameOrg(auth.orgId, target.orgId);
  return target;
}

/** Add hostName to visits by reading only the hosts those visits point at. */
async function attachHostNames<T extends { hostId?: Id<"staff"> }>(ctx: QueryCtx, visits: T[]) {
  const ids = [...new Set(visits.map((v) => v.hostId).filter((id): id is Id<"staff"> => !!id))];
  const hosts = await Promise.all(ids.map((id) => ctx.db.get(id)));
  const names = new Map<string, string | null>(ids.map((id, i) => [id, hosts[i]?.name ?? null]));
  return visits.map((v) => ({ ...v, hostName: v.hostId ? (names.get(v.hostId) ?? null) : null }));
}


// ── Public (no login) helpers ─────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Kiosk check-in window: from 2 hours before the start until 12 hours after it.
// Fixed offsets are used instead of "end of day" so the server timezone does not matter.
const CHECK_IN_EARLY_MS = 2 * HOUR;
const CHECK_IN_LATE_MS = 12 * HOUR;

function inCheckInWindow(now: number, scheduledDate: number) {
  return now >= scheduledDate - CHECK_IN_EARLY_MS && now <= scheduledDate + CHECK_IN_LATE_MS;
}

/** Find an org by its public slug. Unknown or blocked orgs resolve to null. */
async function resolvePublicOrg(ctx: QueryCtx | MutationCtx, orgSlug: string) {
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
    .first();
  if (!org || org.status === "blocked") return null;
  return org;
}

/** Tell the host their visitor has arrived. */
async function sendHostCheckInAlert(ctx: MutationCtx, visit: Doc<"scheduledVisits">, now: number) {
  if (!visit.hostId) return;
  const host = await ctx.db.get(visit.hostId);
  if (!host?.email) return;
  await ctx.scheduler.runAfter(0, internal.email.sendHostCheckInAlert, {
    to: host.email,
    hostName: host.name,
    visitorName: visit.visitorName,
    visitorCompany: visit.visitorCompany ?? undefined,
    purpose: visit.purpose ?? undefined,
    scheduledDate: visit.scheduledDate,
    checkedInAt: now,
  });
}


export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireStaffMember(ctx);
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    return attachHostNames(ctx, visits);
  },
});

/** Visits for a specific staff member — used by staff app. */
export const listByStaff = query({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const auth = await requireStaffMember(ctx);
    const staffMember = await staffForClerkId(ctx, auth, clerkUserId);
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
    const { orgId } = await requireAdminOrReceptionist(ctx);
    if (hostId) await loadStaffInOrg(ctx, hostId, orgId);

    // Only this org's staff. Blocked slots have no orgId of their own, so they are matched through their staff member.
    const orgStaff = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const staffNames = new Map<string, string>(orgStaff.map((s) => [s._id, s.name]));

    // Visits in range, this org only
    let visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", rangeStart).lte("scheduledDate", rangeEnd),
      )
      .collect();
    visits = visits.filter((v) => v.orgId === orgId);
    if (hostId) visits = visits.filter((v) => v.hostId === hostId);

    // Blocked slots in range, this org's staff only
    let blocked = await ctx.db
      .query("blockedSlots")
      .withIndex("by_startTime", (q) =>
        q.gte("startTime", rangeStart).lte("startTime", rangeEnd),
      )
      .collect();
    blocked = blocked.filter((b) => staffNames.has(b.staffId));
    if (hostId) blocked = blocked.filter((b) => b.staffId === hostId);

    const visitsWithHost = visits.map((v) => ({
      ...v,
      hostName: v.hostId ? (staffNames.get(v.hostId) ?? null) : null,
    }));
    const blockedWithName = blocked.map((b) => ({
      ...b,
      staffName: staffNames.get(b.staffId) ?? null,
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
    const { orgId } = await requireAdminOrReceptionist(ctx);
    await loadStaffInOrg(ctx, hostId, orgId);

    // Not filtered by visit.orgId: the host is in this org, and older visits created
    // before orgId was set still occupy the host's time.
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
    const auth = await requireStaffMember(ctx);
    const staffMember = await staffForClerkId(ctx, auth, clerkUserId);
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


/** Get a single visit by ID (used by booking confirmation page for live status). */
export const getById = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const visit = await ctx.db.get(visitId);
    if (!visit) return null;
    return withHostName(ctx, visit);
  },
});

/** Get all blocked slots for a staff member (used by staff app). */
export const getBlockedSlots = query({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const { orgId } = await requireStaffMember(ctx);
    await loadStaffInOrg(ctx, staffId, orgId);
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


/** Create a new scheduled visit (receptionist / admin). */
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
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const { hostStaffId, ...rest } = args;
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "pending",
      orgId,
    });
  },
});

/** Public booking from the external booking page. */
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
    orgSlug: v.string(),
    // Kiosk walk-in: this is a log book entry. Recorded at arrival time, never rejected for time or conflicts.
    walkIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, orgSlug, walkIn, ...rest } = args;
    const now = Date.now();
    const isWalkIn = walkIn === true;
    const when = isWalkIn ? now : args.scheduledDate;

    // ── Validation ──
    const org = await resolvePublicOrg(ctx, orgSlug);
    if (!org) throw new ConvexError("This booking page is not available.");

    const visitorName = args.visitorName.trim();
    if (!visitorName) throw new ConvexError("Please enter your name.");
    if (visitorName.length > 100) throw new ConvexError("Name is too long (100 characters max).");
    if ((args.purpose ?? "").length > 500) throw new ConvexError("Purpose is too long (500 characters max).");
    if ((args.notes ?? "").length > 1000) throw new ConvexError("Notes are too long (1000 characters max).");
    if ((args.visitorCompany ?? "").length > 200) throw new ConvexError("Company is too long (200 characters max).");
    if ((args.visitorPhone ?? "").length > 50) throw new ConvexError("Phone number is too long.");

    let visitorEmail: string | undefined;
    if (args.visitorEmail && args.visitorEmail.trim()) {
      visitorEmail = args.visitorEmail.toLowerCase().trim();
      if (visitorEmail.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(visitorEmail)) {
        throw new ConvexError("Please enter a valid email address.");
      }
    }

    const duration = args.duration ?? 60;
    if (!Number.isFinite(duration) || duration < 15 || duration > 240) {
      throw new ConvexError("Duration must be between 15 and 240 minutes.");
    }
    // Small grace window: a walk-in typed on a slow kiosk can land a minute or two "late"
    const GRACE_MS = 2 * MINUTE;
    if (!isWalkIn && (!Number.isFinite(args.scheduledDate) || args.scheduledDate < now - GRACE_MS)) {
      throw new ConvexError("That time has already passed. Please choose a later time.");
    }
    if (!isWalkIn && args.scheduledDate > now + 180 * DAY) {
      throw new ConvexError("Please choose a date within the next 180 days.");
    }

    // Host must belong to this org
    const host = hostStaffId ? await ctx.db.get(hostStaffId) : null;
    if (hostStaffId) {
      if (!host || host.orgId !== org._id) throw new ConvexError("That person can't be booked here.");
    }

    // Basic abuse limit: one email address can't flood us with bookings (and emails)
    if (visitorEmail) {
      const recent = await ctx.db
        .query("scheduledVisits")
        .withIndex("by_visitor_email", (q) =>
          q.eq("visitorEmail", visitorEmail).gte("_creationTime", now - DAY),
        )
        .take(6);
      if (recent.length > 5) throw new ConvexError("Too many bookings from this email address. Please try again tomorrow.");
    }

    // Conflict check — block if host already has an approved/pending visit overlapping this slot
    if (hostStaffId && !isWalkIn) {
      const newStart = args.scheduledDate;
      const newEnd = newStart + duration * MINUTE;
      const existing = await ctx.db
        .query("scheduledVisits")
        .withIndex("by_hostId", (q) => q.eq("hostId", hostStaffId))
        .collect();
      const conflict = existing.find((v) => {
        if (!["pending", "approved", "checked_in", "in_meeting"].includes(v.status)) return false;
        const vStart = v.scheduledDate;
        const vEnd = vStart + (v.duration ?? 60) * MINUTE;
        return newStart < vEnd && newEnd > vStart;
      });
      if (conflict) throw new ConvexError("That time slot is already booked for this person. Please choose a different time.");
    }

    const visitId = await ctx.db.insert("scheduledVisits", {
      ...rest,
      visitorName,
      visitorEmail,
      duration,
      hostId: hostStaffId,
      scheduledDate: when,
      status: "pending",
      source: isWalkIn ? "walkin" : "online",
      orgId: org._id,
    });

    // Send "booking received" email to visitor (only if they gave an email)
    if (visitorEmail) {
      await ctx.scheduler.runAfter(0, internal.email.sendBookingReceived, {
        to: visitorEmail,
        visitorName,
        hostName: host?.name ?? undefined,
        scheduledDate: when,
        purpose: args.purpose ?? undefined,
        visitorCompany: args.visitorCompany ?? undefined,
        notes: args.notes ?? undefined,
      });
    }

    return visitId;
  },
});

/** Any staff member approves a pending visit in their org. */
export const approve = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    // legacy arguments, ignored on purpose. Remove after the porta-app update ships.
    actorClerkId: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, { visitId }) => {
    const auth = await requireStaffMember(ctx);
    const visit = await loadVisitInOrg(ctx, visitId, auth.orgId);
    const approvedBy = actingName(auth);

    await ctx.db.patch(visitId, {
      status: "approved",
      approvedAt: Date.now(),
      approvedBy,
    });
    await logActivity(ctx, auth, visit, "APPROVED");

    // Send "booking confirmed" email to visitor
    if (visit.visitorEmail) {
      const host = visit.hostId ? await ctx.db.get(visit.hostId) : null;
      await ctx.scheduler.runAfter(0, internal.email.sendBookingConfirmed, {
        to: visit.visitorEmail,
        visitorName: visit.visitorName,
        hostName: host?.name ?? undefined,
        scheduledDate: visit.scheduledDate,
        purpose: visit.purpose ?? undefined,
        visitorCompany: visit.visitorCompany ?? undefined,
        notes: visit.notes ?? undefined,
        approvedBy,
      });
    }
  },
});


/** Reject a visit (was pending/approved). */
export const reject = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    reason: v.optional(v.string()),
    // legacy arguments, ignored on purpose. Remove after the porta-app update ships.
    actorClerkId: v.optional(v.string()),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, reason }) => {
    const auth = await requireStaffMember(ctx);
    const visit = await loadVisitInOrg(ctx, visitId, auth.orgId);
    await ctx.db.patch(visitId, {
      status: "rejected",
      cancelReason: reason,
      cancelledAt: Date.now(),
    });
    await logActivity(ctx, auth, visit, "REJECTED", { detail: reason });
  },
});


/** Visitor has arrived at reception — mark checked_in. */
export const markCheckedIn = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const visit = await ctx.db.get(visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.orgId) assertSameOrg(orgId, visit.orgId);

    const now = Date.now();
    await ctx.db.patch(visitId, { status: "checked_in", checkedInAt: now });

    // Send smart check-in alert to host
    await sendHostCheckInAlert(ctx, visit, now);
  },
});


/** Visitor is now in the meeting room. */
export const markInMeeting = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    await loadVisitInOrg(ctx, visitId, orgId);
    await ctx.db.patch(visitId, { status: "in_meeting" });
  },
});

/** Visit is done. */
export const markCompleted = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const { orgId } = await requireAdminOrReceptionist(ctx);
    await loadVisitInOrg(ctx, visitId, orgId);
    await ctx.db.patch(visitId, { status: "completed", completedAt: Date.now() });
  },
});

/** Visitor no-showed (was approved but never arrived). */
export const markNoShow = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const auth = await requireStaffMember(ctx);
    const visit = await loadVisitInOrg(ctx, visitId, auth.orgId);
    await ctx.db.patch(visitId, { status: "no_show" });
    await logActivity(ctx, auth, visit, "NO_SHOW");
  },
});

/** Cancel a visit. */
export const cancel = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, reason }) => {
    const auth = await requireAdminOrReceptionist(ctx);
    const visit = await loadVisitInOrg(ctx, visitId, auth.orgId);
    await ctx.db.patch(visitId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelReason: reason,
    });
    await logActivity(ctx, auth, visit, "CANCELLED", { detail: reason });
  },
});

/** Reschedule — update date + reset to pending. */
export const reschedule = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    scheduledDate: v.number(),
    duration: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, scheduledDate, duration, notes }) => {
    const auth = await requireStaffMember(ctx);
    const existing = await loadVisitInOrg(ctx, visitId, auth.orgId);
    await ctx.db.patch(visitId, {
      scheduledDate,
      duration,
      notes,
      status: "pending",
      rescheduledFrom: existing.scheduledDate,
    });
    await logActivity(ctx, auth, existing, "RESCHEDULED", { fromDate: existing.scheduledDate, toDate: scheduledDate });
  },
});

/** Edit the details of a booking (visitor, purpose, notes, length). Date changes go through reschedule. */
export const update = mutation({
  args: {
    visitId: v.id("scheduledVisits"),
    visitorName: v.optional(v.string()),
    visitorPhone: v.optional(v.string()),
    visitorEmail: v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    purpose: v.optional(v.string()),
    notes: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: async (ctx, { visitId, ...fields }) => {
    const auth = await requireAdminOrReceptionist(ctx);
    const visit = await loadVisitInOrg(ctx, visitId, auth.orgId);
    if (fields.visitorName !== undefined && !fields.visitorName.trim()) throw new ConvexError("Visitor name can't be empty");
    if (fields.duration !== undefined && (!Number.isFinite(fields.duration) || fields.duration < 5 || fields.duration > 600)) {
      throw new ConvexError("Duration must be between 5 and 600 minutes");
    }
    const LABELS: Record<string, string> = {
      visitorName: "Name", visitorPhone: "Phone", visitorEmail: "Email", visitorCompany: "Company",
      purpose: "Purpose", notes: "Notes", duration: "Duration",
    };
    const patch: Record<string, any> = {};
    const changes: string[] = [];
    for (const [k, raw] of Object.entries(fields)) {
      if (raw === undefined) continue;
      const next = typeof raw === "string" ? raw.trim() : raw;
      const prev = (visit as any)[k];
      if ((prev ?? "") === (next ?? "")) continue;
      patch[k] = typeof next === "string" && next === "" ? undefined : next;
      changes.push(`${LABELS[k]}: ${prev ?? "empty"} -> ${next === "" ? "empty" : next}`);
    }
    if (changes.length === 0) return;
    await ctx.db.patch(visitId, patch);
    await logActivity(ctx, auth, visit, "EDITED", { detail: changes.join("; ") });
  },
});

/** Hard delete. */
export const remove = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const auth = await requireAdminOrReceptionist(ctx);
    const visit = await ctx.db.get(visitId);
    if (!visit) return;
    if (visit.orgId) assertSameOrg(auth.orgId, visit.orgId);
    await logActivity(ctx, auth, visit, "DELETED");
    await ctx.db.delete(visitId);
  },
});


/** Block a time slot for a staff member.
 *  This immediately propagates to all booking page subscribers.
 *  Non-admins can only block their own slots. */
export const blockSlot = mutation({
  args: {
    staffId: v.id("staff"),
    startTime: v.number(),
    endTime: v.number(),
    reason: v.optional(v.string()),
    // legacy argument, ignored on purpose. Remove after the porta-app update ships.
    createdByClerkId: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, startTime, endTime, reason }) => {
    const auth = await requireStaffMember(ctx);
    const target = await loadStaffInOrg(ctx, staffId, auth.orgId);
    assertOwnStaffOrAdmin(auth, target);
    return await ctx.db.insert("blockedSlots", {
      staffId,
      startTime,
      endTime,
      reason,
      createdByClerkId: auth.identity.subject,
      createdAt: Date.now(),
    });
  },
});

/** Remove a blocked slot. Non-admins can only remove their own. */
export const unblockSlot = mutation({
  args: { slotId: v.id("blockedSlots") },
  handler: async (ctx, { slotId }) => {
    const auth = await requireStaffMember(ctx);
    const slot = await ctx.db.get(slotId);
    if (!slot) return;
    const target = await loadStaffInOrg(ctx, slot.staffId, auth.orgId);
    assertOwnStaffOrAdmin(auth, target);
    await ctx.db.delete(slotId);
  },
});

/** Set a staff member's live availability status (reception / admin). */
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
    const { orgId } = await requireAdminOrReceptionist(ctx);
    const staffMember = await ctx.db
      .query("staff")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
    if (!staffMember) throw new Error("Staff member not found");
    assertSameOrg(orgId, staffMember.orgId);
    await ctx.db.patch(staffMember._id, { availability });
  },
});

/** Future blocked slots for one org's staff — used by the public booking page.
 *  Times only: the private reason text is never returned. */
export const listAllBlockedSlots = query({
  args: {
    // Optional only while the booking page is switched over; without it nothing is returned.
    orgSlug: v.optional(v.string()),
  },
  handler: async (ctx, { orgSlug }) => {
    if (!orgSlug) return [];
    const org = await resolvePublicOrg(ctx, orgSlug);
    if (!org) return [];
    const orgStaff = await ctx.db
      .query("staff")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    const now = Date.now();
    const perStaff = await Promise.all(
      orgStaff.map((s) =>
        ctx.db.query("blockedSlots").withIndex("by_staff", (q) => q.eq("staffId", s._id)).collect(),
      ),
    );
    return perStaff
      .flat()
      .filter((s) => s.endTime >= now)
      .map((s) => ({
        _id: s._id,
        staffId: s.staffId,
        startTime: s.startTime,
        endTime: s.endTime,
        date: new Date(s.startTime).toISOString().split("T")[0],
        startTimeStr: new Date(s.startTime).toTimeString().slice(0, 5),
        endTimeStr: new Date(s.endTime).toTimeString().slice(0, 5),
      }));
  },
});

/** Busy times for one org — used by the public booking page for clash detection.
 *  Replaces listApprovedVisits. Returns no visitor details at all. */
export const listBusyTimes = query({
  args: { orgSlug: v.string() },
  handler: async (ctx, { orgSlug }) => {
    const org = await resolvePublicOrg(ctx, orgSlug);
    if (!org) return [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    return visits
      .filter(
        (v) =>
          v.hostId &&
          v.scheduledDate >= todayStart.getTime() &&
          ["approved", "checked_in", "in_meeting", "accepted"].includes(v.status),
      )
      .map((v) => ({
        hostId: v.hostId!,
        scheduledDate: v.scheduledDate,
        duration: v.duration ?? 60,
      }));
  },
});

/** Kiosk lookup: the visitor types their email and finds their own booking.
 *  Exact email match, inside the check-in window, approved or accepted only, minimal fields. */
export const findMyVisit = query({
  args: { orgSlug: v.string(), email: v.string() },
  handler: async (ctx, { orgSlug, email }) => {
    const wanted = email.toLowerCase().trim();
    if (!wanted || wanted.length > 254) return [];
    const org = await resolvePublicOrg(ctx, orgSlug);
    if (!org) return [];
    const now = Date.now();
    const candidates = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", now - CHECK_IN_LATE_MS).lte("scheduledDate", now + CHECK_IN_EARLY_MS),
      )
      .collect();
    const matches = candidates
      .filter(
        (v) =>
          v.orgId === org._id &&
          ["approved", "accepted"].includes(v.status) &&
          v.visitorEmail?.toLowerCase().trim() === wanted,
      )
      .slice(0, 5);
    const withHosts = await attachHostNames(ctx, matches);
    return withHosts.map((v) => ({
      _id: v._id,
      visitorName: v.visitorName,
      scheduledDate: v.scheduledDate,
      hostName: v.hostName,
    }));
  },
});

/** Kiosk check-in without a login. Only works for an approved/accepted visit,
 *  inside the check-in window. Safe to call twice: the second call changes nothing and sends no email.
 *  Once the kiosk uses this, markCheckedIn stays reception-only. */
export const selfCheckIn = mutation({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const visit = await ctx.db.get(visitId);
    if (!visit) throw new Error("Visit not found");
    if (visit.status === "checked_in") return { alreadyCheckedIn: true };
    if (visit.status !== "approved" && visit.status !== "accepted") {
      throw new Error("This visit can't be checked in. Please see reception.");
    }
    const now = Date.now();
    if (!inCheckInWindow(now, visit.scheduledDate)) {
      throw new Error("It isn't time to check in for this visit yet. Please see reception.");
    }
    await ctx.db.patch(visitId, { status: "checked_in", checkedInAt: now });
    await sendHostCheckInAlert(ctx, visit, now);
    return { alreadyCheckedIn: false };
  },
});

/** DEPRECATED: returns every org's visitor details to anyone. Replaced by listBusyTimes / findMyVisit.
 *  Delete once porta-booking (BookingPage and KioskPage) has switched. */
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
/** Create a visit directly by staff member - auto-approved, no approval needed. */
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
    const { orgId } = await requireStaffMember(ctx);
    const { hostStaffId, ...rest } = args;
    if (hostStaffId) await loadStaffInOrg(ctx, hostStaffId, orgId);
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: "staff",
      source: "staff",
      orgId,
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
    const { orgId, role } = await requireStaffMember(ctx);
    if (role !== "pa" && !isAdminRole(role)) throw new Error("Not authorized");
    const { hostStaffId, ...rest } = args;
    if (hostStaffId) await loadStaffInOrg(ctx, hostStaffId, orgId);
    return await ctx.db.insert("scheduledVisits", {
      ...rest,
      hostId: hostStaffId,
      status: "approved",
      approvedAt: Date.now(),
      approvedBy: "pa",
      source: "admin",
      orgId,
    });
  },
});


/** Visits for the caller's org. The orgId argument is ignored: the org always comes from the login. */
export const listByOrg = query({
  args: {
    // legacy argument, ignored on purpose. Remove after the porta-app update ships.
    orgId: v.optional(v.string()),
  },
  handler: async (ctx) => {
    const { orgId } = await requireStaffMember(ctx);
    const visits = await ctx.db
      .query("scheduledVisits")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return attachHostNames(ctx, visits);
  },
});