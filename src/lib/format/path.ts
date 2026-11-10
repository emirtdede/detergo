/**
 * Path display helpers shared by every view.
 *
 * `maskPath` hides the Windows user name so screenshots and support tickets do
 * not leak a real home directory. It is intentionally tolerant: a path without
 * a `Users` segment is returned unchanged.
 */
export function maskPath(path: string): string {
  return path.replace(/([A-Za-z]:\\Users\\)([^\\]+)/i, "$1•••");
}

/**
 * Truncate a long path in the middle, preserving the separator style of the
 * input. Windows paths keep backslashes; POSIX inputs keep forward slashes so
 * previews and tests on non-Windows hosts stay readable.
 */
export function truncatePath(fullPath: string, maxLength = 48): string {
  if (!fullPath || fullPath.length <= maxLength) return fullPath;
  const separator = fullPath.includes("\\") ? "\\" : "/";
  const parts = fullPath.split(/[\\/]/);
  if (parts.length <= 2) return fullPath;

  const head = separator === "\\" ? `${parts[0]}${separator}${parts[1]}` : `${parts[0]}`;
  const last = parts[parts.length - 1];
  const candidate = `${head}${separator}...${separator}${last}`;
  if (candidate.length <= maxLength) return candidate;
  return `${fullPath.slice(0, Math.max(0, maxLength - 3))}...`;
}
