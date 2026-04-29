from django.urls import path

from . import views

app_name = "pages"

urlpatterns = [
    path("", views.HomeView.as_view(), name="home"),
    path("features/", views.FeaturesView.as_view(), name="features"),
    path("about/", views.AboutView.as_view(), name="about"),
    path("monitor/", views.MonitorView.as_view(), name="monitor"),
]
