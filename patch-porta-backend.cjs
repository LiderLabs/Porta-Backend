// patch-porta-backend.cjs
// Walk-in visitors now alert their host.
//
//   convex/visitors.ts : checkIn verifies the host is in the receptionist's org
//                        and emails the host (same alert scheduled visits use).
//   convex/email.ts    : sendHostCheckInAlert gets an optional `walkIn` flag so the
//                        email says "has arrived at reception" instead of talking
//                        about an appointment time.
//
// Purely additive: no schema change, no new function, and existing callers keep working.
// Walk-ins stay in the `visitors` table, so Analytics, Dashboard and the Visitors list are unchanged.
//
// Run from the porta-backend repo root:
//   node patch-porta-backend.cjs --check   (verify every anchor, change nothing)
//   node patch-porta-backend.cjs           (apply)
//
// Handles CRLF/LF and a BOM. Each file is changed all-or-nothing.

const fs = require("fs");
const path = require("path");

const CHECK_ONLY = process.argv.includes("--check");
const ROOT = process.cwd();
const count = (s, needle) => s.split(needle).length - 1;

function applyEdits(label, text, edits) {
  const problems = [];
  let out = text;
  for (const e of edits) {
    const n = count(out, e.find);
    if (n !== 1) {
      problems.push(`${label}: [${e.name}] anchor matched ${n} times (expected 1)`);
      continue;
    }
    out = out.replace(e.find, () => e.replace);
  }
  return { out, problems };
}

function run(rel, edits, mustContain) {
  const file = path.join(ROOT, rel);
  const label = rel.replace(/\\/g, "/");
  if (!fs.existsSync(file)) {
    return { problems: [`${label}: file not found. Run this from the porta-backend repo root.`] };
  }
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const lf = raw.replace(/\r\n/g, "\n");
  const { out, problems } = applyEdits(label, lf, edits);
  for (const need of mustContain) {
    if (!out.includes(need)) problems.push(`${label}: expected "${need}" after patching`);
  }
  if (problems.length) return { problems };
  return { problems: [], file, final: crlf ? out.replace(/\n/g, "\r\n") : out, label };
}

// ───────────────────────── visitors.ts ─────────────────────────
const visitorsEdits = [
  {
    name: "import internal",
    find: `import { v } from "convex/values";\n`,
    replace: `import { v } from "convex/values";\nimport { internal } from "./_generated/api";\n`,
  },
  {
    name: "checkIn alerts the host",
    find:
      `    const { orgId } = await requireAdminOrReceptionist(ctx);\n` +
      `    return await ctx.db.insert("visitors", {\n` +
      `      ...args,\n` +
      `      orgId,\n` +
      `      checkInTime: Date.now(),\n` +
      `      status: "IN",\n` +
      `    });\n`,
    replace:
      `    const { orgId } = await requireAdminOrReceptionist(ctx);\n` +
      `\n` +
      `    // The host must belong to the receptionist's organisation.\n` +
      `    const host = args.hostId ? await ctx.db.get(args.hostId) : null;\n` +
      `    if (args.hostId) {\n` +
      `      if (!host) throw new Error("Host not found");\n` +
      `      assertSameOrg(orgId, host.orgId);\n` +
      `    }\n` +
      `\n` +
      `    const checkInTime = Date.now();\n` +
      `    const visitorId = await ctx.db.insert("visitors", {\n` +
      `      ...args,\n` +
      `      orgId,\n` +
      `      checkInTime,\n` +
      `      status: "IN",\n` +
      `    });\n` +
      `\n` +
      `    // Tell the host their walk-in visitor has arrived.\n` +
      `    if (host?.email) {\n` +
      `      await ctx.scheduler.runAfter(0, internal.email.sendHostCheckInAlert, {\n` +
      `        to: host.email,\n` +
      `        hostName: host.name,\n` +
      `        visitorName: args.fullName,\n` +
      `        visitorCompany: args.company ?? undefined,\n` +
      `        purpose: args.purpose ?? undefined,\n` +
      `        scheduledDate: checkInTime,\n` +
      `        checkedInAt: checkInTime,\n` +
      `        walkIn: true,\n` +
      `      });\n` +
      `    }\n` +
      `\n` +
      `    return visitorId;\n`,
  },
];

// ───────────────────────── email.ts ─────────────────────────
const emailEdits = [
  {
    name: "walkIn arg",
    find:
      `    scheduledDate: v.number(),\n` +
      `    checkedInAt: v.number(),\n` +
      `  },\n` +
      `  handler: async (_ctx, args) => {\n` +
      `    const apptTime = formatTime(args.scheduledDate);\n` +
      `    const checkinTime = formatTime(args.checkedInAt);\n`,
    replace:
      `    scheduledDate: v.number(),\n` +
      `    checkedInAt: v.number(),\n` +
      `    // true for a walk-in with no appointment: changes the wording below.\n` +
      `    walkIn: v.optional(v.boolean()),\n` +
      `  },\n` +
      `  handler: async (_ctx, args) => {\n` +
      `    const apptTime = formatTime(args.scheduledDate);\n` +
      `    const checkinTime = formatTime(args.checkedInAt);\n`,
  },
  {
    name: "walk-in timing sentence",
    find: `    if (diffMins <= 0) {\n      const early = Math.abs(diffMins);\n`,
    replace:
      `    if (args.walkIn) {\n` +
      `      timingMsg = "just arrived at reception without an appointment.";\n` +
      `      timingColor = "#1a7f37";\n` +
      `    } else if (diffMins <= 0) {\n` +
      `      const early = Math.abs(diffMins);\n`,
  },
  {
    name: "hide appointment row for walk-ins",
    find: `\${row("🕐 Appointment", apptTime)}`,
    replace: `\${args.walkIn ? "" : row("🕐 Appointment", apptTime)}`,
  },
  {
    name: "walk-in subject line",
    find: "      subject: `🔔 ${args.visitorName} is here for your ${apptTime} appointment`,",
    replace:
      "      subject: args.walkIn\n" +
      "        ? `🔔 ${args.visitorName} has arrived at reception`\n" +
      "        : `🔔 ${args.visitorName} is here for your ${apptTime} appointment`,",
  },
];

const results = [
  run("convex/visitors.ts", visitorsEdits, ["internal.email.sendHostCheckInAlert", "assertSameOrg(orgId, host.orgId)"]),
  run("convex/email.ts", emailEdits, ["walkIn: v.optional(v.boolean())"]),
];

const problems = results.flatMap((r) => r.problems);
if (problems.length) {
  console.error("\nNothing was changed. Problems found:\n");
  for (const p of problems) console.error("  - " + p);
  console.error("\nEither the patch was already applied, or your local files differ from GitHub. If it is the second, send me the file(s) named above.");
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log("All anchors found. Nothing written (--check).");
  process.exit(0);
}

for (const r of results) {
  fs.writeFileSync(r.file, r.final, "utf8");
  console.log("patched " + r.label);
}
console.log("\nDone. Next: npx tsc --noEmit -p convex, then deploy and test a walk-in with a host.");
