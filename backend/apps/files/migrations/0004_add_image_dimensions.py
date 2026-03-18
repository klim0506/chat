# Image dimensions for layout stability (no shift when images load)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('files', '0003_fileattachment_is_encrypted'),
    ]

    operations = [
        migrations.AddField(
            model_name='fileattachment',
            name='width_px',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='fileattachment',
            name='height_px',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
