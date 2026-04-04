Title: CLI Reference
Order: 3
Section: Getting Started

# CLI Reference

GanttWarrior provides a full CLI for scripting and automation.

## Project Commands

    :::bash
    ganttwarrior new <name>           # Create a new project
    ganttwarrior open <file>          # Open a project file
    ganttwarrior demo                 # Launch with sample data

## Task Commands

    :::bash
    ganttwarrior task list            # List all tasks
    ganttwarrior task add <name>      # Add a new task
    ganttwarrior task edit <id>       # Edit a task

## Schedule Commands

    :::bash
    ganttwarrior schedule             # Run the CPM scheduler
    ganttwarrior export pdf <file>    # Export to PDF
    ganttwarrior export excel <file>  # Export to Excel
