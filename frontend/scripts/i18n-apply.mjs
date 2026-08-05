// Second pass: wrap Han strings on audited lines, except a skip list of
// data/filter-value lines that must stay Chinese.
import ts from 'typescript'
import fs from 'node:fs'

const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/

const SKIP = new Set()
function addSkip(file, lines) {
  for (const l of lines) SKIP.add(`src/${file}:${l}`)
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
addSkip('App.tsx', [818])
addSkip('components/BianzhiPage.tsx', [80, 551, 552, 553, 1599])
addSkip('components/CampusPage.tsx', [75, ...range(154, 169), ...range(173, 202)])
addSkip('components/ListPage.tsx', [...range(139, 160), 506, 508, 591])
addSkip('components/MatchByProfileButton.tsx', [21, 22, 23, 24])
addSkip('components/FavoritesSheet.tsx', [170, 172, 368, 388, 433, 434, 435])
addSkip('components/WeeklyDigest.tsx', [14, 23])
addSkip('components/PositionSheet.tsx', [182, 315, 321])
addSkip('components/CalendarPage.tsx', [32])
addSkip('components/RecentUpdatesPage.tsx', [34])

function isComparison(node) {
  const p = node.parent
  return ts.isBinaryExpression(p) && [
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ].includes(p.operatorToken.kind)
}
const SKIP_CALLEES = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'replace', 'replaceAll', 'split', 'match', 'set', 'get', 'getItem', 'setItem', 'has', 'test', 'add'])
function skipContext(node) {
  const p = node.parent
  if (!p) return true
  if (ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
  if (ts.isCaseClause(p)) return true
  if (isComparison(node)) return true
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const callee = p.expression
    if (ts.isPropertyAccessExpression(callee) && SKIP_CALLEES.has(callee.name.text)) return true
  }
  return false
}
function insideT(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === 't') return true
    if (ts.isTaggedTemplateExpression(cur) && ts.isIdentifier(cur.tag) && cur.tag.text === 'tt') return true
    cur = cur.parent
  }
  return false
}

const byFile = new Map()
for (const l of fs.readFileSync('/tmp/audit.txt', 'utf8').split('\n')) {
  if (!l.trim()) continue
  const [file, line] = l.split(':')
  if (SKIP.has(`${file}:${line}`)) continue
  if (!byFile.has(file)) byFile.set(file, new Set())
  byFile.get(file).add(Number(line))
}

let total = 0
for (const [file, lines] of byFile) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  let usedT = false, usedTT = false
  function visit(node) {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && HAN.test(node.text)) {
      if (lines.has(line) && !skipContext(node) && !insideT(node)) {
        usedT = true
        edits.push({ start: node.getStart(), end: node.getEnd(), text: `t(${JSON.stringify(node.text)})` })
      }
      return
    }
    if (ts.isTemplateExpression(node) && HAN.test(node.getText())) {
      if (lines.has(line) && !skipContext(node) && !insideT(node)) {
        usedTT = true
        edits.push({ start: node.getStart(), end: node.getStart(), text: 'tt' })
      }
      return ts.forEachChild(node, visit)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!edits.length) continue
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  const names = []
  if (usedT) names.push('t')
  if (usedTT) names.push('tt')
  if (/from '@\/lib\/i18n'/.test(out)) {
    out = out.replace(/import \{ ([^}]+) \} from '@\/lib\/i18n'/, (s, g) => {
      const cur = new Set(g.split(',').map((x) => x.trim()))
      names.forEach((n) => cur.add(n))
      return `import { ${[...cur].join(', ')} } from '@/lib/i18n'`
    })
  } else {
    out = `import { ${names.join(', ')} } from '@/lib/i18n'\n` + out
  }
  fs.writeFileSync(file, out)
  total += edits.length
  console.log(`${file}: ${edits.length}`)
}
console.log('total:', total)
