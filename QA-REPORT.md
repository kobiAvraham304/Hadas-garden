# QA Report - v0.18.0

## Result
- 139 of 139 automated tests passed.
- `npm run check` passed.
- JavaScript syntax checks passed.
- No Supabase secret key is bundled.
- Only one Vercel serverless function exists: `api/index.js`.

## Covered areas
- Login and permissions.
- Request creation, approval, rejection, and schedule application.
- Leave, day off, sickness, shift-time changes, and swaps.
- Date ranges, fixed-day selection, and private sick certificates.
- Pinned announcements/tasks, read tracking, and task completion tracking.
- Correct task notification state after completion/reopen.
- Daily-operations date navigation and adjacent-date prefetch.
- Calendar month navigation, event types, legend, and agenda.
- Schedule validation, API routing, and database migration consistency.
- Safe DOM selector helpers accepting DOM roots, selector strings, and missing roots.

## Environment limitation
A real iPhone Safari engine is unavailable in the build environment. After deployment, perform a short device check of the new dialogs and native iOS date inputs.
