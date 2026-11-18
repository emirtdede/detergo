import pkg from "../../package.json";

/**
 * The version the app reports to the user.
 *
 * `package.json` is the single source of truth: the Tauri bundle version and
 * the Cargo package version are kept in lockstep with it at release time, so
 * documentation, legal revision strings and webhook samples must not hardcode
 * their own copy. Reading it here is what stops the docs from advertising the
 * previous release after a bump.
 */
export const APP_VERSION: string = pkg.version;
