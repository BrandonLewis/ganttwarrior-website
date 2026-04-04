Title: Work Calendars
Order: 6
Section: Advanced

# Work Calendars

GanttWarrior supports per-project and per-task work calendars. The scheduler respects these when computing dates.

## Project Calendar

By default, weekdays (Monday–Friday) are work days. You can customize this in the project settings.

## Task Calendar

Individual tasks can override the project calendar. This is useful for tasks that span weekends or have custom schedules.

## How It Works

The `work_days: set[date]` field on each task is the source of truth. `start_date`, `end_date`, and `duration_days` are computed from it.
