# -*- coding: utf-8 -*-
"""Run backend or frontend tests (bypasses PowerShell/Cyrillic path issues). Run from repo root: python scripts/run_tests.py [backend|frontend] [extra args...]"""
import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    target = sys.argv[1].lower() if len(sys.argv) > 1 else "backend"
    extra = sys.argv[2:] if len(sys.argv) > 2 else []

    if target == "backend":
        os.chdir(os.path.join(ROOT, "backend"))
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
        os.environ["USE_SQLITE"] = "True"
        args = [sys.executable, "manage.py", "test", "--verbosity=2"] + extra
        sys.exit(subprocess.call(args))

    elif target == "frontend":
        os.chdir(os.path.join(ROOT, "frontend"))
        sys.exit(subprocess.call(["npm.cmd", "run", "test:unit"] + extra, shell=True))

    else:
        print("Usage: python scripts/run_tests.py [backend|frontend] [extra args...]")
        sys.exit(1)


if __name__ == "__main__":
    main()
