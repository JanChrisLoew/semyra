import { describe, expect, it } from 'vitest';
import {
  baseNameOfPath,
  parentDirOfPath,
  resolveRelativeMarkdownPath,
} from '../path-utils';

describe('path-utils', () => {
  it('extracts basenames and parent directories for Windows and POSIX paths', () => {
    expect(baseNameOfPath('C:\\Notizen\\Projekt\\README.md')).toBe('README.md');
    expect(baseNameOfPath('C:\\Notizen\\Projekt\\')).toBe('Projekt');
    expect(parentDirOfPath('C:\\Notizen\\Projekt\\README.md')).toBe('C:\\Notizen\\Projekt');
    expect(parentDirOfPath('C:\\Notizen.md')).toBe('C:\\');
    expect(parentDirOfPath('Unbenannt-1.md')).toBeNull();
  });

  it('resolves relative Markdown links including ./, ../, URL encoding, and anchors', () => {
    expect(
      resolveRelativeMarkdownPath('C:\\Workspace\\Docs\\Kapitel', './Einstieg.md'),
    ).toBe('C:\\Workspace\\Docs\\Kapitel\\Einstieg.md');

    expect(
      resolveRelativeMarkdownPath(
        'C:\\Workspace\\Docs\\Kapitel',
        '../Architektur%20Guide.md#ueberblick',
      ),
    ).toBe('C:\\Workspace\\Docs\\Architektur Guide.md');
  });
});
