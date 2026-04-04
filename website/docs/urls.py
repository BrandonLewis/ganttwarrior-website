from django.urls import path
from django.http import HttpResponse

app_name = "docs"

urlpatterns = [
    path("", lambda r: HttpResponse(""), name="index"),
]
