from rest_framework.permissions import BasePermission


class HasActiveSubscription(BasePermission):
    """
    Allows access only to users with an active subscription
    (status=active or trial, and period has not expired).
    """
    message = "Для доступа необходима активная подписка."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        sub = getattr(request.user, "subscription", None)
        if sub is None:
            # Try loading directly
            from .models import UserSubscription
            sub = UserSubscription.objects.filter(user=request.user).first()
        if sub is None:
            return False
        return sub.is_valid
