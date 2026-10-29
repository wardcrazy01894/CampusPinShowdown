import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // .claude/worktrees holds full repo copies checked out by isolated review
  // agents (gitignored, so CI never sees them) — linting them would lint every
  // source file once per live worktree. `data` holds pipeline caches, not code.
  {
    ignores: ['dist', 'data', 'node_modules', '.claude/worktrees'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Inherited from KnowYourCity: eslint-plugin-react-hooks v7 flags two
      // deliberate, commented patterns — the "latest ref" idiom (MapGuess keeps
      // the Leaflet click handler from re-binding every render) and the
      // reset-on-input-change `setState` in an effect. Kept at `warn` (not off)
      // so the signal stays visible; fixing them is behaviour work and must be
      // test-first per CLAUDE.md.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Allow intentionally-unused stub params/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Plain JS/ESM — this config file plus the Node data script(s) in scripts/.
  {
    extends: [js.configs.recommended],
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // The Worker runs on the Cloudflare/service-worker runtime, so it sees the
  // fetch-platform globals (fetch, Response, URL, TextEncoder, …). serviceworker
  // — not browser — on purpose: a Worker has no window/document, so an
  // accidental DOM reference is still flagged.
  {
    files: ['worker/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
)
