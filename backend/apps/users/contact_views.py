"""API для контактов (локальное имя пользователя — видно только владельцу)."""
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404

from .models import Contact, User
from .serializers import ContactSerializer, ContactCreateSerializer


class ContactListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Contact.objects.filter(owner=request.user).select_related("contact_user")
        return Response(ContactSerializer(qs, many=True, context={"request": request}).data)

    def post(self, request):
        ser = ContactCreateSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        contact = ser.save()
        return Response(ContactSerializer(contact, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ContactDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        contact = get_object_or_404(Contact, id=pk, owner=request.user)
        local_name = request.data.get("local_name")
        if local_name is None:
            return Response({"detail": "Укажите local_name."}, status=status.HTTP_400_BAD_REQUEST)
        contact.local_name = str(local_name).strip()[:255]
        contact.save(update_fields=["local_name", "updated_at"])
        return Response(ContactSerializer(contact, context={"request": request}).data)

    def delete(self, request, pk):
        contact = get_object_or_404(Contact, id=pk, owner=request.user)
        contact.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
