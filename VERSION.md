# מערכת ניהול שיבוצים מעון הדס — גרסה 0.18.0

Hadas Scheduling Management System v0.18.0

## Requests
- Redesigned request workflow and request cards.
- Clear distinction between planned leave and a one-time day-off request.
- Leave and sick requests support start/end dates.
- More than two continuous leave days show a manual-form reminder.
- Leave and day-off requests can specify whether scheduling on a fixed day off is allowed.
- When multiple fixed days off exist, the relevant day can be selected.
- Swap candidates are shown as searchable employee cards.

## Announcements and tasks
- Announcements and tasks can be pinned.
- Announcements can require read acknowledgement or act as information-only notices.
- Creators can track who read an announcement.
- Tasks show completion counts, percentage, and employee-level tracking.
- Fixed the open-task notification remaining after a task was completed.
- Added All, Pinned, Unread, Open, and Completed filters.

## Daily operations
- Fixed `root.querySelectorAll is not a function`.
- Added previous day, today, and next day controls.
- Adjacent days are prefetched.
- Load failures appear inline with a retry action instead of repeated error toasts.

## Calendar
- Different event types use different colors and icons.
- New-event form uses clear event-type cards.
- Added a legend and monthly agenda beneath the calendar.

## Database
- Adds pinned-content, acknowledgement, and selected-fixed-day fields.
- Migration is non-destructive.
