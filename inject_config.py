import os
import sys

CONFIG = os.environ.get("FIREBASE_CONFIG", "").strip()

if not CONFIG:
    print("ERROR: FIREBASE_CONFIG environment variable is not set.")
    sys.exit(1)

INJECTIONS = {
    "__FIREBASE_CONFIG__": CONFIG,
}

HTML_FILES = ["dist/app.js"]

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

