#!/usr/bin/env python3
"""
select-backlog-task.py

Reads .github/improvement-backlog.yml, selects the highest-priority
enabled task, and prints key=value pairs to stdout (for use with
>> $GITHUB_OUTPUT in GitHub Actions).

Usage:
    python3 .github/scripts/select-backlog-task.py
"""

import re
import sys


def get_field(block: str, name: str, default: str = "") -> str:
    m = re.search(r"^\s+" + re.escape(name) + r":\s*(.+)$", block, re.MULTILINE)
    return m.group(1).strip().strip("'\"") if m else default


def parse_backlog(path: str) -> list[dict]:
    with open(path) as f:
        content = f.read()

    entries = re.split(r"\n  - id:", content)
    parsed = []
    for block in entries[1:]:
        block = "  - id:" + block
        entry = {
            "id": get_field(block, "id"),
            "priority": int(get_field(block, "priority", "999")),
            "title": get_field(block, "title"),
            "label": get_field(block, "label", "improvement"),
            "branch_prefix": get_field(block, "branch_prefix"),
            "safe": get_field(block, "safe") == "true",
            "enabled": get_field(block, "enabled") == "true",
        }
        if entry["enabled"]:
            parsed.append(entry)

    return sorted(parsed, key=lambda x: x["priority"])


def main() -> None:
    backlog_path = ".github/improvement-backlog.yml"
    try:
        tasks = parse_backlog(backlog_path)
    except FileNotFoundError:
        print(f"No backlog file found at {backlog_path}; exiting.", file=sys.stderr)
        print("id=")
        return

    if not tasks:
        print("No enabled backlog items found.", file=sys.stderr)
        print("id=")
        return

    task = tasks[0]
    print(f"id={task['id']}")
    print(f"title={task['title']}")
    print(f"label={task['label']}")
    print(f"branch_prefix={task['branch_prefix']}")
    print(f"safe={str(task['safe']).lower()}")
    print(f"priority={task['priority']}")


if __name__ == "__main__":
    main()
