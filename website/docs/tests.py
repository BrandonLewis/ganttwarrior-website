import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from docs.markdown_loader import load_markdown_file, discover_markdown_files


class MarkdownLoaderTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.tmp_path = Path(self.tmp)

    def test_load_markdown_file_parses_content(self):
        md_file = self.tmp_path / "test.md"
        md_file.write_text(
            "Title: Hello World\n"
            "Order: 1\n"
            "Section: basics\n"
            "\n"
            "# Hello\n"
            "\nSome **bold** text.\n"
        )
        result = load_markdown_file(md_file)
        self.assertEqual(result["meta"]["title"], "Hello World")
        self.assertIn("<strong>bold</strong>", result["html"])
        self.assertEqual(result["slug"], "test")

    def test_load_markdown_file_parses_order_as_int(self):
        md_file = self.tmp_path / "test.md"
        md_file.write_text("Title: Test\nOrder: 5\n\nContent.\n")
        result = load_markdown_file(md_file)
        self.assertEqual(result["meta"]["order"], 5)

    def test_discover_markdown_files_returns_sorted(self):
        (self.tmp_path / "b.md").write_text("Title: B\nOrder: 2\n\nB content.\n")
        (self.tmp_path / "a.md").write_text("Title: A\nOrder: 1\n\nA content.\n")
        results = discover_markdown_files(self.tmp_path)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["slug"], "a")
        self.assertEqual(results[1]["slug"], "b")

    def test_discover_empty_directory(self):
        results = discover_markdown_files(self.tmp_path)
        self.assertEqual(results, [])

    def test_load_markdown_with_fenced_code(self):
        md_file = self.tmp_path / "code.md"
        md_file.write_text(
            "Title: Code\nOrder: 1\n\n"
            "```python\nprint('hello')\n```\n"
        )
        result = load_markdown_file(md_file)
        self.assertIn("print", result["html"])


class DocsViewTests(SimpleTestCase):
    def setUp(self):
        from docs import views as docs_views
        docs_views._cache = None

    def test_docs_index_redirects_to_getting_started(self):
        response = self.client.get("/docs/")
        self.assertRedirects(response, "/docs/getting-started/", fetch_redirect_response=False)

    def test_docs_page_status_200(self):
        response = self.client.get("/docs/getting-started/")
        self.assertEqual(response.status_code, 200)

    def test_docs_page_contains_sidebar(self):
        response = self.client.get("/docs/getting-started/")
        self.assertContains(response, "SCROLLS")

    def test_docs_page_renders_markdown_content(self):
        response = self.client.get("/docs/getting-started/")
        self.assertContains(response, "Getting Started")

    def test_docs_page_404_for_missing_slug(self):
        response = self.client.get("/docs/nonexistent-page/")
        self.assertEqual(response.status_code, 404)
