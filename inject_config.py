"""
inject_config.py
Replaces the __FIREBASE_CONFIG__ placeholder in auditor-calendar.html
with the real Firebase config JSON supplied via the FIREBASE_CONFIG env variable.

This script is called by the GitHub Actions deploy workflow — it never runs
in production; only during the CI build before deploying to gh-pages.
"""
import os
import sys

CONFIG = os.environ.get("FIREBASE_CONFIG", "").strip()

if not CONFIG:
    print("ERROR: FIREBASE_CONFIG environment variable is not set.")
    sys.exit(1)

PLACEHOLDER = "__FIREBASE_CONFIG__"
HTML_FILE = "auditor-calendar.html"

with open(HTML_FILE, "r", encoding="utf-8") as f:
    content = f.read()

if PLACEHOLDER not in content:
    print(f"WARNING: placeholder '{PLACEHOLDER}' not found in {HTML_FILE}.")
    sys.exit(0)

content = content.replace(PLACEHOLDER, CONFIG)

with open(HTML_FILE, "w", encoding="utf-8") as f:
    f.write(content)

print(f"✓ Firebase config injected into {HTML_FILE}.")
