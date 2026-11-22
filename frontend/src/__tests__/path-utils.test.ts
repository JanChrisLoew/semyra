import { describe, expect, it } from 'vitest';
import {
  baseNameOfPath,
  getFileExtension,
  isImagePath,
  isMarkdownPath,
  isSamePath,
  parentDirOfPath,
  resolveRelativeMarkdownPath,
  safeDecodeURIComponent,
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

  it('correctly classifies Markdown, image, and text extensions', () => {
    expect(isMarkdownPath('README.md')).toBe(true);
    expect(isMarkdownPath('C:\\Docs\\spec.markdown')).toBe(true);
    expect(isMarkdownPath('page.mdx')).toBe(true);
    expect(isMarkdownPath('config.yaml')).toBe(false);
    expect(isMarkdownPath('data.json')).toBe(false);

    expect(isImagePath('photo.png')).toBe(true);
    expect(isImagePath('diagram.svg')).toBe(true);
    expect(isImagePath('banner.webp')).toBe(true);
    expect(isImagePath('doc.md')).toBe(false);

    expect(getFileExtension('package.json')).toBe('json');
    expect(getFileExtension('config.YAML')).toBe('yaml');
    expect(getFileExtension('Cargo.toml')).toBe('toml');
    expect(getFileExtension('.env')).toBe('env');
    expect(getFileExtension('noextension')).toBe('');
  });

  it('compares Windows/POSIX paths safely and handles malformed percent-encoding', () => {
    expect(isSamePath('C:\\Notes\\Draft.md', 'c:/notes/draft.md')).toBe(true);
    expect(isSamePath('C:\\Notes\\Draft.md', 'C:\\Notes\\Other.md')).toBe(false);
    expect(safeDecodeURIComponent('%E0%A4%A')).toBe('%E0%A4%A');
    expect(
      resolveRelativeMarkdownPath('C:\\Workspace\\Docs', './bad%E0%A4%A.md#frag'),
    ).toBe('C:\\Workspace\\Docs\\bad%E0%A4%A.md');
  });
});
