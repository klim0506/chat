from django.db import IntegrityError
from django.test import TestCase
from rest_framework.exceptions import ValidationError

from apps.users.models import User
from apps.users.serializers import validate_username_format


class UsernameCaseSensitiveUniqueTests(TestCase):
    def test_allows_usernames_with_different_case(self):
        User.objects.create_user(phone="+79990000021", username="Alice_1")
        second = User.objects.create_user(phone="+79990000022", username="alice_1")
        self.assertEqual(second.username, "alice_1")

    def test_rejects_exact_duplicate_username(self):
        User.objects.create_user(phone="+79990000023", username="Bob_1")
        with self.assertRaises(IntegrityError):
            User.objects.create_user(phone="+79990000024", username="Bob_1")


class UsernameValidationTests(TestCase):
    """TOTEST §15: regex validation ^[A-Za-z0-9_]{3,30}$."""

    def test_valid_alphanumeric_underscore(self):
        """Ab_123 is valid."""
        result = validate_username_format("Ab_123")
        self.assertEqual(result, "Ab_123")

    def test_too_short_rejected(self):
        """Username with 2 characters → validation error (min 3)."""
        with self.assertRaises(ValidationError):
            validate_username_format("ab")

    def test_special_char_rejected(self):
        """Username with special character → validation error."""
        with self.assertRaises(ValidationError):
            validate_username_format("ab!cd")

    def test_too_long_rejected(self):
        """Username with 31 characters → validation error (max 30)."""
        with self.assertRaises(ValidationError):
            validate_username_format("a" * 31)

    def test_exactly_3_chars_valid(self):
        result = validate_username_format("abc")
        self.assertEqual(result, "abc")

    def test_exactly_30_chars_valid(self):
        result = validate_username_format("a" * 30)
        self.assertEqual(result, "a" * 30)

    def test_empty_rejected(self):
        with self.assertRaises(ValidationError):
            validate_username_format("")

    def test_spaces_rejected(self):
        with self.assertRaises(ValidationError):
            validate_username_format("ab cd")
