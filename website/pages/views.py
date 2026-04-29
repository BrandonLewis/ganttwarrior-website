from django.views.generic import TemplateView


class HomeView(TemplateView):
    template_name = "pages/home.html"


class FeaturesView(TemplateView):
    template_name = "pages/features.html"


class AboutView(TemplateView):
    template_name = "pages/about.html"


class MonitorView(TemplateView):
    template_name = "pages/monitor.html"
