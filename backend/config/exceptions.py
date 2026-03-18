"""
Custom exception handler for REST framework.
Returns user-friendly messages for throttle (429) in Russian.
"""
from rest_framework.views import exception_handler
from rest_framework.exceptions import Throttled


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, Throttled):
        wait = getattr(exc, "wait", None)
        if wait is not None:
            response.data = {
                "detail": f"Слишком много запросов. Попробуйте снова через {int(wait)} сек.",
                "wait": int(wait),
            }
        else:
            response.data = {
                "detail": "Слишком много запросов. Попробуйте позже.",
                "wait": 60,
            }
    return response
