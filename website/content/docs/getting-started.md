Title: Getting Started
Order: 1
Section: Getting Started

# Getting Started

GanttWarrior is a terminal-based project scheduler. Install it and run the demo to see it in action.

## Quick Start

    :::bash
    pip install ganttwarrior
    ganttwarrior demo

This launches the TUI with sample project data. Use **Tab** to switch between Gantt, Kanban, and Calendar views.

## Creating a Project

    :::bash
    ganttwarrior new myproject

This creates a `myproject.gw.json` file in the current directory.

## Opening a Project

    :::bash
    ganttwarrior open myproject.gw.json

Or just run `ganttwarrior` in a directory with a `.gw.json` file.
