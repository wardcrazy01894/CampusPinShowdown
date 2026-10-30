import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BASEMAP_KEY,
  getBasemap,
  setBasemap,
  nextBasemap,
  isBasemap,
} from './basemap'

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  return store
}

afterEach(() => vi.unstubAllGlobals())

describe('basemap preference', () => {
  it('defaults to the night map', () => {
    stubStorage()
    expect(getBasemap()).toBe('night')
  })

  it('round-trips through localStorage under cps:basemap', () => {
    const store = stubStorage()
    setBasemap('satellite')
    expect(store.get(BASEMAP_KEY)).toBe('satellite')
    expect(getBasemap()).toBe('satellite')
    setBasemap('night')
    expect(getBasemap()).toBe('night')
  })

  it('ignores an unknown stored value', () => {
    stubStorage({ [BASEMAP_KEY]: 'hologram' })
    expect(getBasemap()).toBe('night')
    expect(isBasemap('hologram')).toBe(false)
    expect(isBasemap('satellite')).toBe(true)
  })

  it('survives a storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(getBasemap()).toBe('night')
    expect(() => setBasemap('satellite')).not.toThrow()
  })

  it('nextBasemap flips between the two', () => {
    expect(nextBasemap('night')).toBe('satellite')
    expect(nextBasemap('satellite')).toBe('night')
  })
})
