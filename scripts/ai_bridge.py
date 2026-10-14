#!/usr/bin/env python3
"""Compare Claude and Grok on one task. Run from GitHub Actions or Colab.

Requires ANTHROPIC_API_KEY, XAI_API_KEY and TASK in environment.
Does not print credentials, does not write credentials to disk.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


def post_json(url, headers, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=180) as response:
            return json.load(response)
    except error.HTTPError as exc:
        # Deliberately omit the response body, which might contain sensitive data.
        raise RuntimeError(f"Provider returned HTTP {exc.code}") from None
    except error.URLError:
        raise RuntimeError("Provider connection failed") from None


def claude(task, key):
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
    payload = {
        "model": model,
        "max_tokens": 1800,
        "messages": [{"role": "user", "content": task}],
    }
    result = post_json(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
        payload,
    )
    answer = "\n".join(
        x.get("text", "") for x in result.get("content", [])
        if x.get("type") == "text"
    ).strip()
    return answer or "(Claude did not return visible text.)"


def grok(task, key):
    model = os.getenv("GROK_MODEL", "grok-4.7")
    result = post_json(
        "https://api.x.ai/v1/responses",
        {"Authorization": f"Bearer {key}"},
        {"model": model, "input": task, "max_output_tokens": 3500},
    )
    parts = []
    for item in result.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") in ("output_text", "text"):
                    parts.append(content.get("text", ""))
    return "\n".join(parts).strip() or "(Grok did not return visible text.)"


def main():
    task = os.getenv("TASK", "").strip()
    claude_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    grok_key = os.getenv("XAI_API_KEY", "").strip()
    if not task:
        raise SystemExit("Set TASK to a non-empty task.")
    if len(task) > 16000:
        raise SystemExit("TASK is too long (max 16,000 characters).")
    missing = [
        k for k, value in (
            ("ANTHROPIC_API_KEY", claude_key), ("XAI_API_KEY", grok_key)
        ) if not value
    ]
    if missing:
        raise SystemExit("Configure required secrets: " + ", ".join(missing))

    providers = [("Claude", claude, claude_key), ("Grok", grok, grok_key)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [(name, pool.submit(fn, task, key)) for name, fn, key in providers]
        responses = []
        failures = 0
        for name, future in futures:
            try:
                responses.append((name, future.result()))
                print(f"{name}: request completed.")
            except Exception as exc:
                failures += 1
                # Never print headers, request payloads, or API keys.
                responses.append((name, f"ERROR: {type(exc).__name__}: {exc}"))
                print(f"{name}: request failed.")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Claude + Grok AI review", "",
        f"Generated: {stamp}", "",
        "## Task", "", task, "",
    ]
    for name, answer in responses:
        lines.extend([f"## {name}", "", answer, ""])
    lines.extend([
        "## Next step", "",
        "Ask ChatGPT to review the two outputs and decide what to implement.",
        "No API credentials are included in this report.", "",
    ])
    Path("ai-review.md").write_text("\n".join(lines), encoding="utf-8")
    print("Report saved to ai-review.md")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
