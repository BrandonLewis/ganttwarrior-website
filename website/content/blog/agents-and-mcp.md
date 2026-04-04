Title: AI Agents Meet Project Management
Date: 2026-04-04
Author: Brandon Lewis
Excerpt: How Claude Code and other AI agents can create, schedule, and manage GanttWarrior projects through the CLI and MCP server.
Order: 2

# AI Agents Meet Project Management

GanttWarrior was built as a TUI-first tool, but from the beginning we designed it with a clean service layer that separates business logic from I/O. That design decision is paying off: AI agents can now create projects, manage tasks, run the CPM scheduler, and export results — all through the same functions that power the TUI.

## The Architecture That Makes It Work

GanttWarrior's CLI service layer (`cli.py`) is a set of pure functions. Each one takes a `Project`, does its work, and returns a plain dict. No file reads, no prints, no side effects. This made it trivial to wrap them in three different ways:

1. **The TUI** calls the service functions directly.
2. **The CLI** (`python -m ganttwarrior ... --json`) wraps them with argument parsing and file I/O, emitting a consistent JSON envelope.
3. **The MCP server** wraps the same functions as MCP tools for AI agent clients.

The JSON envelope is simple and consistent:

    :::json
    {"ok": true, "data": {"tasks": [...]}}
    {"ok": false, "error": "Task 1.2 not found"}

Agents check `ok`, process `data`, and move on.

## The `/gw` Slash Command

In Claude Code, you can type `/gw` to interact with GanttWarrior using natural language. The agent translates your intent into the right CLI commands:

- `/gw create a project called "Q3 Launch" starting April 7`
- `/gw add task "Write copy" under phase 1, assign to Alice, 3 days`
- `/gw what's on the critical path?`
- `/gw export to PDF`

Behind the scenes, Claude runs `python -m ganttwarrior` with `--json` output and interprets the results. It can chain multiple commands together — creating a full project structure with dependencies, running the scheduler, and reporting back in a single interaction.

## What Agents Can Do

An agent connected to GanttWarrior can handle the full project management lifecycle:

- **Create projects** with start dates and work calendars
- **Build task hierarchies** with WBS numbering, durations, colors, and assignments
- **Manage dependencies** — FS, SS, FF, SF with optional lag
- **Run the CPM scheduler** and identify the critical path
- **Find blocked and ready tasks** to keep work moving
- **Update progress** on tasks as work completes
- **Export** to PDF, Excel, or iCalendar for stakeholders

All task identifiers use WBS numbers (`1`, `1.2`, `2.3.1`), which are compact and human-readable — good for both people and agents.

## MCP Server Setup

The MCP server wraps the same service layer and works with any MCP-compatible client. Add it to your configuration:

    :::json
    {
      "mcpServers": {
        "ganttwarrior": {
          "command": "python",
          "args": ["-m", "ganttwarrior", "mcp"]
        }
      }
    }

This gives Claude Desktop, Cursor, VS Code with Copilot, and other MCP clients access to GanttWarrior's full command set as native tools.

## Why This Matters

Project management is one of those domains where AI agents can genuinely help — not by replacing human judgment on priorities and tradeoffs, but by handling the mechanical work: building out task structures, keeping schedules updated, finding bottlenecks, and producing reports. With GanttWarrior's agent support, you describe what you want and the agent handles the CLI commands.

The service layer design means every agent interaction goes through the same tested code paths as the TUI. There is no separate "agent API" that could drift out of sync. One set of functions, three interfaces.

See the [MCP Server & Agents documentation](/docs/mcp-and-agents/) for the full command reference and setup guide.
