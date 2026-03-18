import json
import os
import time

try:
    import resource
except ImportError:
    resource = None  # Windows has no resource module

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

django_asgi_app = get_asgi_application()

from apps.chats.routing import websocket_urlpatterns  # noqa: E402
from apps.chats.middleware import JWTAuthMiddleware


# #region agent log
class DebugWebSocketMiddleware:
    """Log WebSocket connect/disconnect for hypothesis B."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "websocket":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")

        async def wrapped_receive():
            msg = await receive()
            try:
                if msg.get("type") == "websocket.connect":
                    with open("/root/.cursor/debug-032ba1.log", "a") as f:
                        f.write(
                            json.dumps(
                                {
                                    "sessionId": "032ba1",
                                    "hypothesisId": "B",
                                    "location": "config/asgi.py:ws_connect",
                                    "message": "WebSocket connect",
                                    "data": {"path": path},
                                    "timestamp": int(time.time() * 1000),
                                }
                            )
                            + "\n"
                        )
                elif msg.get("type") == "websocket.disconnect":
                    with open("/root/.cursor/debug-032ba1.log", "a") as f:
                        f.write(
                            json.dumps(
                                {
                                    "sessionId": "032ba1",
                                    "hypothesisId": "B",
                                    "location": "config/asgi.py:ws_disconnect",
                                    "message": "WebSocket disconnect",
                                    "data": {"path": path, "code": msg.get("code")},
                                    "timestamp": int(time.time() * 1000),
                                }
                            )
                            + "\n"
                        )
            except Exception:
                pass
            return msg

        return await self.app(scope, wrapped_receive, send)
# #endregion


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": DebugWebSocketMiddleware(
            AllowedHostsOriginValidator(
                JWTAuthMiddleware(URLRouter(websocket_urlpatterns))
            )
        ),
    }
)

# #region agent log
try:
    rss_mb = (
        round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 2)
        if resource is not None
        else None
    )
    with open("/root/.cursor/debug-032ba1.log", "a") as f:
        f.write(
            json.dumps(
                {
                    "sessionId": "032ba1",
                    "hypothesisId": "A",
                    "location": "config/asgi.py:load",
                    "message": "ASGI app loaded",
                    "data": {"pid": os.getpid(), "rss_mb": rss_mb},
                    "timestamp": int(time.time() * 1000),
                }
            )
            + "\n"
        )
except Exception:
    pass
# #endregion
