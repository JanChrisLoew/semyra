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

  it('handles UNC paths, mixed forward/backward slashes, and roots cleanly', () => {
    expect(baseNameOfPath('\\\\Server\\Share\\Doc.md')).toBe('Doc.md');
    expect(parentDirOfPath('\\\\Server\\Share\\Doc.md')).toBe('\\\\Server\\Share');
    expect(baseNameOfPath('C:/Projekte/Test.md')).toBe('Test.md');
    expect(parentDirOfPath('C:/Projekte/Test.md')).toBe('C:/Projekte');
  });
});
