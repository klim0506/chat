from rest_framework import serializers
from .models import Device, OneTimePreKey


class OneTimePreKeySerializer(serializers.ModelSerializer):
    """Read-only for key bundle; write-only for upload."""

    class Meta:
        model = OneTimePreKey
        fields = ("key_id", "public_key")


class DeviceSerializer(serializers.ModelSerializer):
    """List own devices."""

    class Meta:
        model = Device
        fields = ("id", "device_id", "name", "is_active", "created_at", "last_active_at")
        read_only_fields = fields


class DeviceRegisterSerializer(serializers.Serializer):
    """Register a new device: identity key, signed prekey, batch of one-time prekeys."""

    device_id = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=128, default="", allow_blank=True)
    identity_key = serializers.CharField()
    signed_prekey = serializers.CharField()
    signed_prekey_id = serializers.IntegerField(min_value=0)
    signed_prekey_sig = serializers.CharField()
    prekeys = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()),
        allow_empty=False,
        help_text="List of {key_id, public_key}",
    )

    def validate_prekeys(self, value):
        for i, pk in enumerate(value):
            if not isinstance(pk, dict):
                raise serializers.ValidationError(f"prekeys[{i}] must be an object")
            if "key_id" not in pk or "public_key" not in pk:
                raise serializers.ValidationError(f"prekeys[{i}] must have key_id and public_key")
        return value

    def create(self, validated_data):
        user = self.context["request"].user
        prekeys_data = validated_data.pop("prekeys")

        device = Device.objects.create(
            user=user,
            device_id=validated_data["device_id"],
            name=validated_data.get("name", "")[:128],
            identity_key=validated_data["identity_key"],
            signed_prekey=validated_data["signed_prekey"],
            signed_prekey_id=validated_data["signed_prekey_id"],
            signed_prekey_sig=validated_data["signed_prekey_sig"],
        )

        for pk in prekeys_data:
            OneTimePreKey.objects.create(
                device=device,
                key_id=pk["key_id"],
                public_key=pk["public_key"],
            )

        return device


class PreKeyUploadSerializer(serializers.Serializer):
    """Upload additional one-time prekeys when running low."""

    prekeys = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()),
        allow_empty=False,
    )

    def validate_prekeys(self, value):
        for i, pk in enumerate(value):
            if not isinstance(pk, dict):
                raise serializers.ValidationError(f"prekeys[{i}] must be an object")
            if "key_id" not in pk or "public_key" not in pk:
                raise serializers.ValidationError(f"prekeys[{i}] must have key_id and public_key")
        return value


class SignedPreKeyRotateSerializer(serializers.Serializer):
    """Rotate signed prekey for current device."""

    device_id = serializers.IntegerField(min_value=1)
    signed_prekey = serializers.CharField()
    signed_prekey_id = serializers.IntegerField(min_value=0)
    signed_prekey_sig = serializers.CharField()


class KeyBundleDeviceSerializer(serializers.Serializer):
    """Key bundle for one device (returned by GET /keys/{user_id}/)."""

    device_id = serializers.IntegerField()
    identity_key = serializers.CharField()
    signed_prekey = serializers.CharField()
    signed_prekey_id = serializers.IntegerField()
    signed_prekey_sig = serializers.CharField()
    one_time_prekey = serializers.DictField(allow_null=True)

