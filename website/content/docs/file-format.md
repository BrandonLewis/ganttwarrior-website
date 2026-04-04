Title: File Format
Order: 5
Section: Getting Started

# File Format

GanttWarrior projects are stored as `.gw.json` files — plain JSON that is easy to version control and inspect.

## Structure

The file contains a single project object with tasks, dependencies, and settings.

    :::json
    {
      "name": "My Project",
      "tasks": [...],
      "dependencies": [...],
      "settings": {...}
    }

## Tasks

Each task has a name, WBS number, status, color, and a set of work days.

## Dependencies

Dependencies link tasks by their IDs with a type (finish-to-start, start-to-start, etc.).
