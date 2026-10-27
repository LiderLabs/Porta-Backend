import {
  query,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  normalizePhoneNumber,
  isSamePhoneNumber,
  formatWhatsAppDate,
  formatWhatsAppTime,
} from "./whatsappUtils";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

// ── Environment Helpers ───────────────────────────────────────────────────────

function getWhatsAppConfig() {
  const token = process.env.WA_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const wabaId = process.env.WA_WABA_ID;
  const appSecret = process.env.WA_APP_SECRET;
  const verifyToken = process.env.WA_VERIFY_TOKEN;
  const templateLang = process.env.WA_TEMPLATE_LANG ?? "en_US";
  const appUrl = process.env.PORTA_APP_URL ?? "https://porta.app";

  return {
    token,
    phoneNumberId,
    wabaId,
    appSecret,
    verifyToken,
    templateLang,
    appUrl,
    isConfigured: Boolean(token && phoneNumberId),
  };
}

// ── Queries for Frontend & Internal Use ───────────────────────────────────────

/**
 * Returns the current WhatsApp delivery/reply status for a scheduled visit.
 * Used by front end in Agenda and Appointments.
 */
export const getVisitStatus = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const visit = await ctx.db.get(visitId);
    if (!visit) return null;

    const messages = await ctx.db
      .query("whatsappMessages")
      .withIndex("by_visit", (q) => q.eq("visitId", visitId))
      .order("desc")
      .collect();

    const latest = messages[0] ?? null;

    return {
      status: visit.whatsappStatus ?? latest?.status ?? null,
      lastWamid: visit.lastWhatsappWamid ?? latest?.wamid ?? null,
      totalMessages: messages.length,
      latestMessage: latest,
    };
  },
});

/**
 * Lists all WhatsApp messages and delivery events for a given visit.
 */
export const listMessagesByVisit = query({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    return await ctx.db
      .query("whatsappMessages")
      .withIndex("by_visit", (q) => q.eq("visitId", visitId))
      .order("asc")
      .collect();
  },
});

/**
 * Checks whether a given message ID (wamid) has already been saved.
 * Used for webhook deduplication.
 */
export const internalCheckWamidProcessed = internalQuery({
  args: { wamid: v.string() },
  handler: async (ctx, { wamid }) => {
    const existing = await ctx.db
      .query("whatsappMessages")
      .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
      .first();
    return Boolean(existing);
  },
});

/**
 * Internal query to fetch full visit details alongside the host staff record.
 */
export const internalGetVisitAndHost = internalQuery({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const visit = await ctx.db.get(visitId);
    if (!visit) return null;

    const host = visit.hostId ? await ctx.db.get(visit.hostId) : null;
    return { visit, host };
  },
});

/**
 * Internal query to fetch visitor and host details for arrival alert.
 */
export const internalGetArrivalContext = internalQuery({
  args: {
    visitId: v.optional(v.id("scheduledVisits")),
    visitorId: v.optional(v.id("visitors")),
  },
  handler: async (ctx, { visitId, visitorId }) => {
    let visitorName: string | null = null;
    let visitorCompany: string | undefined = undefined;
    let host: Doc<"staff"> | null = null;
    let resolvedVisit: Doc<"scheduledVisits"> | null = null;

    if (visitId) {
      resolvedVisit = await ctx.db.get(visitId);
      if (resolvedVisit) {
        visitorName = resolvedVisit.visitorName;
        visitorCompany = resolvedVisit.visitorCompany;
        if (resolvedVisit.hostId) {
          host = await ctx.db.get(resolvedVisit.hostId);
        }
      }
    }

    if (visitorId && !visitorName) {
      const visitor = await ctx.db.get(visitorId);
      if (visitor) {
        visitorName = visitor.fullName;
        visitorCompany = visitor.company;
        if (!host && visitor.hostId) {
          host = await ctx.db.get(visitor.hostId);
        }
      }
    }

    return {
      visitorName,
      visitorCompany,
      host,
      visit: resolvedVisit,
    };
  },
});

