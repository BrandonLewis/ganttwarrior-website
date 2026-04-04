Title: iCal Sync
Order: 8
Section: Advanced

# iCal Sync

GanttWarrior can import and export iCalendar (.ics) files.

## Export

    :::bash
    ganttwarrior export ical project.ics

Time-aware tasks are exported as DATETIME events. Day-level tasks are exported as DATE events.

## Import

    :::bash
    ganttwarrior import ical calendar.ics

Events are imported as tasks. If a task with the same UID already exists, it is merged rather than duplicated.
