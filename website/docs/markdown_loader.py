"""Shared markdown file loader for docs and blog apps.

Discovers .md files in a directory, parses frontmatter via the markdown
`meta` extension, and returns cached HTML + metadata dicts.
"""

from pathlib import Path

import markdown


def load_markdown_file(filepath: Path) -> dict:
    """Parse a single markdown file and return its metadata and HTML.

    Expects markdown `meta` extension format for frontmatter:
        Title: My Page
        Order: 1
        Section: basics

        # Content here
    """
    text = filepath.read_text(encoding="utf-8")
    md = markdown.Markdown(
        extensions=["meta", "fenced_code", "codehilite", "toc"],
        extension_configs={
            "codehilite": {"css_class": "codehilite", "guess_lang": False},
        },
    )
    html = md.convert(text)

    meta = {}
    for key, values in md.Meta.items():
        value = values[0] if len(values) == 1 else values
        if key == "order":
            value = int(value)
        meta[key] = value

    return {
        "slug": filepath.stem,
        "meta": meta,
        "html": html,
    }


def discover_markdown_files(directory: Path) -> list[dict]:
    """Discover all .md files in a directory and return them sorted by order."""
    if not directory.is_dir():
        return []

    entries = []
    for filepath in sorted(directory.glob("*.md")):
        entries.append(load_markdown_file(filepath))

    entries.sort(key=lambda e: e["meta"].get("order", 999))
    return entries
