# -*- coding: utf-8 -*-
"""Helper to run backend and frontend servers (bypasses PowerShell/Cyrillic path issues)."""
import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))

def main():
    if len(sys.argv) < 2:
        print("Usage: python run_servers.py [backend|frontend]")
        sys.exit(1)
    cmd = sys.argv[1].lower()
    if cmd == "backend":
        os.chdir(os.path.join(ROOT, "backend"))
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.dev"
        subprocess.run([sys.executable, "manage.py", "runserver", "8000"], check=True, env=env)
    elif cmd == "frontend":
        os.chdir(os.path.join(ROOT, "frontend"))
        subprocess.run(["npm.cmd", "run", "dev"], check=True, shell=True)
    else:
        print("Unknown command. Use backend or frontend")
        sys.exit(1)

if __name__ == "__main__":
    main()
