# Generated migration for ReferralReward model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("payments", "0003_startransaction"),
    ]

    operations = [
        migrations.CreateModel(
            name="ReferralReward",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tier", models.PositiveSmallIntegerField(help_text="Referral count threshold (10, 40, 80)")),
                ("months_granted", models.PositiveSmallIntegerField(help_text="Subscription months awarded")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="referral_rewards",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Referral reward",
                "verbose_name_plural": "Referral rewards",
                "unique_together": {("user", "tier")},
            },
        ),
    ]
