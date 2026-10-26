// Run from porta-backend root FIRST, then porta-booking root:  node install-walkin-logbook-fix.cjs [--check]
// Auto-detects which repo it is in.
const fs = require("fs");
const check = process.argv.includes("--check");

function load(f) { let s = fs.readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); if (crlf) s = s.replace(/\r\n/g, "\n"); return { s, crlf }; }
function save(f, s, crlf) { fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s); }
function must(seg, a, b, label) {
  if (!seg.includes(a)) { console.error("Anchor not found (" + label + "):\n" + a); process.exit(1); }
  return seg.replace(a, () => b);
}

if (fs.existsSync("convex/scheduling.ts")) {
  const f = "convex/scheduling.ts";
  const { s: src, crlf } = load(f);
  if (src.includes("isWalkIn")) { console.log("Backend: already applied."); process.exit(0); }
  const start = src.indexOf("export const publicBook");
  const end = src.indexOf("\n});\n", start);
  if (start < 0 || end < 0) { console.error("publicBook not found"); process.exit(1); }
  let seg = src.slice(start, end);

  seg = must(seg,
`    orgSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, orgSlug, ...rest } = args;
    const now = Date.now();`,
`    orgSlug: v.string(),
    // Kiosk walk-in: this is a log book entry. Recorded at arrival time, never rejected for time or conflicts.
    walkIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { hostStaffId, orgSlug, walkIn, ...rest } = args;
    const now = Date.now();
    const isWalkIn = walkIn === true;
    const when = isWalkIn ? now : args.scheduledDate;`, "args");

  seg = must(seg,
    `if (!Number.isFinite(args.scheduledDate) || args.scheduledDate < now - GRACE_MS) {`,
    `if (!isWalkIn && (!Number.isFinite(args.scheduledDate) || args.scheduledDate < now - GRACE_MS)) {`, "past check");
  seg = must(seg,
    `if (args.scheduledDate > now + 180 * DAY) {`,
    `if (!isWalkIn && args.scheduledDate > now + 180 * DAY) {`, "180 days");
  seg = must(seg,
`    if (hostStaffId) {
      const newStart = args.scheduledDate;`,
`    if (hostStaffId && !isWalkIn) {
      const newStart = args.scheduledDate;`, "conflict");
  seg = must(seg,
`      status: "pending",
      source: "online",`,
`      scheduledDate: when,
      status: "pending",
      source: isWalkIn ? "walkin" : "online",`, "insert");
  seg = must(seg,
`        scheduledDate: args.scheduledDate,
        purpose: args.purpose ?? undefined,`,
`        scheduledDate: when,
        purpose: args.purpose ?? undefined,`, "email");

  console.log("Backend: publicBook walkIn path added (records at arrival time, skips time + conflict checks).");
  if (!check) save(f, src.slice(0, start) + seg + src.slice(end), crlf);
} else if (fs.existsSync("src/features/booking/pages/KioskPage.tsx")) {
  const f = "src/features/booking/pages/KioskPage.tsx";
  const { s, crlf } = load(f);
  if (s.includes("walkIn:         true")) { console.log("Kiosk: already applied."); process.exit(0); }
  const out = must(s, `        scheduledDate:  dt,\n`, `        scheduledDate:  dt,\n        walkIn:         true,\n`, "kiosk call");
  console.log("Kiosk: walk-in submit now sends walkIn: true.");
  if (!check) save(f, out, crlf);
} else { console.error("Run this from porta-backend or porta-booking root."); process.exit(1); }
console.log(check ? "--check: no changes written." : "Done.");
