#!/usr/bin/env python3
import os
import re
import ast
import sys

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_path = os.path.join(base_dir, "backend", "app", "application", "services", "custom_field_service.py")
    frontend_path = os.path.join(base_dir, "frontend", "lib", "customFieldTypes.ts")
    mobile_path = os.path.join(base_dir, "mobile", "src", "lib", "customFieldTypes.ts")

    for p in [backend_path, frontend_path, mobile_path]:
        if not os.path.exists(p):
            print(f"Error: Could not find {p}")
            sys.exit(1)

    # Read backend
    with open(backend_path, "r") as f:
        backend_content = f.read()
        match = re.search(r'CUSTOM_FIELD_TYPES = (\[.*?\])', backend_content)
        if not match:
            print("Error: Could not find CUSTOM_FIELD_TYPES in backend")
            sys.exit(1)
        backend_types = ast.literal_eval(match.group(1).replace('"', "'"))

    def extract_types(path):
        with open(path, "r") as f:
            content = f.read()
        match = re.search(r'export const CUSTOM_FIELD_TYPES = (\[.*?\])', content, re.DOTALL)
        if not match:
            print(f"Error: Could not find CUSTOM_FIELD_TYPES in {path}")
            sys.exit(1)
        val = match.group(1).replace('"', "'")
        return ast.literal_eval(val)

    frontend_types = extract_types(frontend_path)
    mobile_types = extract_types(mobile_path)

    if set(frontend_types) != set(backend_types):
        print(f"Mismatch! Backend has {backend_types}, Frontend has {frontend_types}")
        sys.exit(1)
        
    if set(mobile_types) != set(backend_types):
        print(f"Mismatch! Backend has {backend_types}, Mobile has {mobile_types}")
        sys.exit(1)

    print("Type sync successful. All client lists match the backend.")
    sys.exit(0)

if __name__ == "__main__":
    main()
