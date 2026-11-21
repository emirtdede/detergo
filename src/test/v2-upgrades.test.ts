import { describe, expect, it } from "vitest";
import { isValidWebhookUrl, normalizeWebhookUrl } from "@/lib/validation/webhook-url";
import { usePreferencesStore } from "@/stores/preferences-store";

describe("webhook allowPrivate policy", () => {
  it("rejects loopback and LAN URLs by default", () => {
    for (const url of [
      "http://localhost:5678/webhook/detergo",
      "http://127.0.0.1:5678/webhook/detergo",
      "http://[::1]:5678/webhook/detergo",
      "http://192.168.1.40:5678/webhook/detergo",
      "http://10.0.0.15:5678/webhook/detergo",
      "http://n8n.local:5678/webhook/detergo",
    ]) {
      expect(isValidWebhookUrl(url)).toBe(false);
    }
  });

  it("accepts loopback and LAN URLs when allowPrivate is enabled while still blocking metadata/unspecified", () => {
    for (const allowed of [
      "http://localhost:5678/webhook/detergo",
      "http://127.0.0.1:5678/webhook/detergo",
      "http://[::1]:5678/webhook/detergo",
      "http://192.168.1.40:5678/webhook/detergo",
      "http://10.0.0.15:5678/webhook/detergo",
      "http://100.64.0.12:5678/webhook/detergo",
      "http://n8n.local:5678/webhook/detergo",
    ]) {
      const res = normalizeWebhookUrl(allowed, { allowPrivate: true });
      expect(res.ok, `${allowed} should be allowed with allowPrivate`).toBe(true);
    }

    for (const blocked of [
      "http://169.254.169.254/latest/meta-data/",
      "http://[fe80::1]/hook",
      "http://0.0.0.0/hook",
      "http://[::]/hook",
      "http://metadata.google.internal/computeMetadata/v1/",
      "file:///etc/passwd",
    ]) {
      const res = normalizeWebhookUrl(blocked, { allowPrivate: true });
      expect(res.ok, `${blocked} must remain blocked even with allowPrivate`).toBe(false);
    }
  });

  it("preserves a local n8n webhook URL during loadPreferences when allowPrivateWebhooks is true", () => {
    usePreferencesStore.getState().loadPreferences({
      allowPrivateWebhooks: true,
      webhookUrl: "http://localhost:5678/webhook/detergo",
    });
    const state = usePreferencesStore.getState();
    expect(state.allowPrivateWebhooks).toBe(true);
    expect(state.webhookUrl).toBe("http://localhost:5678/webhook/detergo");

    // Reset back to strict default.
    usePreferencesStore.getState().loadPreferences({
      allowPrivateWebhooks: false,
      webhookUrl: "http://localhost:5678/webhook/detergo",
    });
    expect(usePreferencesStore.getState().webhookUrl).toBeNull();
  });
});
