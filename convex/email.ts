import { action } from "./_generated/server";
import { v } from "convex/values";

// ── Shared email sender ───────────────────────────────────────────────────────
async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");

  const fromEmail = process.env.FROM_EMAIL ?? "noreply@porta.app";
  const fromName  = process.env.FROM_NAME  ?? "Porta";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from:    `${fromName} <${fromEmail}>`,
      to:      [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.json() as { message?: string };
    throw new Error(err.message ?? "Failed to send email");
  }

  return await res.json();
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
  });
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

// ── Email 1: Booking received (sent immediately when visitor books) ────────────
export const sendBookingReceived = action({
  args: {
    to:             v.string(),   // visitor email
    visitorName:    v.string(),
    hostName:       v.optional(v.string()),
    scheduledDate:  v.number(),   // epoch ms
    purpose:        v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    notes:          v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const dateStr = formatDate(args.scheduledDate);
    const timeStr = formatTime(args.scheduledDate);

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d0d7de;">

        <!-- Header -->
        <tr>
          <td style="background:#45ba50;padding:28px 36px;text-align:center;">
            <div style="display:inline-block;width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:10px;line-height:44px;font-size:24px;font-weight:900;color:#fff;margin-bottom:10px;">P</div>
            <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:4px;">Booking Received</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">We've got your visit request</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 20px;font-size:16px;color:#1f2328;">Hi <strong>${args.visitorName}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#656d76;line-height:1.6;">
              Your visit request has been received and is currently <strong style="color:#d29922;">pending review</strong>.
              Our team will confirm it shortly — you'll get another email once it's approved.
            </p>

            <!-- Details card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;border-radius:10px;border:1px solid #d0d7de;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <div style="font-size:11px;font-weight:700;color:#9ba3ac;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px;">Visit Details</div>
                ${row("📅 Date", dateStr)}
                ${row("🕐 Time", timeStr)}
                ${args.hostName    ? row("👤 Host",    args.hostName)    : ""}
                ${args.purpose     ? row("📋 Purpose", args.purpose)     : ""}
                ${args.visitorCompany ? row("🏢 Company", args.visitorCompany) : ""}
                ${args.notes       ? row("📝 Notes",   args.notes)       : ""}
              </td></tr>
            </table>

            <p style="margin:0 0 8px;font-size:14px;color:#656d76;line-height:1.6;">
              If you need to make any changes or have questions, please contact the reception desk directly.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f6f8fa;padding:18px 36px;border-top:1px solid #d0d7de;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ba3ac;">Sent by <strong>Porta</strong> · Visit Management System</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await sendEmail({
      to:      args.to,
      subject: `📋 Booking received — ${dateStr} at ${timeStr}`,
      html,
    });

    return { success: true };
  },
});

// ── Email 2: Booking confirmed (sent when receptionist approves) ───────────────
export const sendBookingConfirmed = action({
  args: {
    to:             v.string(),
    visitorName:    v.string(),
    hostName:       v.optional(v.string()),
    scheduledDate:  v.number(),
    purpose:        v.optional(v.string()),
    visitorCompany: v.optional(v.string()),
    notes:          v.optional(v.string()),
    approvedBy:     v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const dateStr = formatDate(args.scheduledDate);
    const timeStr = formatTime(args.scheduledDate);

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d0d7de;">

        <!-- Header -->
        <tr>
          <td style="background:#1a7f37;padding:28px 36px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">✅</div>
            <div style="font-size:22px;font-weight:800;color:#ffffff;">Visit Confirmed!</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">Your booking has been approved</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 20px;font-size:16px;color:#1f2328;">Hi <strong>${args.visitorName}</strong>,</p>
            <p style="margin:0 0 24px;font-size:15px;color:#656d76;line-height:1.6;">
              Great news — your visit has been <strong style="color:#1a7f37;">approved</strong>!
              Please make sure to arrive on time and report to reception when you get here.
            </p>

            <!-- Confirmed details card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf2;border-radius:10px;border:1px solid #a8ddb5;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <div style="font-size:11px;font-weight:700;color:#2da44e;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px;">Confirmed Visit Details</div>
                ${row("📅 Date",    dateStr)}
                ${row("🕐 Time",    timeStr)}
                ${args.hostName    ? row("👤 Host",    args.hostName)    : ""}
                ${args.purpose     ? row("📋 Purpose", args.purpose)     : ""}
                ${args.visitorCompany ? row("🏢 Company", args.visitorCompany) : ""}
                ${args.notes       ? row("📝 Notes",   args.notes)       : ""}
              </td></tr>
            </table>

            <!-- What to do on arrival -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;border-radius:10px;border:1px solid #d0d7de;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <div style="font-size:13px;font-weight:700;color:#1f2328;margin-bottom:12px;">When you arrive</div>
                ${step("1", "Head to the reception desk")}
                ${step("2", "Give your name — <strong>" + args.visitorName + "</strong>")}
                ${step("3", args.hostName ? `Ask for <strong>${args.hostName}</strong>` : "The receptionist will direct you")}
              </td></tr>
            </table>

            <p style="margin:0;font-size:14px;color:#656d76;line-height:1.6;">
              If you need to reschedule or cancel, please contact us as soon as possible.
              <!-- Calendar buttons -->
            <div style="margin-top:24px;">
              <div style="font-size:13px;font-weight:700;color:#1f2328;margin-bottom:10px;">Add to your calendar</div>
              <a href="${googleCalendarLink(`Visit: ${args.purpose ?? "Appointment"}`, args.scheduledDate, args.scheduledDate + 3600000, `Visit with ${args.hostName ?? "host"} at ${formatTime(args.scheduledDate)}`)}" style="display:inline-block;margin-right:10px;padding:10px 18px;background:#4285f4;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">📅 Google Calendar</a>
              <a href="${outlookCalendarLink(`Visit: ${args.purpose ?? "Appointment"}`, args.scheduledDate, args.scheduledDate + 3600000, `Visit with ${args.hostName ?? "host"} at ${formatTime(args.scheduledDate)}`)}" style="display:inline-block;padding:10px 18px;background:#0078d4;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">📅 Outlook</a>
            </div>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f6f8fa;padding:18px 36px;border-top:1px solid #d0d7de;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ba3ac;">Sent by <strong>Porta</strong> · Visit Management System</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await sendEmail({
      to:      args.to,
      subject: `✅ Visit confirmed — ${dateStr} at ${timeStr}`,
      html,
    });

    return { success: true };
  },
});

