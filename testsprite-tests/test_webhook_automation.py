import subprocess
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

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

def test_webhook_automation():
    server = WebhookReceiver(("127.0.0.1", 0), WebhookHandler)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        url = f"http://127.0.0.1:{port}/n8n-webhook"
        res = subprocess.run(["dev-cleaner", "scan", ".", "--webhook", url], capture_output=True, text=True)
        assert res.returncode == 0, f"Scan command failed: {res.stderr}"
        assert len(server.received) >= 1, f"Expected webhook payload, got none. Out: {res.stdout}"
        payload = server.received[0]
        assert payload.get("event") == "scan_completed"
        assert payload.get("version") in ("2.0.0", "2.2.0")
        assert payload.get("status") == "success"
        print("Universal Webhook & Automation Architecture verified successfully!")
    finally:
        server.shutdown()

if __name__ == "__main__":
    test_webhook_automation()

