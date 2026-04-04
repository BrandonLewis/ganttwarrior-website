# GanttWarrior Website

Marketing site, documentation hub, and blog for [GanttWarrior](https://github.com/BrandonLewis/ganttwarrior) — a TUI Gantt chart and task scheduler.

## Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd website
python manage.py runserver
```

Visit http://localhost:8000

## Testing

```bash
cd website
python manage.py test -v 2
```

## Adding Content

### Docs

Add markdown files to `website/content/docs/` with frontmatter:

```markdown
Title: Page Title
Order: 1
Section: Getting Started

# Content here
```

### Blog Posts

Add markdown files to `website/content/blog/` with frontmatter:

```markdown
Title: Post Title
Date: 2026-04-04
Author: Brandon Lewis
Excerpt: Short description for the index page.
Order: 1

# Content here
```

## Deployment

Deployed to Railway. Push to `main` to deploy.

## License

MIT
