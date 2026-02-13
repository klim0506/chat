# Generated manually for E2EE file encryption

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('files', '0002_fileattachment_scan_details_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='fileattachment',
            name='is_encrypted',
            field=models.BooleanField(
                default=False,
                help_text='E2EE: file is opaque ciphertext, skip MIME/AV validation',
            ),
        ),
        migrations.AlterField(
            model_name='fileattachment',
            name='scan_status',
            field=models.CharField(
                choices=[
                    ('clean', 'Clean'),
                    ('pending', 'Pending scan'),
                    ('infected', 'Infected'),
                    ('error', 'Scan error'),
                    ('encrypted', 'E2EE encrypted (skip scan)'),
                ],
                db_index=True,
                default='clean',
                max_length=16,
            ),
        ),
    ]
