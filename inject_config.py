import os
import sys
import json

CONFIG = os.environ.get("FIREBASE_CONFIG", "").strip()
SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "").strip()

if not CONFIG:
    print("ERROR: FIREBASE_CONFIG environment variable is not set.")
    sys.exit(1)

if not SUPER_ADMIN_EMAIL:
    print("ERROR: SUPER_ADMIN_EMAIL environment variable is not set.")
    sys.exit(1)

INJECTIONS = {
    "__FIREBASE_CONFIG__": CONFIG,
    # Wrap in a JS string literal so the placeholder is valid JS before injection
    '"__SUPER_ADMIN__"': json.dumps(SUPER_ADMIN_EMAIL),
}

HTML_FILES = ["app.js"]

for HTML_FILE in HTML_FILES:
    if not os.path.exists(HTML_FILE):
        print(f"SKIP: {HTML_FILE} not found.")
        continue
    with open(HTML_FILE, "r", encoding="utf-8") as f:
        content = f.read()
    for placeholder, value in INJECTIONS.items():
        if placeholder not in content:
            print(f"WARNING: placeholder '{placeholder}' not found in {HTML_FILE}.")
            continue
        content = content.replace(placeholder, value)
        print(f"✓ Injected '{placeholder}' into {HTML_FILE}.")
    with open(HTML_FILE, "w", encoding="utf-8") as f:
        f.write(content)

