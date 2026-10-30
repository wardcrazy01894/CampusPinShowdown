import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BASEMAP_KEY,
  DEFAULT_BASEMAP,
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
  it('defaults to the satellite map', () => {
    stubStorage()
    expect(getBasemap()).toBe('satellite')
    expect(DEFAULT_BASEMAP).toBe('satellite')
  })

  it('round-trips through localStorage under cps:basemap', () => {
    const store = stubStorage()
    setBasemap('satellite')
    expect(store.get(BASEMAP_KEY)).toBe('satellite')
    expect(getBasemap()).toBe('satellite')
    setBasemap('night')
    expect(getBasemap()).toBe('night')
  })

  it('honours a saved night preference', () => {
    stubStorage({ [BASEMAP_KEY]: 'night' })
    expect(getBasemap()).toBe('night')
  })

  it('ignores an unknown stored value', () => {
    stubStorage({ [BASEMAP_KEY]: 'hologram' })
    expect(getBasemap()).toBe('satellite')
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
    expect(getBasemap()).toBe('satellite')
    expect(() => setBasemap('night')).not.toThrow()
  })

  it('nextBasemap flips between the two', () => {
    expect(nextBasemap('night')).toBe('satellite')
    expect(nextBasemap('satellite')).toBe('night')
  })
})
