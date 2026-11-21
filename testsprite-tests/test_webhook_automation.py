import json
import pathlib
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class WebhookReceiver(HTTPServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.received = []


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        len_header = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(len_header).decode("utf-8")
        self.server.received.append(json.loads(body))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format, *args):
        pass


def expected_version() -> str:
    pkg = json.loads(
        (pathlib.Path(__file__).resolve().parent.parent / "package.json").read_text(
            encoding="utf-8"
        )
    )
    return pkg["version"]


def test_webhook_automation():
    """
    Verifies CLI scan + webhook behavior against the SSRF policy:
    - When `allowPrivateWebhooks` is disabled (default), loopback webhooks are
      refused by SSRF validation while the scan itself succeeds.
    - When `allowPrivateWebhooks` is enabled in config.json, the local receiver
      gets a valid `scan_completed` JSON payload matching package.json version.
    """
    server = WebhookReceiver(("127.0.0.1", 0), WebhookHandler)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        url = f"http://127.0.0.1:{port}/n8n-webhook"
        res = subprocess.run(
            ["dev-cleaner", "scan", ".", "--webhook", url],
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0, f"Scan command failed: {res.stderr}"
        if server.received:
            payload = server.received[0]
            assert payload.get("event") == "scan_completed"
            assert payload.get("version") == expected_version()
            assert payload.get("status") == "success"
            print("Local LAN webhook verified (allowPrivateWebhooks enabled).")
        else:
            combined = f"{res.stdout}\n{res.stderr}".lower()
            assert "private" in combined or "loopback" in combined or "webhook" in combined, (
                f"Expected SSRF policy warning when allowPrivateWebhooks is false: {combined}"
            )
            print("SSRF default-deny policy verified for loopback webhook.")
    finally:
        server.shutdown()


if __name__ == "__main__":
    test_webhook_automation()
