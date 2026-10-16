const blockEndFollowers = new Set(['IF', 'WHILE', 'LOOP', 'REPEAT', 'CASE'])

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value)
}

function isWordAt(source: string, index: number, word: string): boolean {
  if (source.slice(index, index + word.length).toUpperCase() !== word) {
    return false
  }

  return !isIdentifierChar(source[index - 1]) && !isIdentifierChar(source[index + word.length])
}

function nextWord(source: string, index: number): string {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) {
    cursor += 1
  }

  let word = ''
  while (cursor < source.length && isIdentifierChar(source[cursor])) {
    word += source[cursor]
    cursor += 1
  }

  return word.toUpperCase()
}

export function splitSqlScript(script: string): string[] {
  const statements: string[] = []
  let current = ''
  let index = 0
  let inSingle = false
  let inDouble = false
  let inLine = false
  let inBlock = false
  let beginDepth = 0

  while (index < script.length) {
    const char = script[index] ?? ''
    const next = script[index + 1]

    if (inLine) {
      current += char
      if (char === '\n') {
        inLine = false
      }
      index += 1
      continue
    }

    if (inBlock) {
      current += char
      if (char === '*' && next === '/') {
        current += '/'
        index += 2
        inBlock = false
        continue
      }
      index += 1
      continue
    }

    if (inSingle) {
      current += char
      if (char === "'" && next === "'") {
        current += "'"
        index += 2
        continue
      }
      if (char === "'") {
        inSingle = false
      }
      index += 1
      continue
    }

    if (inDouble) {
      current += char
      if (char === '"' && next === '"') {
        current += '"'
        index += 2
        continue
      }
      if (char === '"') {
        inDouble = false
      }
      index += 1
      continue
    }

    if (char === '-' && next === '-') {
      current += '--'
      index += 2
      inLine = true
      continue
    }

    if (char === '#') {
      current += char
      index += 1
      inLine = true
      continue
    }

    if (char === '/' && next === '*') {
      current += '/*'
      index += 2
      inBlock = true
      continue
    }

    if (char === "'") {
      inSingle = true
      current += char
      index += 1
      continue
    }

    if (char === '"') {
      inDouble = true
      current += char
      index += 1
      continue
    }

    if (isWordAt(script, index, 'BEGIN')) {
      beginDepth += 1
      current += 'BEGIN'
      index += 5
      continue
    }

    if (isWordAt(script, index, 'END')) {
      const follower = nextWord(script, index + 3)
      if (!blockEndFollowers.has(follower)) {
        beginDepth = Math.max(0, beginDepth - 1)
      }
      current += 'END'
      index += 3
      continue
    }

    if (char === ';' && beginDepth === 0) {
      pushStatement(statements, current)
      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  pushStatement(statements, current)
  return statements
}

function pushStatement(statements: string[], value: string): void {
  const statement = value.trim()
  if (statement && hasExecutableSql(statement)) {
    statements.push(statement)
  }
}

function hasExecutableSql(statement: string): boolean {
  const withoutComments = statement
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/#.*$/gm, '')
    .trim()

  return withoutComments.length > 0
}
