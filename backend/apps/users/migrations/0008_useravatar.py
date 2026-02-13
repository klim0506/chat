# Generated manually for UserAvatar model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0007_add_user_username"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserAvatar",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("image", models.ImageField(upload_to="user_avatars/")),
                ("order", models.PositiveSmallIntegerField(default=0)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="avatars", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["order", "id"],
            },
        ),
    ]
