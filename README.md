# prota-backend

Convex backend for the Porta guest management system.

## Setup
```bash
npm install
npm run dev      # start convex dev server
npm run deploy   # deploy to production
```

## Structure
- `convex/schema.ts`      — database schema
- `convex/visitors.ts`    — visitor/guest queries & mutations
- `convex/staff.ts`       — staff management
- `convex/users.ts`       — user management
- `convex/analytics.ts`   — analytics functions
- `convex/scheduling.ts`  — scheduling functions
- `convex/settings.ts`    — settings functions
- `convex/auth.config.ts` — Clerk auth config
- `convex/http.ts`        — HTTP endpoints (webhooks)