// ── Internal Mutations for WhatsApp Data ──────────────────────────────────────

/**
 * Records an outbound message into whatsappMessages and updates the visit status.
 */
export const recordOutboundMessage = internalMutation({
  args: {
    visitId: v.optional(v.id("scheduledVisits")),
    visitorId: v.optional(v.id("visitors")),
    staffId: v.optional(v.id("staff")),
    wamid: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
      v.literal("replied")
    ),
    messageType: v.string(),
    phoneNumber: v.optional(v.string()),
    text: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("whatsappMessages", {
      visitId: args.visitId,
      visitorId: args.visitorId,
      staffId: args.staffId,
      wamid: args.wamid,
      direction: "outbound",
      status: args.status,
      messageType: args.messageType,
      phoneNumber: args.phoneNumber,
      text: args.text,
      errorMessage: args.errorMessage,
      createdAt: now,
    });

    if (args.visitId) {
      await ctx.db.patch(args.visitId, {
        whatsappStatus: args.status === "pending" ? "sent" : (args.status as any),
        lastWhatsappWamid: args.wamid,
      });
    }
  },
});

/**
 * Updates message status upon receiving delivery/read receipts from Meta webhook.
 */
export const recordStatusUpdate = internalMutation({
  args: {
    wamid: v.string(),
    status: v.string(),
    timestamp: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { wamid, status, errorMessage }) => {
    const message = await ctx.db
      .query("whatsappMessages")
      .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
      .first();

    if (!message) {
      console.warn(`[WhatsApp] Status update for unknown wamid: ${wamid}`);
      return;
    }

    const validStatus = (["sent", "delivered", "read", "failed"].includes(status)
      ? status
      : "sent") as "sent" | "delivered" | "read" | "failed";

    await ctx.db.patch(message._id, {
      status: validStatus,
      errorMessage: errorMessage ?? message.errorMessage,
      updatedAt: Date.now(),
    });

    if (message.visitId) {
      await ctx.db.patch(message.visitId, {
        whatsappStatus: validStatus,
      });
    }
  },
});

/**
 * Handles an inbound reply from the host (quick-reply button or text).
 * Authenticates sender phone number against host staff phone.
 */
