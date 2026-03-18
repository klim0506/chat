# Chunked upload session (Telegram-style: parts on disk, no full file in RAM)

import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('files', '0004_add_image_dimensions'),
    ]

    operations = [
        migrations.CreateModel(
            name='ChunkedUploadSession',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('temp_dir', models.CharField(max_length=512)),
                ('original_name', models.CharField(max_length=512)),
                ('mime_type', models.CharField(default='application/octet-stream', max_length=255)),
                ('total_parts', models.PositiveIntegerField()),
                ('chat_id', models.UUIDField(blank=True, null=True)),
                ('is_encrypted', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chunked_upload_sessions', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
