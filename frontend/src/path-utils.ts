/**
 * Windows & POSIX path string helpers for client-side display and relative
 * Markdown link resolution without Node `path` runtime dependencies.
 */

export function normalizePathKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function isSamePath(a: string, b: string): boolean {
  return normalizePathKey(a) === normalizePathKey(b);
}

export function isSameOrDescendantPath(path: string, root: string): boolean {
  const normalizedRoot = normalizePathKey(root);
  const normalizedPath = normalizePathKey(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parentDirOfPath(filePath: string): string | null {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  if (idx <= 0) return null;
  // Preserve Windows drive root `C:\` when a file sits directly in `C:\note.md`
  if (idx === 2 && /^[A-Za-z]:[\\/]/.test(filePath)) {
    return `${filePath.slice(0, 2)}\\`;
  }
  return filePath.slice(0, idx);
}

export function baseNameOfPath(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function resolveRelativeMarkdownPath(parentDir: string, relativeHref: string): string {
  const cleanHref = safeDecodeURIComponent(relativeHref.split('#')[0].split('?')[0]);
  const baseParts = parentDir.replace(/\//g, '\\').replace(/\\+$/, '').split('\\');
  const relParts = cleanHref.replace(/\//g, '\\').split('\\');

  for (const seg of relParts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (baseParts.length > 1) {
        baseParts.pop();
      }
    } else {
      baseParts.push(seg);
    }
  }

  if (baseParts.length === 1 && /^[A-Za-z]:$/.test(baseParts[0])) {
    return `${baseParts[0]}\\`;
  }
  return baseParts.join('\\');
}

export function isMarkdownPath(filePath: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mdx)$/i.test(filePath);
}

export function isImagePath(filePath: string): boolean {
  return /\.(?:png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(filePath);
}

export function getFileExtension(filePath: string): string {
  const base = baseNameOfPath(filePath);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}
