# Personal chat — a separate entity: no type, no invite link.
# A group (even with 2 members) remains a group with type open/closed.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chats", "0014_add_chat_background"),
    ]

    operations = [
        migrations.AddField(
            model_name="chat",
            name="is_personal",
            field=models.BooleanField(
                default=False,
                help_text="Личный чат (на двоих, без ссылки-приглашения и без типа). Группа из 2 человек — не личный чат.",
            ),
        ),
        migrations.AlterField(
            model_name="chat",
            name="chat_type",
            field=models.CharField(
                blank=True,
                choices=[("open", "Открытый"), ("closed", "Закрытый")],
                max_length=10,
                null=True,
            ),
        ),
    ]
