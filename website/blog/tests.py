from django.test import SimpleTestCase


class BlogViewTests(SimpleTestCase):
    def setUp(self):
        from blog import views as blog_views
        blog_views._cache = None

    def test_blog_index_status_200(self):
        response = self.client.get("/blog/")
        self.assertEqual(response.status_code, 200)

    def test_blog_index_contains_chronicles(self):
        response = self.client.get("/blog/")
        self.assertContains(response, "CHRONICLES")

    def test_blog_index_lists_posts(self):
        response = self.client.get("/blog/")
        self.assertContains(response, "Introducing GanttWarrior")

    def test_blog_detail_status_200(self):
        response = self.client.get("/blog/introducing-ganttwarrior/")
        self.assertEqual(response.status_code, 200)

    def test_blog_detail_renders_content(self):
        response = self.client.get("/blog/introducing-ganttwarrior/")
        self.assertContains(response, "Introducing GanttWarrior")

    def test_blog_detail_404_for_missing_slug(self):
        response = self.client.get("/blog/nonexistent-post/")
        self.assertEqual(response.status_code, 404)
