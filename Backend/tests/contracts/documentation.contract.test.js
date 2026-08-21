const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('markdown docs do not contain obsolete legacy sensor mappings', () => {
  const docFiles = [
    path.resolve(__dirname, '../../../docs/PRD.md'),
    path.resolve(__dirname, '../../../docs/TDD.md'),
    path.resolve(__dirname, '../../../docs/ARCHITECTURE.md'),
  ]

  const obsoletePatterns = [
    /S-03\s*[-:|]\s*Coil Joint/i,
    /S-02\s*[-:|]\s*Outside Filler(?!\s*Wire)/i,
    /S-04\s*[-:|]\s*Inside Filler(?!\s*Wire)/i,
  ]

  for (const filePath of docFiles) {
    assert.ok(fs.existsSync(filePath), `Doc file ${filePath} must exist`)
    const content = fs.readFileSync(filePath, 'utf8')
    for (const pattern of obsoletePatterns) {
      assert.ok(
        !pattern.test(content),
        `Doc file ${path.basename(filePath)} contains obsolete legacy mapping matching ${pattern}`,
      )
    }
  }
})
