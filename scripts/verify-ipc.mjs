// Packaged-build IPC/CSP verification.
//
// The 2.0.0 audit claimed "packaged IPC under production CSP verified" but the
// binaries it probed were built from a different commit than the audited HEAD.
// This script re-runs the probe against the artifact that actually ships, so the
// claim is tied to the same bytes as BUILD_INFO.json.
//
// It launches the portable build with WebView2 remote debugging enabled, then
// calls real Tauri commands from the running page over CDP. Only loopback is
// used; nothing is sent off the machine.
//
// Usage: node scripts/verify-ipc.mjs [path-to-exe]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const candidates = [
  process.argv[2],
  path.join(rootDir, "release_output", "Node-Cleaner-2.0.0-Portable.exe"),
  path.join(rootDir, "src-tauri", "target", "release", "node-cleaner.exe"),
].filter(Boolean);

const exe = candidates.find((p) => fs.existsSync(p));
if (!exe) {
  console.error("Packaged binary not found. Run `npm run build:release` first.");
  process.exit(1);
}

const PORT = 9321;
console.log(`Binary: ${exe}`);
console.log(`CDP port: ${PORT} (loopback only)`);

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  },
  stdio: "ignore",
  detached: false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // DevTools endpoint not up yet.
    }
    await sleep(500);
  }
  throw new Error("WebView2 DevTools endpoint never appeared");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`CDP socket error: ${e.message ?? e}`)), {
      once: true,
    });
  });

  function send(method, params) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  return { ws, ready, send };
}

async function evaluate(client, expression) {
  const res = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.text ?? "evaluation failed");
  }
  return res.result.value;
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const target = await findTarget();
  const client = cdp(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  await sleep(750);

  // Tauri delivers the production CSP as a response header for its asset
  // protocol, not as a <meta> tag, so checking the DOM proves nothing. Test the
  // policy itself: inline script and eval must be blocked, and an off-origin
  // fetch must fail.
  const cspProbe = await evaluate(
    client,
    `(async () => {
       const out = {};
       // Inline script injection (script-src 'self' must refuse it).
       out.inlineBlocked = await new Promise((resolve) => {
         window.__ncInlineRan = false;
         const el = document.createElement("script");
         el.textContent = "window.__ncInlineRan = true;";
         document.head.appendChild(el);
         setTimeout(() => resolve(window.__ncInlineRan !== true), 50);
       });
       // eval() requires 'unsafe-eval', which the policy does not grant.
       try { eval("1"); out.evalBlocked = false; } catch { out.evalBlocked = true; }
       // Off-origin request must be refused by connect-src 'self'.
       try {
         await fetch("https://example.com/nc-csp-probe", { mode: "no-cors" });
         out.remoteBlocked = false;
       } catch { out.remoteBlocked = true; }
       return out;
     })()`,
  );
  record(
    "CSP blocks inline script",
    cspProbe?.inlineBlocked === true,
    JSON.stringify(cspProbe?.inlineBlocked),
  );
  record("CSP blocks eval", cspProbe?.evalBlocked === true, JSON.stringify(cspProbe?.evalBlocked));
  record(
    "CSP blocks off-origin fetch",
    cspProbe?.remoteBlocked === true,
    JSON.stringify(cspProbe?.remoteBlocked),
  );

  const catalog = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("get_catalog")`);
  record("get_catalog", Boolean(catalog && catalog.valid), `${catalog?.rules?.length ?? 0} rules`);

  const settings = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("get_app_settings")`);
  record(
    "get_app_settings",
    Boolean(settings && settings.schemaVersion >= 3),
    `schema v${settings?.schemaVersion}`,
  );

  const known = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("get_known_locations")`);
  record(
    "get_known_locations",
    Array.isArray(known) && known.length > 0,
    `${known?.length ?? 0} locations`,
  );

  const providers = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("get_agent_providers")`,
  );
  record(
    "get_agent_providers",
    Array.isArray(providers) && providers.length > 0,
    `${providers?.length ?? 0} providers`,
  );

  // The provenance stamp must be present, clean and match the shipped commit.
  const expected = path.join(rootDir, "release_output", "BUILD_INFO.json");
  const buildInfo = await evaluate(client, `window.__TAURI_INTERNALS__.invoke("get_build_info")`);
  record(
    "get_build_info",
    Boolean(buildInfo && buildInfo.commit && buildInfo.commit !== "unknown"),
    buildInfo
      ? `${buildInfo.commitShort} profile=${buildInfo.profile} dirty=${buildInfo.dirty}`
      : "missing",
  );
  if (fs.existsSync(expected)) {
    const manifest = JSON.parse(fs.readFileSync(expected, "utf8"));
    record(
      "binary commit matches BUILD_INFO.json",
      buildInfo?.commit === manifest.commit,
      `${buildInfo?.commit?.slice(0, 12)} vs ${manifest.commit.slice(0, 12)}`,
    );
    record(
      "binary and manifest agree on tree cleanliness",
      buildInfo?.dirty === manifest.dirty,
      `binary dirty=${buildInfo?.dirty}, manifest dirty=${manifest.dirty}`,
    );
    if (manifest.dirty) {
      console.log(
        "  NOTE  build was produced from a dirty tree; this artifact is not publishable.",
      );
    } else {
      record(
        "build was from a clean tree",
        buildInfo?.dirty === false,
        `dirty=${buildInfo?.dirty}`,
      );
    }
    record("release profile", buildInfo?.profile === "release", buildInfo?.profile);
  }

  // Window controls must still be allowed by the ACL.
  const maxState = await evaluate(
    client,
    `window.__TAURI_INTERNALS__.invoke("plugin:window|is_maximized", { label: "main" })`,
  );
  record("plugin:window|is_maximized (ACL)", typeof maxState === "boolean", String(maxState));

  // A destructive command must reject a forged plan id rather than act.
  const forged = await evaluate(
    client,
    `window.__TAURI_INTERNALS__
       .invoke("execute_cleanup", { planId: "plan-does-not-exist", confirmationToken: "x", permanentAcknowledged: true })
       .then(() => "ALLOWED")
       .catch((e) => String(e?.message ?? e))`,
  );
  record(
    "execute_cleanup rejects an unknown plan",
    forged !== "ALLOWED",
    String(forged).slice(0, 80),
  );

  // Cancelling an idle run must be a no-op, not an error: the UI calls this
  // without knowing whether a run is still active.
  const cancelIdle = await evaluate(
    client,
    `window.__TAURI_INTERNALS__
       .invoke("cancel_cleanup")
       .then(() => "OK")
       .catch((e) => String(e?.message ?? e))`,
  );
  record(
    "cancel_cleanup is a safe no-op when idle",
    cancelIdle === "OK",
    String(cancelIdle).slice(0, 80),
  );

  const unsafeUrl = await evaluate(
    client,
    `window.__TAURI_INTERNALS__
       .invoke("open_url", { url: "javascript:alert(1)" })
       .then(() => "ALLOWED")
       .catch((e) => String(e?.message ?? e))`,
  );
  record(
    "open_url rejects a non-http scheme",
    unsafeUrl !== "ALLOWED",
    String(unsafeUrl).slice(0, 80),
  );

  client.ws.close();
} catch (err) {
  record("probe", false, err.message);
} finally {
  try {
    child.kill();
  } catch {}
}

const failed = checks.filter((c) => !c.ok);
console.log("");
if (failed.length > 0) {
  console.log(`RESULT: FAIL (${failed.length}/${checks.length} checks failed)`);
  process.exit(1);
}
console.log(`RESULT: PASS (${checks.length}/${checks.length} checks)`);
process.exit(0);
