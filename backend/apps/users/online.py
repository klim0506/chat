"""
In-memory tracker for online users.
Stores a set of user IDs (as strings) that are currently connected via WebSocket.
"""
import threading

_lock = threading.Lock()
_online_users: set[str] = set()


def set_online(user_id: str) -> None:
    with _lock:
        _online_users.add(str(user_id))


def set_offline(user_id: str) -> None:
    with _lock:
        _online_users.discard(str(user_id))


def is_online(user_id: str) -> bool:
    with _lock:
        return str(user_id) in _online_users


def get_online_user_ids() -> set[str]:
    with _lock:
        return set(_online_users)
