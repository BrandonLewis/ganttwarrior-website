from django.urls import include, path

urlpatterns = [
    path("docs/", include("docs.urls")),
    path("blog/", include("blog.urls")),
    path("", include("pages.urls")),
]
