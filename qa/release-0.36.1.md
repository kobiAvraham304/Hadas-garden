# Release 0.36.1 — 2026-09-20

Base: cfa18c83ad2087fbae7dce6a5505434a8753ea2b.

## Changes
- Early finish requests before a shift exists; approved limits in automatic generation and a note on manual shift cards.
- Multiple fixed day-off choices and one optional preferred day.
- Owner deletion of pending leave; manager-reviewed cancellation of approved leave with transactional rollback through the existing snapshot mechanism.
- Versioned request/cache reads prevent stale refreshes, shared prefetches and compatibility wrappers from replacing saved shifts.
- Reuse session lookup only within one HTTP request; refresh after mutations is queued instead of lost.
- Larger mobile request controls and version badge above the lower-left navigation area.

## Verification
- `npm run qa`: 336 tests, zero failures; secret scan passed.
- Full DOM bootstrap with all existing compatibility scripts: version, multiselect/preference submission, no-shift early finish, ownership controls and manager cancellation queue passed with no console errors.
- Supabase transaction with rollback: early finish without a shift, multiple stored days, pending deletion ownership, cancellation authorization, rejection keeping leave effective, approval removing leave, and restoration of a prior shift all passed. No test requests/shifts retained.
- Supabase security advisors: no findings after migration; anonymous/authenticated direct execution of the cancellation RPC denied.
- Cloud browser could not access local preview; visual layout on an actual mobile browser was not verified. DOM tests do not measure layout.

## Deployment
Apply `supabase/update-v0.36.1.sql` before publishing code. This migration was applied and verified. It is additive and compatible with 0.36.0.
Publish all changes in a single main-branch update; do not push intermediate test commits.
