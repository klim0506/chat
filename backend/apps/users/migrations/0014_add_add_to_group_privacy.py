# Generated manually for privacy controls

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0013_add_dm_privacy'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='add_to_group_privacy',
            field=models.CharField(
                choices=[('everyone', 'Все'), ('nobody', 'Никто')],
                default='everyone',
                help_text='Кто может добавлять в группы',
                max_length=10,
            ),
        ),
    ]
