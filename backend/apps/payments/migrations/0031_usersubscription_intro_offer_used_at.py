from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0030_referral_rewards"),
    ]

    operations = [
        migrations.AddField(
            model_name="usersubscription",
            name="intro_offer_used_at",
            field=models.DateTimeField(
                blank=True,
                help_text="Когда пользователь впервые использовал платный intro-offer",
                null=True,
            ),
        ),
    ]
