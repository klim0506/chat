"""Debug instrumentation for ERR_CONNECTION_RESET investigation."""

import json
import time
from django.utils.deprecation import MiddlewareMixin

# Written in container; copy out with: docker cp privat-chaty-prod-backend-1:/tmp/debug-8ded85.log <workspace>/.cursor/debug-8ded85.log
DEBUG_LOG = "/tmp/debug-8ded85.log"
SESSION_ID = "8ded85"


def _append_log(message: str, data: dict, hypothesis_id: str, run_id: str = "run1"):
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(
                json.dumps(
                    {
                        "sessionId": SESSION_ID,
                        "runId": run_id,
                        "hypothesisId": hypothesis_id,
                        "location": "config/debug_middleware.py",
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                    }
                )
                + "\n"
            )
    except Exception:
        pass


# #region agent log
class DebugConnectionMiddleware(MiddlewareMixin):
    """Log request start/end: H4=reached Django, H3=response sent. Missing H4 => reset before app (H1/H2/H4/H5). H4 without H3 => reset after request before response (H3)."""

    def process_request(self, request):
        request._debug_req_start = time.time()
        client_ip = request.META.get("HTTP_X_FORWARDED_FOR", request.META.get("REMOTE_ADDR", ""))
        host = request.META.get("HTTP_HOST", "")
        _append_log(
            "HTTP req start",
            {"path": request.path, "method": request.method, "client_ip": client_ip, "host": host},
            "H4",
        )
        return None

    def process_response(self, request, response):
        if hasattr(request, "_debug_req_start"):
            elapsed_ms = int((time.time() - request._debug_req_start) * 1000)
            _append_log(
                "HTTP req end",
                {
                    "path": request.path,
                    "status": response.status_code,
                    "elapsed_ms": elapsed_ms,
                },
                "H3",
            )
        return response
# #endregion
