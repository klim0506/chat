# Generated manually for case-insensitive username uniqueness

from django.db import migrations, models
from django.db.models import Q
from django.db.models.functions import Lower


def resolve_case_collisions(apps, schema_editor):
    """Resolve username case collisions before adding CI constraint.
    For each group of users whose usernames match case-insensitively,
    keep the first (by date_joined) and append _1, _2, etc. to the rest.
    """
    User = apps.get_model("users", "User")
    users_with_username = User.objects.exclude(username__isnull=True).exclude(username="")
    # Group by lower(username)
    from collections import defaultdict
    groups = defaultdict(list)
    for u in users_with_username.order_by("date_joined", "id"):
        key = (u.username or "").lower().strip()
        if key:
            groups[key].append(u)

    for key, users in groups.items():
        if len(users) <= 1:
            continue
        # First user keeps the username; others get _1, _2, ...
        for i, u in enumerate(users[1:], start=1):
            base = users[0].username  # keep original casing for the "winner"
            attempt = f"{base}_{i}"
            while User.objects.filter(username__iexact=attempt).exclude(pk=u.pk).exists():
                i += 1
                attempt = f"{base}_{i}"
            u.username = attempt
            u.save()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0015_create_usersession"),
    ]

    operations = [
        migrations.RunPython(resolve_case_collisions, noop),
        migrations.RemoveConstraint(
            model_name="user",
            name="users_username_unique_cs",
        ),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                Lower("username"),
                condition=Q(username__isnull=False),
                name="users_username_unique_ci",
            ),
        ),
    ]
