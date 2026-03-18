# Generated manually for privacy controls

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_alter_user_options_alter_user_username_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='show_phone',
            field=models.BooleanField(default=True, help_text='Показывать другим номер телефона'),
        ),
    ]
