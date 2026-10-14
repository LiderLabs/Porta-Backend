## Summary
This pull request addresses security vulnerabilities, role authorization gaps, runtime query bugs, and unindexed table scans identified during a backend sanity check on the **staff**, **admin**, and **receptionist** modules.

---

### Key Changes

#### 1. Superadmin Authorization (`convex/superadmin.ts`, `convex/authHelpers.ts`)
- **Enforced Server-Side Auth:** Added `requireSuperadmin(ctx)` guards across all administrative mutations, queries, and actions in `superadmin.ts` (`listOrgs`, `platformStats`, `createOrg`, `sendAdminInvite`, `blockOrg`, `unblockOrg`, `activateOrg`, `updatePlan`, `updateFeatures`, `updateOrg`, `deleteOrg`, `listAuditLog`, `upsertPlanDefinition`, `deletePlanDefinition`, `savePlatformSettings`, `clearAuditLog`, `resetAllFeatureFlags`, etc.).
- **Caller Spoofing Protection:** Audit logs now use verified identity fields (`admin.clerkUserId`, `admin.name`) rather than untrusted client arguments.
- **Enhanced `requireSuperadminInternal`:** Resolves superadmin status against both the `users` table and Clerk session metadata (`publicMetadata.role`).

#### 2. Staff Endpoints & Multi-Tenant Scoping (`convex/staff.ts`, `convex/authHelpers.ts`)
- **Safe `staff.list` Scoping:** Eliminated the fallback `ctx.db.query("staff").collect()` table scan that could leak staff from other tenants when an organization had no active staff.
- **Orphan/Legacy Staff Claiming:** Updated `assertSameOrg` to support `allowMissingRecordOrg = true`. Admins can now update, remove, or change roles of legacy staff records (which lacked `orgId`), and updates automatically claim and backfill the record with the admin's `orgId`.
- **Query Optimization:** Added `.index("by_clerk_id", ["clerkUserId"])` and `.index("by_email", ["email"])` to `staff` in `schema.ts`. Converted unindexed table filters in `getByClerkId`, `autoLinkByEmail`, `getMe`, and `assertCanManageEmail` to indexed lookups.

#### 3. Scheduling & Visitor Search (`convex/scheduling.ts`)
- **Fixed `searchByVisitor` Runtime Bug:** Fixed query looking for `slug` on `orgSettings` (which does not exist in schema) to query `organizations` with index `by_slug` and filter visits via `by_org`.
- **Secured `scheduling.create`:** Added `requireAdminOrReceptionist(ctx)` and stamped the caller's `orgId` onto new visits.
- **Secured `scheduling.remove`:** Added `requireAdminOrReceptionist(ctx)` and `assertSameOrg(orgId, visit.orgId)` to prevent unauthorized cross-tenant visit deletion.
- **Indexed Lookups:** Updated `listByStaff`, `getUpcoming`, and `setAvailability` to use `staff.withIndex("by_clerk_id")`.

#### 4. Users Table & Messaging (`convex/schema.ts`, `convex/http.ts`, `convex/users.ts`, `convex/directMessages.ts`)
- **Schema & Webhook:** Added `orgId: v.optional(v.string())` and `by_org` index to the `users` table in `schema.ts`. Updated Clerk webhook in `http.ts` to persist `orgId` in `users.upsertFromClerk`.
- **Fixed `users.list` & `users.listForMessaging`:** Properly scopes user queries by `orgId` and falls back to looking up active `staff` records in the same org, preventing empty list returns.
- **Indexed Lookups:** Updated `directMessages.send` and `getOrgId.resolveOrgId` to use `staff.withIndex("by_clerk_id")`.

#### 5. Invites Table (`convex/schema.ts`, `convex/invites.ts`)
- **Indexed `invites.list`:** Added `.index("by_org", ["orgId"])` to `invites` in `schema.ts` and updated `invites.list` to use `by_org`.
- **Role Alignment:** Added `superadmin` literal to `invites.create` validator to match schema.
- **Indexed Lookups:** Converted `invites.markAccepted` and `invites.linkClerkUserInternal` to use `withIndex("by_email")`.
- **Revoke Support:** Passed `allowMissingRecordOrg` to `assertSameOrg` in `invites.revoke`.

#### 6. Auth Helpers Refactoring (`convex/authHelpers.ts`)
- **Deduplication:** Consolidated duplicate lookup logic between `requireAdminInternal` and `requireAdminOrReceptionistInternal` into a unified `requireRoleInternal` helper that uses the `staff.withIndex("by_clerk_id")` index.

---

### Verification
- Verified schema and TypeScript types with `convex codegen` (compiled with zero errors).