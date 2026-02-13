# Generated manually for privacy controls

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0012_add_show_phone'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='dm_privacy',
            field=models.CharField(
                choices=[('everyone', 'Все'), ('nobody', 'Никто')],
                default='everyone',
                help_text='Кто может писать в личные сообщения',
                max_length=10,
            ),
        ),
    ]
