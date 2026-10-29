#!/usr/bin/env node
/**
 * Render public/og-image.png (1200×630) from scripts/og-image/index.html with
 * headless Chrome. Run: `npm run og-image`. Override the browser binary with
 * CHROME=/path/to/chrome (any Chromium ≥ 112 with --headless=new works).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const chrome = CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error('No Chrome/Chromium found; set CHROME=/path/to/binary')
  process.exit(1)
}

const src = resolve('scripts/og-image/index.html')
const out = resolve('public/og-image.png')
const profile = mkdtempSync(join(tmpdir(), 'cps-og-'))
try {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      `--user-data-dir=${profile}`,
      `--screenshot=${out}`,
      `file://${src}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
} finally {
  rmSync(profile, { recursive: true, force: true })
}
console.log(`wrote ${out}`)
