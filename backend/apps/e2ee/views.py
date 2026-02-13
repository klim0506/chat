import logging
from uuid import UUID
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Device, OneTimePreKey
from .serializers import (
    DeviceSerializer,
    DeviceRegisterSerializer,
    PreKeyUploadSerializer,
    SignedPreKeyRotateSerializer,
    KeyBundleDeviceSerializer,
)

logger = logging.getLogger(__name__)

PREKEY_LOW_THRESHOLD = 20


class DeviceViewSet(viewsets.ViewSet):
    """CRUD for current user's E2EE devices."""

    def list(self, request):
        devices = Device.objects.filter(user=request.user, is_active=True).order_by("device_id")
        serializer = DeviceSerializer(devices, many=True)
        return Response(serializer.data)

    def create(self, request):
        serializer = DeviceRegisterSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        device = serializer.save()
        return Response(DeviceSerializer(device).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        device = get_object_or_404(Device, pk=pk, user=request.user)
        device.is_active = False
        device.save()
        OneTimePreKey.objects.filter(device=device).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class KeyBundleView(APIView):
    """
    GET /api/e2ee/keys/<user_id>/
    Returns key bundles for all active devices of the user.
    For each device: IK, SPK, SPK_sig, and one unused OPK (marked is_used after return).
    """

    def get(self, request, user_id):
        try:
            target_uuid = UUID(str(user_id))
        except (TypeError, ValueError):
            return Response({"detail": "Invalid user_id."}, status=status.HTTP_400_BAD_REQUEST)

        devices = (
            Device.objects.filter(user_id=target_uuid, is_active=True)
            .prefetch_related("prekeys")
            .order_by("device_id")
        )

        bundles = []
        for device in devices:
            # Get one unused OPK
            opk = (
                OneTimePreKey.objects.filter(device=device, is_used=False)
                .order_by("key_id")
                .first()
            )
            opk_data = None
            if opk:
                opk_data = {"key_id": opk.key_id, "public_key": opk.public_key}
                opk.is_used = True
                opk.save(update_fields=["is_used"])

            # Notify device owner if prekeys run low
            remaining = OneTimePreKey.objects.filter(device=device, is_used=False).count()
            if remaining < PREKEY_LOW_THRESHOLD:
                try:
                    from asgiref.sync import async_to_sync
                    from channels.layers import get_channel_layer
                    channel_layer = get_channel_layer()
                    if channel_layer:
                        async_to_sync(channel_layer.group_send)(
                            f"user_{device.user_id}",
                            {
                                "type": "e2ee.prekeys_low",
                                "device_id": device.device_id,
                                "remaining": remaining,
                            },
                        )
                except Exception:
                    pass

            bundles.append(
                {
                    "device_id": device.device_id,
                    "identity_key": device.identity_key,
                    "signed_prekey": device.signed_prekey,
                    "signed_prekey_id": device.signed_prekey_id,
                    "signed_prekey_sig": device.signed_prekey_sig,
                    "one_time_prekey": opk_data,
                }
            )

        return Response({"devices": bundles})


class PreKeyUploadView(APIView):
    """POST /api/e2ee/keys/prekeys/ — upload new one-time prekeys for a device."""

    def post(self, request):
        serializer = PreKeyUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        device_id = request.data.get("device_id")
        if device_id is None:
            return Response({"detail": "device_id required."}, status=status.HTTP_400_BAD_REQUEST)

        device = get_object_or_404(
            Device, user=request.user, device_id=device_id, is_active=True
        )
        prekeys_data = serializer.validated_data["prekeys"]

        for pk in prekeys_data:
            OneTimePreKey.objects.update_or_create(
                device=device,
                key_id=pk["key_id"],
                defaults={"public_key": pk["public_key"], "is_used": False},
            )

        count = OneTimePreKey.objects.filter(device=device, is_used=False).count()
        return Response({"unused_prekeys_count": count})


class SignedPreKeyRotateView(APIView):
    """PUT /api/e2ee/keys/signed-prekey/ — rotate signed prekey for a device."""

    def put(self, request):
        serializer = SignedPreKeyRotateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        device = get_object_or_404(
            Device, user=request.user, device_id=data["device_id"], is_active=True
        )
        device.signed_prekey = data["signed_prekey"]
        device.signed_prekey_id = data["signed_prekey_id"]
        device.signed_prekey_sig = data["signed_prekey_sig"]
        device.save(update_fields=["signed_prekey", "signed_prekey_id", "signed_prekey_sig"])

        return Response(DeviceSerializer(device).data)
