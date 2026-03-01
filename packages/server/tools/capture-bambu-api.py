"""
mitmproxy addon to capture Bambu Lab Cloud API traffic.
Usage: mitmdump -p 8888 -s capture-bambu-api.py

Then configure BambuStudio to use HTTP proxy localhost:8888.
"""
import json
import datetime
from mitmproxy import http

LOG_FILE = "bambu-api-capture.jsonl"

def request(flow: http.HTTPFlow):
    if "bambulab.com" not in (flow.request.pretty_host or ""):
        return

    entry = {
        "ts": datetime.datetime.now().isoformat(),
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "req_headers": dict(flow.request.headers),
    }

    # Capture request body
    if flow.request.content:
        try:
            entry["req_body"] = json.loads(flow.request.content)
        except Exception:
            body = flow.request.content
            if len(body) > 500:
                entry["req_body"] = f"<binary {len(body)} bytes>"
            else:
                entry["req_body"] = body.decode("utf-8", errors="replace")

    flow.metadata["capture_entry"] = entry

def response(flow: http.HTTPFlow):
    if "bambulab.com" not in (flow.request.pretty_host or ""):
        return

    entry = flow.metadata.get("capture_entry", {})
    entry["status"] = flow.response.status_code

    # Capture response body
    if flow.response.content:
        try:
            entry["res_body"] = json.loads(flow.response.content)
        except Exception:
            body = flow.response.content
            if len(body) > 1000:
                entry["res_body"] = f"<binary {len(body)} bytes>"
            else:
                entry["res_body"] = body.decode("utf-8", errors="replace")

    # Print summary
    method = entry.get("method", "?")
    url = entry.get("url", "?")
    status = entry.get("status", "?")
    # Truncate URL for display
    short_url = url.split("?")[0] if len(url) > 100 else url
    print(f"\n{'='*60}")
    print(f"[{method}] {short_url} -> {status}")
    if "req_body" in entry and isinstance(entry["req_body"], dict):
        print(f"  REQ: {json.dumps(entry['req_body'], indent=2)[:500]}")
    if "res_body" in entry and isinstance(entry["res_body"], dict):
        print(f"  RES: {json.dumps(entry['res_body'], indent=2)[:500]}")
    print(f"{'='*60}")

    # Append to log file
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
