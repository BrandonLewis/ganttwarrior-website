Title: Critical Path
Order: 7
Section: Advanced

# Critical Path Method

GanttWarrior includes a CPM scheduler that computes the critical path through your project.

## What Is Critical Path?

The critical path is the longest sequence of dependent tasks. Any delay on the critical path delays the entire project.

## Running the Scheduler

    :::bash
    ganttwarrior schedule

The scheduler performs forward and backward passes to compute earliest/latest start and finish dates, then identifies tasks with zero slack.

## Viewing the Critical Path

In the Gantt chart, critical path tasks are highlighted automatically.
