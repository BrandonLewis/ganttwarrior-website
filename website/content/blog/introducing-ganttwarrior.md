Title: Introducing GanttWarrior
Date: 2026-04-04
Author: Brandon Lewis
Excerpt: Why we built a TUI project scheduler, and what makes it different from every other Gantt chart tool.
Order: 1

# Introducing GanttWarrior

GanttWarrior is a terminal-based project scheduler that combines Gantt charts, Kanban boards, and calendar views into a single TUI application.

## Why Another Project Management Tool?

Most project management tools are browser-based SaaS products. They're slow, expensive, and require you to leave your terminal. GanttWarrior runs where you already work.

## What Makes It Different

- **TUI-native** — built with Textual and Rich, runs in any terminal
- **Three views** — Gantt chart, Kanban board, and Calendar in one app
- **Critical path** — CPM scheduler computes your project's critical path
- **Keyboard-first** — full keyboard navigation across all views
- **Plain files** — projects stored as `.gw.json` files, easy to version control
- **Export anywhere** — PDF, Excel, terminal, and iCalendar formats

## Getting Started

    :::bash
    pip install ganttwarrior
    ganttwarrior demo

That's it. No accounts, no subscriptions, no browser required.
