from django.conf import settings
from django.http import Http404
from django.shortcuts import redirect, render

from .markdown_loader import discover_markdown_files

_cache: list[dict] | None = None


def _get_docs() -> list[dict]:
    global _cache
    if _cache is None:
        _cache = discover_markdown_files(settings.CONTENT_DIR / "docs")
    return _cache


def index(request):
    return redirect("docs:page", slug="getting-started")


def page(request, slug):
    docs = _get_docs()
    current = None
    for doc in docs:
        if doc["slug"] == slug:
            current = doc
            break
    if current is None:
        raise Http404(f"Doc page '{slug}' not found.")

    sidebar = []
    current_section = None
    for doc in docs:
        section = doc["meta"].get("section", "")
        if section != current_section:
            sidebar.append({"type": "heading", "title": section})
            current_section = section
        sidebar.append({
            "type": "link",
            "title": doc["meta"].get("title", doc["slug"]),
            "slug": doc["slug"],
            "active": doc["slug"] == slug,
        })

    return render(request, "docs/page.html", {
        "doc": current,
        "sidebar": sidebar,
    })
