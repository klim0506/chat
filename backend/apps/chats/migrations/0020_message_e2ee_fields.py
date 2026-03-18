# Generated manually for E2EE Message fields

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0019_chatmember_pin_order"),
        ("e2ee", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="is_encrypted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="message",
            name="encrypted_keys",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="message",
            name="sender_device",
            field=models.ForeignKey(
                blank=True,
                help_text="Устройство отправителя (для E2EE)",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sent_messages",
                to="e2ee.device",
            ),
        ),
    ]
