# מערכת ניהול שיבוצים מעון הדס — גרסה 0.18.0

Hadas Scheduling Management System v0.18.0

This release upgrades requests, announcements, tasks, daily operations, and the monthly calendar. It also fixes the daily-operations error: `root.querySelectorAll is not a function`.

## Upgrade from v0.17.1

1. In Supabase SQL Editor, run `supabase/update-v0.18.0.sql` once.
2. Do not rerun `schema.sql`.
3. Replace all v0.17.1 project files in GitHub with the v0.18.0 files.
4. Keep only `api/index.js` inside the `api` folder.
5. Commit and push, then wait for Vercel status `Ready`.
6. Open `/health` and confirm:
   - Site version: `0.18.0`
   - Database version: `0.18.0`

No Vercel environment-variable changes are required.

## Main changes

- Clearer request workflow and a redesigned new-request form.
- Leave and sick-date ranges, manual-form reminder, private sick certificate upload.
- Selection of a specific fixed day off when an employee has more than one.
- Searchable employee cards for swap requests.
- Pinned announcements and tasks.
- Read tracking for announcements and completion tracking for tasks.
- Task notifications close correctly after completion.
- Safe previous/today/next navigation in daily operations.
- Upgraded calendar with event styles, legend, and monthly agenda.
- UI assets use cache version `0180`.
