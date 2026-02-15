#!/usr/bin/env python3
"""
Send test messages via API for two-account chat testing.
Usage: python scripts/send-test-messages.py [--api-url http://localhost:8000] [--fixtures-dir path]

Flow: login AI (+71234567890) → get/create DM with User (+71111111111) → send messages.
Requires AUTH_DEBUG, AUTH_DEBUG_PHONES, AUTH_DEBUG_CODE in backend .env.
"""
import argparse
import sys
from pathlib import Path

import requests

AI_PHONE = "+71234567890"
USER_PHONE = "+71111111111"
DEBUG_CODE = "123456"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default="http://localhost:8000", help="Backend API base URL")
    parser.add_argument("--fixtures-dir", type=Path, help="Path to e2e-fixtures (optional)")
    args = parser.parse_args()
    base = args.api_url.rstrip("/")
    api = f"{base}/api"

    session = requests.Session()
    session.headers["Content-Type"] = "application/json"

    # 1. Login as AI
    print("1. Logging in as AI (+71234567890)...")
    r = session.post(f"{api}/auth/send-code/", json={"phone": AI_PHONE})
    if r.status_code != 200:
        print(f"   send-code failed: {r.status_code} {r.text}")
        return 1
    r = session.post(f"{api}/auth/verify-code/", json={"phone": AI_PHONE, "code": DEBUG_CODE})
    if r.status_code != 200:
        print(f"   verify-code failed: {r.status_code} {r.text}")
        return 1
    data = r.json()
    token = data.get("access")
    if not token:
        print("   No access token in response")
        return 1
    session.headers["Authorization"] = f"Bearer {token}"
    ai_user_id = data.get("user", {}).get("id")
    print(f"   OK, user_id={ai_user_id}")

    # 2. Get User (+71111111111) id – search or create DM will need the other user's id
    # We need to find USER's id. Options: /auth/me with User token, or /users/search
    # For DM we need user_id of +71111111111. Login as User to get it.
    print("2. Getting User (+71111111111) id...")
    user_session = requests.Session()
    user_session.headers["Content-Type"] = "application/json"
    r = user_session.post(f"{api}/auth/send-code/", json={"phone": USER_PHONE})
    if r.status_code != 200:
        print(f"   send-code User failed: {r.status_code} {r.text}")
        return 1
    r = user_session.post(f"{api}/auth/verify-code/", json={"phone": USER_PHONE, "code": DEBUG_CODE})
    if r.status_code != 200:
        print(f"   verify-code User failed: {r.status_code} {r.text}")
        return 1
    user_data = r.json()
    user_id = user_data.get("user", {}).get("id")
    if not user_id:
        print("   No user id for +71111111111")
        return 1
    print(f"   User id={user_id}")

    # 3. Get or create DM
    print("3. Getting/creating DM...")
    r = session.post(f"{api}/chats/dm/", json={"user_id": user_id})
    if r.status_code not in (200, 201):
        print(f"   DM failed: {r.status_code} {r.text}")
        return 1
    chat = r.json()
    chat_id = chat["id"]
    print(f"   Chat id={chat_id}")

    # 4. Send text messages
    print("4. Sending text messages...")
    for content in [
        "Привет",
        "Это длинное сообщение " + "а" * 200 + " для проверки переноса и обрезки.",
        "**жирный** и *курсив*",
    ]:
        r = session.post(f"{api}/chats/{chat_id}/messages/", json={"msg_type": "text", "content": content})
        if r.status_code not in (200, 201):
            print(f"   Failed: {r.status_code} {r.text}")
        else:
            print(f"   Sent: {content[:50]}...")

    # 5. Send file messages if fixtures exist
    fixtures_dir = args.fixtures_dir or (Path(__file__).resolve().parent.parent / "frontend" / "public" / "e2e-fixtures")
    if fixtures_dir.exists():
        # Upload and send photo1
        photo1 = fixtures_dir / "photo1.png"
        if photo1.exists():
            print("5. Uploading photo1.png...")
            with open(photo1, "rb") as f:
                r = session.post(
                    f"{api}/files/upload/",
                    files={"file": ("photo1.png", f, "image/png")},
                    data={"chat_id": chat_id},
                )
            if r.status_code == 200:
                fid = r.json().get("id")
                if fid:
                    session.post(
                        f"{api}/chats/{chat_id}/messages/",
                        json={"msg_type": "file", "content": "", "file_id": str(fid)},
                    )
                    print("   Sent photo1")
        # Multiple photos
        for name in ["photo2.png", "photo3.png"]:
            p = fixtures_dir / name
            if p.exists():
                with open(p, "rb") as f:
                    r = session.post(
                        f"{api}/files/upload/",
                        files={"file": (name, f, "image/png")},
                        data={"chat_id": chat_id},
                    )
                if r.status_code == 200:
                    fid = r.json().get("id")
                    if fid:
                        session.post(
                            f"{api}/chats/{chat_id}/messages/",
                            json={"msg_type": "file", "content": "", "file_ids": [str(fid)]},
                        )
                        print(f"   Sent {name}")
        # Document
        doc = fixtures_dir / "doc.pdf"
        if doc.exists():
            with open(doc, "rb") as f:
                r = session.post(
                    f"{api}/files/upload/",
                    files={"file": ("doc.pdf", f, "application/pdf")},
                    data={"chat_id": chat_id},
                )
            if r.status_code == 200:
                fid = r.json().get("id")
                if fid:
                    session.post(
                        f"{api}/chats/{chat_id}/messages/",
                        json={"msg_type": "file", "content": "doc.pdf", "file_id": str(fid)},
                    )
                    print("   Sent doc.pdf")
        # Audio
        audio = fixtures_dir / "audio.webm"
        if audio.exists():
            with open(audio, "rb") as f:
                r = session.post(
                    f"{api}/files/upload/",
                    files={"file": ("audio.webm", f, "audio/webm")},
                    data={"chat_id": chat_id},
                )
            if r.status_code == 200:
                fid = r.json().get("id")
                if fid:
                    session.post(
                        f"{api}/chats/{chat_id}/messages/",
                        json={"msg_type": "audio", "content": "", "file_id": str(fid)},
                    )
                    print("   Sent audio.webm")
        # Video circle
        video = fixtures_dir / "video.webm"
        if video.exists():
            with open(video, "rb") as f:
                r = session.post(
                    f"{api}/files/upload/",
                    files={"file": ("video.webm", f, "video/webm")},
                    data={"chat_id": chat_id},
                )
            if r.status_code == 200:
                fid = r.json().get("id")
                if fid:
                    session.post(
                        f"{api}/chats/{chat_id}/messages/",
                        json={"msg_type": "video_circle", "content": "", "file_id": str(fid)},
                    )
                    print("   Sent video.webm")
    else:
        print("5. Fixtures dir not found, skipping file messages")

    # 6. Verify
    print("6. Verifying messages...")
    r = session.get(f"{api}/chats/{chat_id}/messages/")
    if r.status_code == 200:
        msgs = r.json()
        print(f"   Total messages: {len(msgs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
