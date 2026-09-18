import { inflateRawSync } from 'node:zlib'

/**
 * Just enough of an .xlsx reader for Mercado Libre's sales export: the first
 * worksheet as a grid of strings. No styles, formulas or dates — ML writes plain
 * shared strings and numbers — so a zip walk plus two regexes beats pulling in a
 * spreadsheet library.
 */
export function readFirstSheet(buffer: Buffer): string[][] {
  const files = unzip(buffer)
  const sharedXml = files.get('xl/sharedStrings.xml')
  const shared = sharedXml ? parseSharedStrings(sharedXml.toString('utf8')) : []

  const sheetPath = [...files.keys()]
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => sheetIndex(a) - sheetIndex(b))[0]
  if (!sheetPath) throw new Error('The workbook has no worksheet')

  return parseSheet(files.get(sheetPath)!.toString('utf8'), shared)
}

const sheetIndex = (path: string) => Number(path.match(/sheet(\d+)\.xml$/)?.[1] ?? 0)

/** Reads every entry from the zip's central directory. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  // End of central directory: fixed 22 bytes plus an optional comment.
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file')

  const entries = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const files = new Map<string, Buffer>()

  for (let n = 0; n < entries; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt .xlsx directory')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    // The local header repeats name/extra with its own lengths.
    const dataStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, inflateRawSync(data))

    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Rich text splits one string over several <t> runs.
    let text = ''
    for (const t of si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += t[1]
    out.push(decodeXml(text))
  }
  return out
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = []
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1]
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const body = cell[2] ?? ''
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]

      let value = ''
      if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) value += decodeXml(t[1])
      } else if (raw !== undefined) value = decodeXml(raw)

      const index = ref ? columnIndex(ref) : cells.length
      while (cells.length < index) cells.push('')
      cells[index] = value
    }
    rows.push(cells)
  }
  return rows
}

/** "A" → 0, "BJ" → 61. */
function columnIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
