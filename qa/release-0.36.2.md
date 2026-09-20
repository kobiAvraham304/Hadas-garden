# Release 0.36.2 — 2026-09-20

Base: 7083feb6996b6440abdd5c3cb332532ab56aa496.

## Changes
- Late-start requests can precede a shift, like early-finish requests. Approval keeps the constraint; automatic generation clamps the available interval; manual shift cards show both approved arrival and departure notes.
- Existing shift ownership and interval validation remain enforced. Pending constraints do not affect generation; impossible approved intervals are excluded.
- Verified the current full bootstrap supports multiple fixed days off and optional preference. User screenshots show the former mobile-coverage-layout-hf13 preview, while canonical production was 0.36.1. Use https://hadas-garden.vercel.app.
- Move API execution from iad1 to sin1, colocating with Supabase ap-southeast-1. Official configuration reference: https://vercel.com/docs/functions/configuring-functions/region.
- All Supabase reads share one timeout budget across retries. Timeouts stop retries; transient gateway errors may retry within the budget; writes never retry automatically.

## Verification
- npm run qa: 341 tests passed; bundled secret scan passed.
- Full DOM bootstrap with compatibility layers: multiselect/preference submission, early finish and late start without a shift, cancellation ownership and manager controls; no console errors. This does not measure actual mobile layout.
- Applied additive migration update-v0.36.2.sql. Transactional SQL test approved unassigned early/late constraints and confirmed no shift mutation; rolled back all test rows.
- Database statement statistics reviewed: most-used schedule-change query mean 8.50 ms; session context mean 4.76 ms; shift-range query mean 1.13 ms. No evidence justifying broad schema/index changes for the current small dataset.
- Pre-release public health endpoint measurements from this environment: 14.273, 10.489, 8.596, 9.452 seconds, including network/tool-environment overhead. These are not authenticated per-screen benchmarks and must not be presented as user-facing speed guarantees.
- Daily operations and planning data separation unchanged.

## Deployment
Single main branch update after verification. No intermediate preview deployments.
