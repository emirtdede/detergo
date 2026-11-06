import subprocess
import json

def test_dev_cleaner_verification():
    # 1. Test CLI Help & Version
    res = subprocess.run(["dev-cleaner", "--version"], capture_output=True, text=True)
    assert res.returncode == 0, f"Version command failed: {res.stderr}"
    assert "Dev Cleaner" in res.stdout, f"Unexpected version output: {res.stdout}"

    # 2. Test CLI Caches JSON
    res = subprocess.run(["dev-cleaner", "caches", "--json"], capture_output=True, text=True)
    assert res.returncode == 0, f"Caches command failed: {res.stderr}"
    data = json.loads(res.stdout)
    assert isinstance(data, list), "Caches output is not a list"
    assert len(data) >= 15, f"Expected at least 15 providers, got {len(data)}"

    # 3. Test MCP Server Handshake
    p = subprocess.Popen(["dev-cleaner", "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    init_payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "testsprite-runner", "version": "1.0"}
        }
    }
    p.stdin.write(json.dumps(init_payload) + "\n")
    p.stdin.flush()
    line = p.stdout.readline()
    p.terminate()
    
    assert line, "MCP server did not respond to initialize"
    resp = json.loads(line)
    assert resp.get("result", {}).get("protocolVersion") == "2024-11-05", f"Wrong protocol: {resp}"
    assert resp.get("result", {}).get("serverInfo", {}).get("name") == "dev-cleaner-mcp", f"Wrong server name: {resp}"
    print("Dev Cleaner CLI, Caches, and MCP handshake all verified successfully!")

if __name__ == "__main__":
    test_dev_cleaner_verification()

