import { execSync } from 'child_process'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `base` is the repo name because the site is served as a GitHub Pages PROJECT
// Served at the apex of the custom domain (https://campuspinshowdown.com/),
// so the base is '/'. (It was '/CampusPinShowdown/' while the site was a
// GitHub Pages project page; public/CNAME carries the domain.)

function getBuildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

const BUILD_HASH = getBuildHash()

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    {
      // Emit version.json so the client can detect a new deploy on tab focus.
      name: 'version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ hash: BUILD_HASH }),
        })
      },
    },
  ],
  define: {
    // Replaced at build time; lets the client compare against version.json.
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(BUILD_HASH),
  },
  test: {
    // Don't collect tests from isolated subagent/reviewer worktrees — their full
    // repo copies would otherwise double the local test count. CI is unaffected
    // (clean checkout, no worktrees).
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
})
