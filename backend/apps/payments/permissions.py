from rest_framework.permissions import BasePermission


class HasActiveSubscription(BasePermission):
    """
    Разрешает доступ только пользователям с действующей подпиской
    (status=active или trial, и период не истёк).
    """
    message = "Для доступа необходима активная подписка."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        sub = getattr(request.user, "subscription", None)
        if sub is None:
            # Попробуем загрузить напрямую
            from .models import UserSubscription
            sub = UserSubscription.objects.filter(user=request.user).first()
        if sub is None:
            return False
        return sub.is_valid
