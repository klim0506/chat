# Фоновое изображение чата (настраивается в описании группы)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0013_pin_messages"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="background",
            field=models.ImageField(blank=True, help_text="Фоновое изображение чата", null=True, upload_to="chat_backgrounds/"),
        ),
    ]
