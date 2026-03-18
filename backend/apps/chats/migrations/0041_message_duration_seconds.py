# Generated manually for voice message duration display

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chats', '0040_add_message_channelpost_indexes'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='duration_seconds',
            field=models.FloatField(blank=True, null=True),
        ),
    ]
