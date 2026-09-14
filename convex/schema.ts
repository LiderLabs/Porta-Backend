import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const VISIT_STATUS = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("checked_in"),
  v.literal("in_meeting"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("no_show"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("rescheduled"),
);

export default defineSchema({
  users: defineTable({
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("admin"), v.literal("receptionist"), v.literal("employee"),
      v.literal("superadmin"), v.literal("dept_head"), v.literal("pa"),
    ),
    department: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkUserId"])
    .index("by_email", ["email"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerEmail: v.string(),
    ownerName: v.optional(v.string()),
    ownerPhone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    taxId: v.optional(v.string()),
    adminNotes: v.optional(v.string()),
    maxUsers: v.optional(v.string()),
    maxLocations: v.optional(v.string()),
    bookingRules: v.optional(v.object({
      idRequired:       v.boolean(),
      photoRequired:    v.boolean(),
      approvalRequired: v.boolean(),
      walkInEnabled:    v.boolean(),
    })),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise"), v.literal("custom")),
    status: v.union(v.literal("active"), v.literal("blocked"), v.literal("suspended"), v.literal("trial")),
    features: v.object({
      checkInEnabled:           v.boolean(),
      badgesEnabled:            v.boolean(),
      schedulingEnabled:        v.boolean(),
      messagingEnabled:         v.boolean(),
      analyticsEnabled:         v.boolean(),
      notificationsEnabled:     v.boolean(),
      attendanceEnabled:        v.boolean(),
      multiLocationEnabled:     v.boolean(),
      apiAccessEnabled:         v.optional(v.boolean()),
      ssoEnabled:               v.optional(v.boolean()),
      whitelabelEnabled:        v.optional(v.boolean()),
      dedicatedSupportEnabled:  v.optional(v.boolean()),
    }),
    trialEndsAt:    v.optional(v.number()),
    blockedReason:  v.optional(v.string()),
    createdAt:      v.number(),
    lastActiveAt:   v.optional(v.number()),
    setupComplete:  v.optional(v.boolean()),
  })
    .index("by_slug",   ["slug"])
    .index("by_status", ["status"])
    .index("by_plan",   ["plan"]),

  departments: defineTable({
    name:        v.string(),
    description: v.optional(v.string()),
    headStaffId: v.optional(v.id("staff")),
    color:       v.optional(v.string()),
    officeHours: v.optional(v.object({
      monday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      tuesday:   v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      wednesday: v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      thursday:  v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      friday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      saturday:  v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
      sunday:    v.optional(v.object({ open: v.string(), close: v.string(), enabled: v.boolean() })),
    })),
    orgId:     v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_name", ["name"]).index("by_org", ["orgId"]),

  invites: defineTable({
    name:             v.string(),
    email:            v.string(),
    role:             v.union(v.literal("admin"), v.literal("receptionist"), v.literal("employee"), v.literal("dept_head"), v.literal("pa"), v.literal("superadmin")),
    department:       v.optional(v.string()),
    token:            v.string(),
    status:           v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("revoked")),
    invitedByClerkId: v.string(),
    invitedByName:    v.string(),
    expiresAt:        v.number(),
    acceptedAt:       v.optional(v.number()),
    clerkInviteId:    v.optional(v.string()),
    createdAt:        v.number(),
    orgId:            v.optional(v.string()),
  })
    .index("by_token",  ["token"])
    .index("by_email",  ["email"])
    .index("by_status", ["status"]),

  blacklist: defineTable({
    fullName:       v.optional(v.string()),
    email:          v.optional(v.string()),
    phone:          v.optional(v.string()),
    reason:         v.string(),
    addedByClerkId: v.string(),
    addedByName:    v.string(),
    active:         v.boolean(),
    createdAt:      v.number(),
  })
    .index("by_email",  ["email"])
    .index("by_active", ["active"]),

  planDefinitions: defineTable({
    planId:      v.string(),
    name:        v.string(),
    desc:        v.optional(v.string()),
    price:       v.number(),
    annualPrice: v.number(),
    maxUsers:    v.number(),
    maxLocations:v.number(),
    color:       v.optional(v.string()),
    features: v.object({
      checkInEnabled:          v.boolean(),
      badgesEnabled:           v.boolean(),
      schedulingEnabled:       v.boolean(),
      messagingEnabled:        v.boolean(),
      analyticsEnabled:        v.boolean(),
      notificationsEnabled:    v.boolean(),
      attendanceEnabled:       v.boolean(),
      multiLocationEnabled:    v.boolean(),
      apiAccessEnabled:        v.boolean(),
      ssoEnabled:              v.boolean(),
      whitelabelEnabled:       v.boolean(),
      dedicatedSupportEnabled: v.boolean(),
    }),
    sortOrder: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_planId", ["planId"]),

  auditLog: defineTable({
    action:       v.string(),
    actorClerkId: v.string(),
    actorName:    v.string(),
    targetType:   v.string(),
    targetId:     v.optional(v.string()),
    targetLabel:  v.optional(v.string()),
    detail:       v.optional(v.string()),
    createdAt:    v.number(),
  }).index("by_createdAt", ["createdAt"]),

  staff: defineTable({
    name:        v.string(),
    department:  v.optional(v.string()),
    email:       v.optional(v.string()),
    phone:       v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    orgId:       v.optional(v.string()),
    role:        v.optional(v.union(v.literal("receptionist"), v.literal("employee"), v.literal("dept_head"), v.literal("pa"), v.literal("admin"))),
    title:       v.optional(v.string()),
    avatarUrl:   v.optional(v.string()),
    status:      v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    availability: v.optional(v.union(v.literal("available"), v.literal("busy"), v.literal("away"), v.literal("off"))),
  }).index("by_org", ["orgId"]),

  visitors: defineTable({
    fullName:     v.string(),
    phone:        v.optional(v.string()),
    email:        v.optional(v.string()),
    company:      v.optional(v.string()),
    hostId:       v.optional(v.id("staff")),
    purpose:      v.optional(v.string()),
    idType:       v.optional(v.string()),
    idNumber:     v.optional(v.string()),
    photoUrl:     v.optional(v.string()),
    badgeUrl:     v.optional(v.string()),
    checkInTime:  v.number(),
    checkOutTime: v.optional(v.number()),
    status:       v.union(v.literal("IN"), v.literal("OUT")),
    scheduledVisitId: v.optional(v.id("scheduledVisits")),
  })
    .index("by_status",      ["status"])
    .index("by_checkInTime", ["checkInTime"]),

  scheduledVisits: defineTable({
    visitorName:     v.string(),
    visitorPhone:    v.optional(v.string()),
    visitorEmail:    v.optional(v.string()),
    visitorCompany:  v.optional(v.string()),
    purpose:         v.optional(v.string()),
    hostId:          v.optional(v.id("staff")),
    hostStaffId:     v.optional(v.id("staff")),
    scheduledDate:   v.number(),
    duration:        v.optional(v.number()),
    notes:           v.optional(v.string()),
    status:          VISIT_STATUS,
    createdByClerkId:v.optional(v.string()),
    reminderSent:    v.optional(v.boolean()),
    departmentId:    v.optional(v.id("departments")),
    source:          v.optional(v.union(v.literal("walkin"), v.literal("online"), v.literal("admin"), v.literal("staff"))),
    approvedAt:      v.optional(v.number()),
    approvedBy:      v.optional(v.string()),
    checkedInAt:     v.optional(v.number()),
    completedAt:     v.optional(v.number()),
    cancelledAt:     v.optional(v.number()),
    cancelReason:    v.optional(v.string()),
    rescheduledFrom: v.optional(v.number()),
    roomId:          v.optional(v.id("rooms")),
    orgId:           v.optional(v.string()),
  })
    .index("by_status",        ["status"])
    .index("by_scheduledDate", ["scheduledDate"])
    .index("by_hostId",        ["hostId"])
    .index("by_org",            ["orgId"]),

  blockedSlots: defineTable({
    staffId:     v.id("staff"),
    startTime:   v.number(),
    endTime:     v.number(),
    reason:      v.optional(v.string()),
    createdByClerkId: v.string(),
    createdAt:   v.number(),
  })
    .index("by_staff",     ["staffId"])
    .index("by_startTime", ["startTime"]),

  employeeAttendance: defineTable({
    clerkUserId:  v.string(),
    clockInTime:  v.number(),
    clockOutTime: v.optional(v.number()),
    status:       v.union(v.literal("IN"), v.literal("OUT")),
  }).index("by_employee", ["clerkUserId"]),

  notifications: defineTable({
    clerkUserId: v.string(),
    type:        v.string(),
    message:     v.string(),
    read:        v.boolean(),
    createdAt:   v.number(),
  }).index("by_user", ["clerkUserId"]),

  checkInSettings: defineTable({
    orgId:    v.optional(v.string()),
    fields: v.array(v.object({
      key:     v.string(),
      label:   v.string(),
      type:    v.string(),
      enabled: v.boolean(),
      required:v.boolean(),
      custom:  v.optional(v.boolean()),
      options: v.optional(v.array(v.string())),
    })),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  visitMessages: defineTable({
    visitId:       v.id("scheduledVisits"),
    senderClerkId: v.string(),
    senderName:    v.string(),
    senderRole:    v.string(),
    message:       v.string(),
    createdAt:     v.number(),
  }).index("by_visit", ["visitId"]),

  badgeSettings: defineTable({
    enabled:         v.boolean(),
    format:          v.union(v.literal("pdf"), v.literal("image")),
    autoSend:        v.boolean(),
    deliveryMethods: v.array(v.string()),
    updatedAt:       v.number(),
  }),

  orgSettings: defineTable({
    features: v.object({
      checkInEnabled:       v.boolean(),
      badgesEnabled:        v.boolean(),
      schedulingEnabled:    v.boolean(),
      messagingEnabled:     v.boolean(),
      analyticsEnabled:     v.boolean(),
      notificationsEnabled: v.boolean(),
      attendanceEnabled:    v.boolean(),
      multiLocationEnabled: v.boolean(),
    }),
    branding: v.optional(v.object({
      primaryColor: v.optional(v.string()),
      logoUrl:      v.optional(v.string()),
      appName:      v.optional(v.string()),
    })),
    updatedAt: v.number(),
  }),

  platformSettings: defineTable({
    trialDays:          v.number(),
    selfServeSignups:   v.boolean(),
    defaultPlan:        v.string(),
    requireEmailVerify: v.boolean(),
    apiAccessTier:      v.string(),
    ssoEnforcement:     v.string(),
    currency:           v.string(),
    annualDiscount:     v.number(),
    gracePeriodDays:    v.number(),
    maintenanceMode:    v.optional(v.boolean()),
    platformName:       v.optional(v.string()),
    supportEmail:       v.optional(v.string()),
    updatedAt:          v.optional(v.number()),
    updatedBy:          v.optional(v.string()),
  }),

  directMessages: defineTable({
    fromClerkId: v.string(),
    fromName:    v.string(),
    fromRole:    v.string(),
    toClerkId:   v.string(),
    toName:      v.string(),
    message:     v.string(),
    read:        v.boolean(),
    createdAt:   v.number(),
  })
    .index("by_to",   ["toClerkId"])
    .index("by_from", ["fromClerkId"]),

  rooms: defineTable({
    name:      v.string(),
    floor:     v.optional(v.string()),
    capacity:  v.optional(v.number()),
    amenities: v.optional(v.array(v.string())),
    status:    v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    orgId:     v.optional(v.string()),
  }).index("by_status", ["status"]),

  paAssignments: defineTable({
    paStaffId:     v.id("staff"),
    targetStaffId: v.id("staff"),
    createdAt:     v.number(),
  })
    .index("by_pa",     ["paStaffId"])
    .index("by_target", ["targetStaffId"]),
  bookingRules: defineTable({
    orgId:            v.optional(v.string()),
    approvalRequired: v.optional(v.boolean()),
    walkInEnabled:    v.optional(v.boolean()),
    blacklistEnabled: v.optional(v.boolean()),
    idRequired:       v.optional(v.boolean()),
    photoRequired:    v.optional(v.boolean()),
    qrCheckInEnabled: v.optional(v.boolean()),
    whatsappEnabled:  v.optional(v.boolean()),
    maxVisitorsPerDay:v.optional(v.number()),
    minNoticeHours:   v.optional(v.number()),
    maxAdvanceDays:   v.optional(v.number()),
    defaultDuration:  v.optional(v.number()),
    minDuration:      v.optional(v.number()),
    maxDuration:      v.optional(v.number()),
    allowedDurations: v.optional(v.array(v.number())),
    allowedPurposes:  v.optional(v.array(v.string())),
    phoneRequired:    v.optional(v.boolean()),
    emailRequired:    v.optional(v.boolean()),
    companyRequired:  v.optional(v.boolean()),
    purposeRequired:  v.optional(v.boolean()),
    updatedAt:        v.optional(v.number()),
  }),

  presence: defineTable({
    clerkUserId:  v.string(),
    lastSeen:     v.number(),
    isTypingTo:   v.optional(v.string()),
  }).index("by_clerk", ["clerkUserId"]),
});






