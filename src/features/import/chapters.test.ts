import { isBareChapterNumber, isChapterHeading, isSceneBreak } from './chapters'

describe('isChapterHeading', () => {
  it.each([
    'Chapter 1',
    'CHAPTER ONE',
    'Chapter Twelve: The Storm',
    'Chapter twenty-one',
    'Chapter Ninety Nine',
    'Chapter One Hundred and Two',
    'Ch. 3',
    'Chap. 4',
    'Chapter IV',
    'chapter xii',
    'Chapter 7 — Homecoming',
    'Chapter 7. The Long Night',
    'Chapter 3 The Storm',
    'Prologue',
    'PROLOGUE: Before',
    'Epilogue',
    'Interlude',
    'Interlude II',
    'Part One',
    'PART 2: THE CITY',
    'Part the First',
    'Book Three',
    '   Chapter 5   ',
  ])('promotes %j', (line) => {
    expect(isChapterHeading(line)).toBe(true)
  })

  it.each([
    'Chapter one began badly, he thought.',
    'Chapter 3 was where it all went wrong.',
    'chapter and verse',
    'Chapters 1 and 2',
    'The chapter ended.',
    'Chi',
    'Chapter',
    'Prologues are for cowards, she said.',
    'Part of me wanted to stay.',
    'Parting is such sweet sorrow',
    'Epilogue, as it happens, was her favourite word.',
    'Chapter 1. It was a dark and stormy night and the rain fell in torrents.',
    'Chapter 9: ' + 'a very long subtitle that goes on and on and on and on and never stops at all',
    'Chapter 2,',
    'Chapter 1\nIt was',
    'Book of Days',
  ])('does not promote %j', (line) => {
    expect(isChapterHeading(line)).toBe(false)
  })
})

describe('isBareChapterNumber', () => {
  it.each(['IV', 'I', 'XII.', '12', '3.'])('accepts %j', (l) => expect(isBareChapterNumber(l)).toBe(true))
  it.each(['iv', 'IIII', 'VX', '1234', 'I think', 'MIX-UP', ''])('rejects %j', (l) => expect(isBareChapterNumber(l)).toBe(false))
})

describe('isSceneBreak', () => {
  it.each(['***', '* * *', '#', '~~~', '§', '—', '- - -', '•••', '⁂', '  *  *  *  ', '###'])('accepts %j', (l) =>
    expect(isSceneBreak(l)).toBe(true),
  )
  it.each(['', 'The end.', '*emphasis*', '— he said', '#hashtag', 'A * B', '1.'])('rejects %j', (l) =>
    expect(isSceneBreak(l)).toBe(false),
  )
})
