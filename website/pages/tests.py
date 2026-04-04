from django.test import SimpleTestCase


class PagesViewTests(SimpleTestCase):
    def test_home_page_status_200(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)

    def test_home_page_contains_title(self):
        response = self.client.get("/")
        self.assertContains(response, "T H E  G A N T T  W A R R I O R")

    def test_features_page_status_200(self):
        response = self.client.get("/features/")
        self.assertEqual(response.status_code, 200)

    def test_features_page_contains_arsenal(self):
        response = self.client.get("/features/")
        self.assertContains(response, "ARSENAL")

    def test_about_page_status_200(self):
        response = self.client.get("/about/")
        self.assertEqual(response.status_code, 200)

    def test_about_page_contains_author(self):
        response = self.client.get("/about/")
        self.assertContains(response, "Brandon Lewis")
