/**
 * Idiomatic German UI phrases for CodeMirror 6 panels, search/replace bar,
 * goto-line dialog, and code-folding controls.
 */
export const germanCodeMirrorPhrases: Record<string, string> = {
  // @codemirror/search
  'Go to line': 'Gehe zu Zeile',
  go: 'Los',
  Find: 'Suchen',
  Replace: 'Ersetzen',
  next: 'Weiter',
  previous: 'Zurück',
  all: 'Alle',
  'match case': 'Groß-/Kleinschreibung',
  'by word': 'Ganzes Wort',
  regexp: 'Regulärer Ausdruck',
  replace: 'Ersetzen',
  'replace all': 'Alle ersetzen',
  close: 'Schließen',
  'current match': 'Aktueller Treffer',
  'replaced $ matches': '$ Treffer ersetzt',
  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
  'on line': 'in Zeile',

  // @codemirror/language (foldGutter)
  'folded code': 'Abschnitt eingeklappt',
  unfold: 'Abschnitt ausklappen',
  'Fold line': 'Abschnitt einklappen',
  'Unfold line': 'Abschnitt ausklappen',
};
