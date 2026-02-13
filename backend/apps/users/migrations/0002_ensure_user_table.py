# If 0001 was faked and users_user table doesn't exist, create it.

from django.db import connection, migrations


def table_exists(cursor, table_name):
    vendor = connection.vendor
    if vendor == "sqlite":
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=%s",
            [table_name],
        )
    else:
        cursor.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema=%s AND table_name=%s",
            ["public", table_name],
        )
    return cursor.fetchone() is not None


def ensure_user_table(apps, schema_editor):
    with connection.cursor() as cursor:
        if table_exists(cursor, "users_user"):
            return
    User = apps.get_model("users", "User")
    schema_editor.create_model(User)


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(ensure_user_table, migrations.RunPython.noop),
    ]
