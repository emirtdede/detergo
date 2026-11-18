/**
 * Path display helpers shared by every view.
 *
 * `maskPath` hides the account name so screenshots and support tickets do not
 * leak a real home directory. It covers the Windows and POSIX conventions and
 * is intentionally tolerant: a path without a home segment is returned as is.
 */

/** Home-directory prefixes whose next segment is the account name. */
const MASKED_HOME_SEGMENTS = [
  /([A-Za-z]:\\Users\\)([^\\/]+)/gi,
  /([A-Za-z]:\\Documents and Settings\\)([^\\/]+)/gi,
  /(\\Users\\)([^\\/]+)/gi,
  /(\/home\/)([^/]+)/g,
  /(\/Users\/)([^/]+)/g,
];

export function maskPath(path: string): string {
  return MASKED_HOME_SEGMENTS.reduce((masked, pattern) => masked.replace(pattern, "$1•••"), path);
}

/**
 * Truncate a long path in the middle, preserving the separator style of the
 * input. Windows paths keep backslashes; POSIX inputs keep forward slashes so
 * previews and tests on non-Windows hosts stay readable.
 *
 * A UNC path (`\\server\share\...`) is anchored on `\\server\share`, not on the
 * first two split segments: those are empty strings, so the old code produced
 * `\...\node_modules` and dropped the server the user needs to identify the
 * target.
 */
export function truncatePath(fullPath: string, maxLength = 48): string {
  if (!fullPath || fullPath.length <= maxLength) return fullPath;
  const separator = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(/[\\/]/);
  if (parts.length <= 2) return fullPath;

  let head: string;
  if (/^[\\/]{2}[^\\/]/.test(fullPath)) {
    const prefix = fullPath.startsWith("//") ? "//" : "\\\\";
    const segments = fullPath.slice(2).split(/[\\/]/);
    head = `${prefix}${segments[0] ?? ""}${separator}${segments[1] ?? ""}`;
  } else if (separator === "\\") {
    head = `${parts[0]}${separator}${parts[1]}`;
  } else {
    head = `${parts[0]}`;
  }
  const last = parts[parts.length - 1];
  const candidate = `${head}${separator}...${separator}${last}`;
  if (candidate.length <= maxLength) return candidate;
  return `${fullPath.slice(0, Math.max(0, maxLength - 3))}...`;
}
