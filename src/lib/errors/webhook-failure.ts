import type { UIText } from "@/lib/ui-text";

/**
 * Webhook failures cross three surfaces where the raw backend message must not
 * appear: the settings toast, the OS notification center and the log file.
 *
 * `reqwest` errors embed the full URL - and a Discord/Slack/Teams webhook path
 * *is* the bearer token - plus DNS/TLS details. Only a classified reason is
 * allowed to leave the boundary:
 *
 *  - `network`     - the request never reached a server (status 0/unknown)
 *  - `http_<code>` - the server answered with a non-success status
 *
 * `describeWebhookFailure` turns a reason into localized, token-free text. Any
 * unrecognised value falls back to the generic network message, so a legacy or
 * hand-crafted payload cannot leak through this path.
 */
export type WebhookFailureReason = "network" | `http_${number}`;

export function classifyWebhookFailure(status?: number | null): WebhookFailureReason {
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) return "network";
  return `http_${Math.trunc(status)}`;
}

export function describeWebhookFailure(reason: string | undefined, ui: UIText): string {
  if (!reason) return ui.errors.network;
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) return `HTTP ${http[1]}`;
  if (reason === "network") return ui.errors.network;
  // Free-form text is never echoed: it may contain the credential-bearing URL.
  return ui.errors.network;
}