export const handleHostReply = internalMutation({
  args: {
    wamid: v.string(),
    senderPhone: v.string(),
    payload: v.string(),
    buttonText: v.optional(v.string()),
  },
  handler: async (ctx, { wamid, senderPhone, payload, buttonText }) => {
    // Payload format: "visitId|action" (e.g. "k17...|accept")
    const parts = payload.split("|");
    if (parts.length < 2) {
      console.warn(`[WhatsApp] Invalid button payload format: ${payload}`);
      return;
    }

    const [visitIdStr, rawAction] = parts;
    const action = rawAction.toLowerCase().trim();
    const visitId = visitIdStr as Id<"scheduledVisits">;

    const visit = await ctx.db.get(visitId);
    if (!visit) {
      console.warn(`[WhatsApp] Visit not found for reply payload: ${visitIdStr}`);
      return;
    }

    if (!visit.hostId) {
      console.warn(`[WhatsApp] Visit ${visitId} has no host assigned.`);
      return;
    }

    const host = await ctx.db.get(visit.hostId);
    if (!host || !host.phone) {
      console.warn(`[WhatsApp] Host not found or has no phone for visit ${visitId}`);
      return;
    }

    // ── Security Check: Verify sender phone matches host phone ───────────────
    if (!isSamePhoneNumber(senderPhone, host.phone)) {
      console.error(
        `[WhatsApp Auth Failed] Reply from phone ${senderPhone} does not match host phone ${host.phone} for visit ${visitId}`
      );
      await ctx.db.insert("whatsappMessages", {
        visitId,
        staffId: host._id,
        wamid,
        direction: "inbound",
        status: "failed",
        messageType: "button_reply",
        phoneNumber: senderPhone,
        buttonPayload: payload,
        errorMessage: "Unauthorized sender phone number mismatch",
        createdAt: Date.now(),
      });
      return;
    }

    // Record the verified inbound reply
    await ctx.db.insert("whatsappMessages", {
      visitId,
      staffId: host._id,
      wamid,
      direction: "inbound",
      status: "replied",
      messageType: "button_reply",
      phoneNumber: senderPhone,
      buttonPayload: payload,
      text: buttonText,
      createdAt: Date.now(),
    });

    await ctx.db.patch(visitId, {
      whatsappStatus: "replied",
      lastWhatsappWamid: wamid,
    });

    const now = Date.now();
    const config = getWhatsAppConfig();

    // ── Handle Action ─────────────────────────────────────────────────────────
    if (action === "accept") {
      // Ignore if no longer pending
      if (visit.status !== "pending") {
        console.log(`[WhatsApp] Visit ${visitId} already has status '${visit.status}'. Ignoring accept.`);
        return;
      }

      await ctx.db.patch(visitId, {
        status: "approved",
        approvedAt: now,
        approvedBy: `${host.name} (via WhatsApp)`,
      });

      if (visit.orgId) {
        await ctx.db.insert("activityLog", {
          orgId: visit.orgId,
          visitId: visit._id,
          action: "APPROVED",
          actorName: host.name,
          targetLabel: visit.visitorName,
          createdAt: now,
          detail: "Approved via WhatsApp quick reply",
        });
      }

      // Notify receptionist via in-app visit message
      await ctx.db.insert("visitMessages", {
        visitId,
        senderClerkId: host.clerkUserId ?? "whatsapp",
        senderName: host.name,
        senderRole: host.role ?? "host",
        message: "Host accepted the visit request via WhatsApp.",
        createdAt: now,
      });

      // Send visitor email confirmation if visitor email exists
      if (visit.visitorEmail) {
        await ctx.scheduler.runAfter(0, internal.email.sendBookingConfirmed, {
          to: visit.visitorEmail,
          visitorName: visit.visitorName,
          hostName: host.name,
          scheduledDate: visit.scheduledDate,
          purpose: visit.purpose ?? undefined,
          visitorCompany: visit.visitorCompany ?? undefined,
          notes: visit.notes ?? undefined,
          approvedBy: host.name,
        });
      }

      // Send confirmation WhatsApp message back to host in open 24h window
      const dateStr = formatWhatsAppDate(visit.scheduledDate);
      const timeStr = formatWhatsAppTime(visit.scheduledDate);
      const confirmText = `✅ You have accepted the visit request for *${visit.visitorName}* on ${dateStr} at ${timeStr}.`;
      await ctx.scheduler.runAfter(0, internal.whatsapp.sendTextMessage, {
        to: senderPhone,
        text: confirmText,
        visitId,
        staffId: host._id,
      });
    } else if (action === "decline") {
      // Ignore if no longer pending or approved
      if (visit.status !== "pending" && visit.status !== "approved") {
        console.log(`[WhatsApp] Visit ${visitId} has status '${visit.status}'. Ignoring decline.`);
        return;
      }

      await ctx.db.patch(visitId, {
        status: "rejected",
        cancelledAt: now,
        cancelReason: "Declined by host via WhatsApp",
      });

      if (visit.orgId) {
        await ctx.db.insert("activityLog", {
          orgId: visit.orgId,
          visitId: visit._id,
          action: "REJECTED",
          actorName: host.name,
          targetLabel: visit.visitorName,
          createdAt: now,
          detail: "Declined via WhatsApp quick reply",
        });
      }

      // Notify receptionist via in-app visit message
      await ctx.db.insert("visitMessages", {
        visitId,
        senderClerkId: host.clerkUserId ?? "whatsapp",
        senderName: host.name,
        senderRole: host.role ?? "host",
        message: "Host declined the visit request via WhatsApp.",
        createdAt: now,
      });

      // Send confirmation WhatsApp message back to host
      const declineText = `❌ You have declined the visit request for *${visit.visitorName}*. Reception has been notified.`;
      await ctx.scheduler.runAfter(0, internal.whatsapp.sendTextMessage, {
        to: senderPhone,
        text: declineText,
        visitId,
        staffId: host._id,
      });
    } else if (action === "reschedule") {
      // Notify receptionist via in-app visit message
      await ctx.db.insert("visitMessages", {
        visitId,
        senderClerkId: host.clerkUserId ?? "whatsapp",
        senderName: host.name,
        senderRole: host.role ?? "host",
        message: "Host requested to reschedule the visit via WhatsApp.",
        createdAt: now,
      });

      // Send reschedule options/link back to host in open 24h window
      const rescheduleUrl = `${config.appUrl}/appointments?reschedule=${visitId}`;
      const rescheduleMsg =
        `🔄 *Reschedule Request Received*\n\n` +
        `To reschedule your meeting with *${visit.visitorName}*, please open the Porta link below to select a new time slot:\n` +
        `${rescheduleUrl}`;

      await ctx.scheduler.runAfter(0, internal.whatsapp.sendTextMessage, {
        to: senderPhone,
        text: rescheduleMsg,
        visitId,
        staffId: host._id,
      });
    } else {
      console.warn(`[WhatsApp] Unrecognized action '${action}' in payload: ${payload}`);
    }
  },
});

