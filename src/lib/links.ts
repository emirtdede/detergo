/**
 * Public URLs the app links to. One module so a rename of the repository or the
 * sponsorship profile cannot leave a stale link behind in one surface.
 *
 * These are opened through the Rust `open_url` command, which validates the
 * scheme before handing the URL to the operating system. The app never fetches
 * them itself except for the user-initiated update check.
 */
export const REPOSITORY_URL = "https://github.com/emirtdede/dev-cleaner";
export const SPONSOR_URL = "https://github.com/sponsors/emirtdede";
export const RELEASES_URL = `${REPOSITORY_URL}/releases/latest`;
export const NEW_ISSUE_URL = `${REPOSITORY_URL}/issues/new`;

/** Issue-template id used by the pre-filled "Report an issue" link. */
export const BUG_REPORT_TEMPLATE = "bug_report.yml";
