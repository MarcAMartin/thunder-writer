import { decodeText } from './decode'

const bytes = (...b: number[]) => new Uint8Array(b).buffer

describe('decodeText', () => {
  it('reads UTF-8 and strips the BOM', () => {
    const buf = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Café “quoted”')]).buffer
    expect(decodeText(buf)).toEqual({ text: 'Café “quoted”', encoding: 'utf-8', guessed: false })
  })

  it('falls back to Windows-1252 for legacy files', () => {
    // "Café “hi”" in Windows-1252
    const r = decodeText(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x68, 0x69, 0x94))
    expect(r.text).toBe('Café “hi”')
    expect(r.encoding).toBe('windows-1252')
    expect(r.guessed).toBe(true)
  })

  it('honours UTF-16 byte-order marks', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00)).text).toBe('Hi')
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69)).text).toBe('Hi')
  })

  it('uses an HTML file’s declared charset when it isn’t UTF-8', () => {
    const head = new TextEncoder().encode('<meta charset="iso-8859-1"><p>')
    const r = decodeText(new Uint8Array([...head, 0xe9]).buffer, { html: true })
    expect(r.text.endsWith('é')).toBe(true)
    expect(r.guessed).toBe(false)
  })

  it('strips a BOM from string input', () => {
    expect(decodeText('﻿Hello').text).toBe('Hello')
  })
})