// ── Outbound Send Actions ─────────────────────────────────────────────────────

/**
 * Outbound Send 1: Visit request template message to host.
 * Template: "visit_request" with parameters {{1}}..{{5}} and 3 quick-reply buttons.
 * Falls back to email if send fails or phone is unavailable.
 */
export const sendHostRequest = internalAction({
  args: { visitId: v.id("scheduledVisits") },
  handler: async (ctx, { visitId }) => {
    const data = await ctx.runQuery(internal.whatsapp.internalGetVisitAndHost, { visitId });
    if (!data || !data.visit) {
      console.warn(`[WhatsApp] Visit ${visitId} not found for sendHostRequest.`);
      return;
    }

    const { visit, host } = data;
    if (!host) {
      console.log(`[WhatsApp] No host assigned for visit ${visitId}. Skipping send.`);
      return;
    }

    // Normalise host phone number
    const normalizedPhone = normalizePhoneNumber(host.phone);

    // Fallback helper for email
    const triggerEmailFallback = async (reason: string) => {
      console.log(`[WhatsApp] Falling back to email for host ${host.name} (${reason})`);
      if (host.email) {
        await ctx.scheduler.runAfter(0, internal.email.sendHostVisitRequestAlert, {
          to: host.email,
          hostName: host.name,
          visitorName: visit.visitorName,
          visitorCompany: visit.visitorCompany ?? undefined,
          purpose: visit.purpose ?? undefined,
          scheduledDate: visit.scheduledDate,
          notes: visit.notes ?? undefined,
          visitId: String(visitId),
        });
      }
    };

    if (!normalizedPhone) {
      console.warn(`[WhatsApp] Host ${host.name} has no valid phone number. Recording failed.`);
      await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
        visitId,
        staffId: host._id,
        wamid: `failed_${Date.now()}`,
        status: "failed",
        messageType: "visit_request",
        errorMessage: "Host has no valid phone number",
      });
      await triggerEmailFallback("No valid phone number");
      return;
    }

    const config = getWhatsAppConfig();
    if (!config.isConfigured) {
      console.warn("[WhatsApp] WhatsApp API credentials not configured (WA_TOKEN / WA_PHONE_NUMBER_ID). Falling back to email.");
      await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
        visitId,
        staffId: host._id,
        wamid: `unconfigured_${Date.now()}`,
        status: "failed",
        messageType: "visit_request",
        phoneNumber: normalizedPhone,
        errorMessage: "WhatsApp API credentials not configured",
      });
      await triggerEmailFallback("WhatsApp API unconfigured");
      return;
    }

    // Build Meta template payload
    const visitorCompany = visit.visitorCompany?.trim() || "Guest";
    const dateStr = formatWhatsAppDate(visit.scheduledDate);
    const timeStr = formatWhatsAppTime(visit.scheduledDate);
    const purpose = visit.purpose?.trim() || "Scheduled Visit";

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "template",
      template: {
        name: "visit_request",
        language: { code: config.templateLang },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: visit.visitorName },
              { type: "text", text: visitorCompany },
              { type: "text", text: dateStr },
              { type: "text", text: timeStr },
              { type: "text", text: purpose },
            ],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "0",
            parameters: [{ type: "payload", payload: `${visitId}|accept` }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "1",
            parameters: [{ type: "payload", payload: `${visitId}|reschedule` }],
          },
          {
            type: "button",
            sub_type: "quick_reply",
            index: "2",
            parameters: [{ type: "payload", payload: `${visitId}|decline` }],
          },
        ],
      },
    };

    try {
      const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const resBody = await res.json() as {
        messages?: [{ id: string }];
        error?: { message: string; code: number };
      };

      if (!res.ok || !resBody.messages?.[0]?.id) {
        const errorMsg = resBody.error?.message ?? `Meta API responded with HTTP ${res.status}`;
        console.error(`[WhatsApp] Send failed for visit ${visitId}:`, errorMsg);
        await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
          visitId,
          staffId: host._id,
          wamid: `err_${Date.now()}`,
          status: "failed",
          messageType: "visit_request",
          phoneNumber: normalizedPhone,
          errorMessage: errorMsg,
        });
        await triggerEmailFallback(errorMsg);
        return;
      }

      const wamid = resBody.messages[0].id;
      console.log(`[WhatsApp] Sent visit_request successfully for visit ${visitId}. wamid: ${wamid}`);
      await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
        visitId,
        staffId: host._id,
        wamid,
        status: "sent",
        messageType: "visit_request",
        phoneNumber: normalizedPhone,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WhatsApp] Network or execution error sending request for ${visitId}:`, errorMsg);
      await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
        visitId,
        staffId: host._id,
        wamid: `err_${Date.now()}`,
        status: "failed",
        messageType: "visit_request",
        phoneNumber: normalizedPhone,
        errorMessage: errorMsg,
      });
      await triggerEmailFallback(errorMsg);
    }
  },
});

/**
 * Outbound Send 2: Visitor arrived at reception alert to host.
 * Template: "visitor_arrived" with parameter {{1}} (visitorName).
 */
export const sendHostArrivalAlert = internalAction({
  args: {
    visitId: v.optional(v.id("scheduledVisits")),
    visitorId: v.optional(v.id("visitors")),
    now: v.number(),
  },
  handler: async (ctx, { visitId, visitorId }) => {
    const data = await ctx.runQuery(internal.whatsapp.internalGetArrivalContext, {
      visitId,
      visitorId,
    });

    if (!data || !data.host || !data.visitorName) {
      console.log("[WhatsApp] No host or visitor details for arrival alert. Skipping.");
      return;
    }

    const { host, visitorName } = data;
    const normalizedPhone = normalizePhoneNumber(host.phone);
    if (!normalizedPhone) {
      console.log(`[WhatsApp] Host ${host.name} has no valid phone for arrival alert.`);
      return;
    }

    const config = getWhatsAppConfig();
    if (!config.isConfigured) {
      console.log("[WhatsApp] WhatsApp API unconfigured for arrival alert.");
      return;
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "template",
      template: {
        name: "visitor_arrived",
        language: { code: config.templateLang },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: visitorName }],
          },
        ],
      },
    };

    try {
      const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const resBody = await res.json() as {
        messages?: [{ id: string }];
        error?: { message: string };
      };

      if (!res.ok || !resBody.messages?.[0]?.id) {
        console.error("[WhatsApp] Arrival alert send failed:", resBody.error?.message);
        return;
      }

      const wamid = resBody.messages[0].id;
      console.log(`[WhatsApp] Sent arrival alert for ${visitorName}. wamid: ${wamid}`);
      await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
        visitId,
        visitorId,
        staffId: host._id,
        wamid,
        status: "sent",
        messageType: "visitor_arrived",
        phoneNumber: normalizedPhone,
      });
    } catch (err) {
      console.error("[WhatsApp] Error sending arrival alert:", err);
    }
  },
});

/**
 * Free-text message inside the 24-hour customer window.
 */
export const sendTextMessage = internalAction({
  args: {
    to: v.string(),
    text: v.string(),
    visitId: v.optional(v.id("scheduledVisits")),
    staffId: v.optional(v.id("staff")),
  },
  handler: async (ctx, { to, text, visitId, staffId }) => {
    const normalizedPhone = normalizePhoneNumber(to);
    if (!normalizedPhone) return;

    const config = getWhatsAppConfig();
    if (!config.isConfigured) return;

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedPhone,
      type: "text",
      text: { body: text },
    };

    try {
      const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const resBody = await res.json() as {
        messages?: [{ id: string }];
      };

      if (res.ok && resBody.messages?.[0]?.id) {
        const wamid = resBody.messages[0].id;
        await ctx.runMutation(internal.whatsapp.recordOutboundMessage, {
          visitId,
          staffId,
          wamid,
          status: "sent",
          messageType: "text",
          phoneNumber: normalizedPhone,
          text,
        });
      }
    } catch (err) {
      console.error("[WhatsApp] Error sending free text message:", err);
    }
  },
});

// ── Webhook Async Processing ──────────────────────────────────────────────────

/**
 * Background processor for incoming Meta webhook payloads.
 * Handles deduplication, status updates, and inbound messages.
 */
export const processIncomingWebhook = internalAction({
  args: { rawBody: v.string() },
  handler: async (ctx, { rawBody }) => {
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error("[WhatsApp] Failed to parse webhook JSON:", err);
      return;
    }

    if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
      return;
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages" || !change.value) continue;

        const value = change.value;

        // 1. Handle Delivery / Read Status Receipts
        if (Array.isArray(value.statuses)) {
          for (const statusObj of value.statuses) {
            const wamid = statusObj.id;
            const status = statusObj.status; // "sent" | "delivered" | "read" | "failed"
            const errorMessage = statusObj.errors?.[0]?.title ?? statusObj.errors?.[0]?.message;

            await ctx.runMutation(internal.whatsapp.recordStatusUpdate, {
              wamid,
              status,
              timestamp: statusObj.timestamp,
              errorMessage,
            });
          }
        }

        // 2. Handle Inbound Messages & Quick-Reply Buttons
        if (Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            const wamid = msg.id;
            const senderPhone = msg.from;

            // Deduplicate: check if this message was already handled
            const alreadyProcessed = await ctx.runQuery(
              internal.whatsapp.internalCheckWamidProcessed,
              { wamid }
            );

            if (alreadyProcessed) {
              console.log(`[WhatsApp] Skipping already processed message ${wamid}`);
              continue;
            }

            let buttonPayload: string | undefined;
            let buttonText: string | undefined;

            // Template Quick-Reply Button response
            if (msg.type === "button" && msg.button) {
              buttonPayload = msg.button.payload;
              buttonText = msg.button.text;
            }
            // Interactive button reply response
            else if (msg.type === "interactive" && msg.interactive?.button_reply) {
              buttonPayload = msg.interactive.button_reply.id;
              buttonText = msg.interactive.button_reply.title;
            }

            if (buttonPayload) {
              await ctx.runMutation(internal.whatsapp.handleHostReply, {
                wamid,
                senderPhone,
                payload: buttonPayload,
                buttonText,
              });
            } else if (msg.type === "text" && msg.text?.body) {
              // Free-text reply from host
              console.log(`[WhatsApp] Received free-text message from ${senderPhone}: ${msg.text.body}`);
            }
          }
        }
      }
    }
  },
});
