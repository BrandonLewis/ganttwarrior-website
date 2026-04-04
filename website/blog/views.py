from django.conf import settings
from django.http import Http404
from django.shortcuts import render

from docs.markdown_loader import discover_markdown_files

_cache: list[dict] | None = None


def _get_posts() -> list[dict]:
    global _cache
    if _cache is None:
        posts = discover_markdown_files(settings.CONTENT_DIR / "blog")
        posts.sort(
            key=lambda p: p["meta"].get("date", ""),
            reverse=True,
        )
        _cache = posts
    return _cache


def index(request):
    return render(request, "blog/index.html", {"posts": _get_posts()})


def detail(request, slug):
    for post in _get_posts():
        if post["slug"] == slug:
            return render(request, "blog/detail.html", {"post": post})
    raise Http404(f"Blog post '{slug}' not found.")
