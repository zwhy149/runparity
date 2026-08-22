function looksLikeWindowsPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(value);
}

function windowsDisplayIdentity(value: string): string {
  return value.replaceAll("/", "\\").toLowerCase();
}

export function pathsDifferForDisplay(left: string, right: string): boolean {
  if (looksLikeWindowsPath(left) && looksLikeWindowsPath(right)) {
    return windowsDisplayIdentity(left) !== windowsDisplayIdentity(right);
  }
  return left !== right;
}
