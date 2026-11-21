import json
import pathlib
import shutil
import subprocess


def resolve_detergo_bin() -> str:
    root = pathlib.Path(__file__).resolve().parent.parent
    candidates = [
        root / "src-tauri" / "target" / "release" / "detergo.com",
        root / "src-tauri" / "target" / "release" / "detergo.exe",
        root / "src-tauri" / "target" / "release" / "detergo-cli.exe",
        root / "src-tauri" / "target" / "debug" / "detergo-cli.exe",
        root / "src-tauri" / "target" / "debug" / "detergo_cli.exe",
        root / "src-tauri" / "target" / "debug" / "detergo.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    found = shutil.which("detergo")
    return found if found else "detergo"


def test_detergo_verification():
    binary = resolve_detergo_bin()

    # 1. Test CLI Version
    res = subprocess.run([binary, "--version"], capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0, f"Version command failed: {res.stderr}"
    assert "Detergo" in res.stdout, f"Unexpected version output: {res.stdout}"

    # 2. Test CLI Caches JSON (27 providers: 26 cleanable + WSL read-only)
    res = subprocess.run(
        [binary, "caches", "--json"], capture_output=True, text=True, encoding="utf-8"
    )
    assert res.returncode == 0, f"Caches command failed: {res.stderr}"
    data = json.loads(res.stdout)
    assert isinstance(data, list), "Caches output is not a list"
    assert len(data) >= 26, f"Expected at least 26 cache providers, got {len(data)}"

    # 3. Test MCP Server Handshake (2025-11-25 negotiation)
    p = subprocess.Popen(
        [binary, "mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    init_payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "testsprite-runner", "version": "1.0"},
        },
    }
    assert p.stdin is not None and p.stdout is not None
    p.stdin.write(json.dumps(init_payload) + "\n")
    p.stdin.flush()
    line = p.stdout.readline()
    p.terminate()

    assert line, "MCP server did not respond to initialize"
    resp = json.loads(line)
    assert resp.get("result", {}).get("protocolVersion") == "2025-11-25", f"Wrong protocol: {resp}"
    assert resp.get("result", {}).get("serverInfo", {}).get("name") == "detergo-mcp", (
        f"Wrong server name: {resp}"
    )
    print("Detergo CLI, Caches, and MCP handshake all verified successfully!")


if __name__ == "__main__":
    test_detergo_verification()
