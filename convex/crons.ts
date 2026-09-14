import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Check every day at midnight if any trial orgs have expired → activate them
crons.daily(
  "expire-trials",
  { hourUTC: 0, minuteUTC: 0 },
  internal.superadmin.expireTrials,
  {}
);

export default crons;
