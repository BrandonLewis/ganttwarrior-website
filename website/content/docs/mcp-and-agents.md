Title: MCP Server & Agents
Order: 10
Section: Advanced

# MCP Server & Agents

GanttWarrior is designed for both human and AI interaction. Its architecture layers a CLI service layer, a JSON-emitting CLI, and an MCP server so that agents can create projects, manage tasks, run the scheduler, and export results — all programmatically.

## Architecture

GanttWarrior's agent integration follows a clean layered design:

    :::
    CLI Service Layer (cli.py)     ← Pure functions: Project in, dict out
         ↑                ↑
    CLI + --json flag     MCP Server
         ↑                ↑
    Shell scripts      AI Agents (Claude Code, Cursor, etc.)

- **Service layer** (`ganttwarrior/cli.py`) — Pure functions that take a `Project` and return plain dicts. No I/O, no side effects, fully testable.
- **CLI** (`python -m ganttwarrior`) — Wraps the service layer with file I/O and argument parsing. Pass `--json` for machine-parseable output.
- **MCP server** — Wraps the same service functions as MCP tools, exposing them over the Model Context Protocol for any compatible client.

## JSON API Envelope

All `--json` output uses a consistent envelope:

**Success:**

    :::json
    {"ok": true, "data": <result>}

**Error:**

    :::json
    {"ok": false, "error": "message"}

Agents should check the `ok` field before processing `data`.

## The `/gw` Slash Command

In Claude Code, the `/gw` slash command gives agents a natural-language interface to GanttWarrior. Agents say things like:

- `/gw list tasks`
- `/gw add task "Design homepage" --duration 5`
- `/gw show critical path`

Claude translates these into the appropriate `python -m ganttwarrior` CLI commands and interprets the JSON results.

## Command Reference

Task identifiers are WBS numbers (e.g., `1`, `1.2`, `2.3.1`). Use the `--id` flag if you need UUID-based resolution instead.

### Project Commands

    :::bash
    python -m ganttwarrior project create "Name" --start-date YYYY-MM-DD
    python -m ganttwarrior project show --json
    python -m ganttwarrior project set --name "New Name" --start-date YYYY-MM-DD
    python -m ganttwarrior project calendar --json

### Task Commands

    :::bash
    python -m ganttwarrior task list --json
    python -m ganttwarrior task list --status completed --json
    python -m ganttwarrior task show 1.2 --json
    python -m ganttwarrior task add "Name" --duration 5 --color blue --assigned "Alice" --parent 1
    python -m ganttwarrior task edit 1.2 --status in_progress --progress 0.5
    python -m ganttwarrior task remove 1.2

**Available statuses:** `not_started`, `in_progress`, `completed`, `blocked`, `cancelled`

**Available colors:** `red`, `green`, `blue`, `yellow`, `magenta`, `cyan`, `orange`, `purple`, `white`

### Dependency Commands

    :::bash
    python -m ganttwarrior dep list 2 --json
    python -m ganttwarrior dep add 2 --from 1 --type FS --lag 0
    python -m ganttwarrior dep remove 2 --from 1

**Dependency types:**

- **FS** — Finish-to-Start (default). Task B starts after Task A finishes.
- **SS** — Start-to-Start. Task B starts when Task A starts.
- **FF** — Finish-to-Finish. Task B finishes when Task A finishes.
- **SF** — Start-to-Finish. Task B finishes when Task A starts.

### Scheduler Commands

    :::bash
    python -m ganttwarrior schedule --json
    python -m ganttwarrior schedule --critical-path --json
    python -m ganttwarrior schedule --blocked --json
    python -m ganttwarrior schedule --ready --json

The scheduler runs the Critical Path Method (CPM) forward and backward passes, computing early/late start and finish dates, float, and the critical path.

### Export Commands

    :::bash
    python -m ganttwarrior export project.gw.json --pdf output.pdf
    python -m ganttwarrior export project.gw.json --excel output.xlsx
    python -m ganttwarrior export project.gw.json --ical output.ics

## Example Agent Workflows

### Create a project and add tasks

    :::bash
    # Create a new project
    python -m ganttwarrior project create "Website Redesign" --start-date 2026-04-07

    # Add top-level phases
    python -m ganttwarrior task add "Design" --duration 10 --color blue
    python -m ganttwarrior task add "Development" --duration 15 --color green
    python -m ganttwarrior task add "Testing" --duration 5 --color yellow

    # Add subtasks under Design (WBS 1)
    python -m ganttwarrior task add "Wireframes" --duration 3 --parent 1 --assigned "Alice"
    python -m ganttwarrior task add "Visual Design" --duration 5 --parent 1 --assigned "Bob"

    # Add dependencies
    python -m ganttwarrior dep add 2 --from 1 --type FS
    python -m ganttwarrior dep add 3 --from 2 --type FS
    python -m ganttwarrior dep add 1.2 --from 1.1 --type FS

    # Schedule and check the critical path
    python -m ganttwarrior schedule --json
    python -m ganttwarrior schedule --critical-path --json

### Check project status and update progress

    :::bash
    # See what's ready to start
    python -m ganttwarrior schedule --ready --json

    # Update a task's progress
    python -m ganttwarrior task edit 1.1 --status in_progress --progress 0.5

    # Check what's blocked
    python -m ganttwarrior schedule --blocked --json

    # Mark a task complete
    python -m ganttwarrior task edit 1.1 --status completed --progress 1.0

### Export for stakeholders

    :::bash
    python -m ganttwarrior export project.gw.json --pdf schedule.pdf
    python -m ganttwarrior export project.gw.json --excel tasks.xlsx

## Setting Up the MCP Server

The MCP server wraps the same service functions from `cli.py` and exposes them as MCP tools.

### Configuration

Add GanttWarrior to your MCP client configuration:

    :::json
    {
      "mcpServers": {
        "ganttwarrior": {
          "command": "python",
          "args": ["-m", "ganttwarrior", "mcp"],
          "env": {}
        }
      }
    }

This works with Claude Desktop, Cursor, VS Code with Copilot, and any other MCP-compatible client.

### Available MCP Tools

The MCP server exposes the same operations as the CLI:

- `project_create`, `project_show`, `project_set`, `project_calendar`
- `task_list`, `task_show`, `task_add`, `task_edit`, `task_remove`
- `dep_list`, `dep_add`, `dep_remove`
- `schedule`, `critical_path`, `blocked_tasks`, `ready_tasks`
- `export_pdf`, `export_excel`, `export_ical`

Each tool accepts the same parameters as its CLI counterpart and returns the same JSON envelope.