// ── HTML helpers ──────────────────────────────────────────────────────────────
function row(label: string, value: string) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
      <tr>
        <td width="120" style="font-size:13px;color:#9ba3ac;vertical-align:top;padding-right:8px;">${label}</td>
        <td style="font-size:13px;color:#1f2328;font-weight:600;">${value}</td>
      </tr>
    </table>`;
}

function step(num: string, text: string) {
  return `
    <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
      <div style="min-width:24px;height:24px;background:#45ba50;border-radius:50%;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;margin-right:10px;flex-shrink:0;">${num}</div>
      <div style="font-size:13px;color:#656d76;padding-top:4px;">${text}</div>
    </div>`;
}
// ── Calendar link helpers ─────────────────────────────────────────────────────
function googleCalendarLink(title: string, start: number, end: number, desc: string) {
  const fmt = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${fmt(start)}/${fmt(end)}`, details: desc });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

function outlookCalendarLink(title: string, start: number, end: number, desc: string) {
  const fmt = (ts: number) => new Date(ts).toISOString();
  const p = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: title, startdt: fmt(start), enddt: fmt(end), body: desc });
  return "https://outlook.live.com/calendar/0/deeplink/compose?" + p.toString();
}

// ── Email 3: Host check-in notification ───────────────────────────────────────
export const sendHostCheckInAlert = action({
  args: {
    to:             v.string(),
    hostName:       v.string(),
    visitorName:    v.string(),
    visitorCompany: v.optional(v.string()),
    purpose:        v.optional(v.string()),
    scheduledDate:  v.number(),
    checkedInAt:    v.number(),
  },
  handler: async (_ctx, args) => {
    const apptTime    = formatTime(args.scheduledDate);
    const checkinTime = formatTime(args.checkedInAt);
    const diffMins    = Math.round((args.checkedInAt - args.scheduledDate) / 60000);

    let timingMsg: string;
    let timingColor: string;
    if (diffMins <= 0) {
      const early = Math.abs(diffMins);
      timingMsg   = early <= 2
        ? `right on time for your <strong>${apptTime}</strong> appointment.`
        : `<strong>${early} minutes early</strong> for your <strong>${apptTime}</strong> appointment.`;
      timingColor = "#1a7f37";
    } else if (diffMins <= 10) {
      timingMsg   = `<strong>${diffMins} minutes late</strong> for your <strong>${apptTime}</strong> appointment.`;
      timingColor = "#d29922";
    } else {
      timingMsg   = `<strong>${diffMins} minutes late</strong> for your <strong>${apptTime}</strong> appointment.`;
      timingColor = "#cf222e";
    }

    const visitorLabel = args.visitorCompany
      ? `${args.visitorName} (${args.visitorCompany})`
      : args.visitorName;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d0d7de;">
        <tr>
          <td style="background:#1a1a2e;padding:28px 36px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">🔔</div>
            <div style="font-size:22px;font-weight:800;color:#ffffff;">Your visitor has arrived</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.7);margin-top:4px;">Reception check-in alert</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 20px;font-size:16px;color:#1f2328;">Hello <strong>${args.hostName}</strong>,</p>
            <p style="margin:0 0 24px;font-size:16px;color:#1f2328;line-height:1.7;">
              <strong>${visitorLabel}</strong> is here to see you — ${timingMsg}
            </p>
            <div style="text-align:center;margin-bottom:24px;">
              <span style="display:inline-block;padding:8px 20px;background:${timingColor}18;color:${timingColor};border:1px solid ${timingColor}40;border-radius:999px;font-size:13px;font-weight:600;">
                Checked in at ${checkinTime}
              </span>
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;border-radius:10px;border:1px solid #d0d7de;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <div style="font-size:11px;font-weight:700;color:#9ba3ac;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px;">Visit Details</div>
                ${row("👤 Visitor",     visitorLabel)}
                ${row("🕐 Appointment", apptTime)}
                ${row("✅ Arrived at",  checkinTime)}
                ${args.purpose ? row("📋 Purpose", args.purpose) : ""}
              </td></tr>
            </table>
            <p style="margin:0;font-size:14px;color:#656d76;line-height:1.6;">
              Please head to reception or send word when you are ready to receive your visitor.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f6f8fa;padding:18px 36px;border-top:1px solid #d0d7de;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ba3ac;">Sent by <strong>Porta</strong> · Visit Management System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await sendEmail({
      to:      args.to,
      subject: `🔔 ${args.visitorName} is here for your ${apptTime} appointment`,
      html,
    });

    return { success: true };
  },
});