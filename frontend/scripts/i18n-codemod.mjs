// One-shot codemod: wrap Chinese UI strings in t()/tt` ` from '@/lib/i18n'.
// Conservative: only clear display contexts; the rest is reviewed manually.
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/

const TEXT_ATTRS = new Set([
  'title', 'aria-label', 'placeholder', 'alt', 'label', 'description',
  'emptyText', 'hint', 'header', 'footer', 'subtitle', 'aria-description',
  'confirmText', 'cancelText', 'tooltip', 'summary', 'prefix', 'suffix',
])
const TEXT_PROPS = new Set([
  'label', 'title', 'name', 'desc', 'description', 'text', 'hint', 'tip',
  'placeholder', 'empty', 'header', 'subtitle', 'summary', 'message', 'short',
  'full', 'tooltip', 'heading', 'body', 'caption', 'note', 'detail', 'action',
])
const SKIP_CALLEES = new Set([
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'replace',
  'replaceAll', 'split', 'localeCompare', 'match', 'set', 'append', 'get',
  'getItem', 'setItem', 'removeItem', 'delete', 'has', 'test', 'add',
])

function hasHan(s) { return HAN.test(s) }

function isComparison(node) {
  const p = node.parent
  return ts.isBinaryExpression(p) && [
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ].includes(p.operatorToken.kind)
}

function skipContext(node) {
  const p = node.parent
  if (!p) return true
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true
  if (ts.isPropertyAssignment(p) && p.name === node) return true
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
  if (ts.isComputedPropertyName(p)) return true
  if (ts.isCaseClause(p)) return true
  if (isComparison(node)) return true
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const callee = p.expression
    if (ts.isPropertyAccessExpression(callee) && SKIP_CALLEES.has(callee.name.text)) return true
    if (ts.isIdentifier(callee) && callee.text === 'RegExp') return true
  }
  if (ts.isNewExpression(p) && p.arguments?.includes(node)) {
    if (ts.isIdentifier(p.expression) && p.expression.text === 'RegExp') return true
  }
  return false
}

function wantedContext(node) {
  const p = node.parent
  // JSX attribute in allowlist
  if (ts.isJsxAttribute(p)) return TEXT_ATTRS.has(p.name.getText())
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return TEXT_ATTRS.has(p.parent.name.getText())
  // object property in allowlist
  if (ts.isPropertyAssignment(p) && p.initializer === node) {
    const n = p.name
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return TEXT_PROPS.has(n.text)
    return false
  }
  // any expression position ultimately inside a JSX expression container (not attribute)
  let cur = p
  while (cur) {
    if (ts.isJsxExpression(cur)) {
      return !ts.isJsxAttribute(cur.parent) || TEXT_ATTRS.has(cur.parent.name.getText())
    }
    if (ts.isJsxAttribute(cur) || ts.isFunctionLike(cur) || ts.isBlock(cur)) return false
    cur = cur.parent
  }
  return false
}

function processFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = [] // {start, end, text}
  let usedT = false
  let usedTT = false

  function visit(node) {
    if (ts.isJsxText(node)) {
      if (hasHan(node.text)) {
        const raw = node.text
        const lead = /^[ \t]*\S/.test(raw) && /^ /.test(raw) ? ' ' : ''
        const trail = / $/.test(raw) ? ' ' : ''
        const norm = raw.replace(/\s*\n\s*/g, ' ').trim()
        if (norm) {
          usedT = true
          const rep = `${lead ? "{' '}" : ''}{t(${JSON.stringify(norm)})}${trail ? "{' '}" : ''}`
          edits.push({ start: node.getStart(), end: node.getEnd(), text: rep })
        }
      }
      return
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && hasHan(node.text)) {
      if (!skipContext(node) && wantedContext(node)) {
        usedT = true
        let rep = `t(${JSON.stringify(node.text)})`
        if (ts.isJsxAttribute(node.parent)) rep = `{${rep}}`
        edits.push({ start: node.getStart(), end: node.getEnd(), text: rep })
      }
      return
    }
    if (ts.isTemplateExpression(node) && hasHan(node.getText())) {
      if (!skipContext(node) && wantedContext(node)) {
        usedTT = true
        edits.push({ start: node.getStart(), end: node.getStart(), text: 'tt' })
      }
      return ts.forEachChild(node, visit)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (!edits.length) return 0
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)

  const names = []
  if (usedT) names.push('t')
  if (usedTT) names.push('tt')
  if (names.length && !/from '@\/lib\/i18n'/.test(out)) {
    const m = out.match(/^(import[^\n]*\n)+/)
    const at = m ? m[0].length : 0
    out = out.slice(0, at) + `import { ${names.join(', ')} } from '@/lib/i18n'\n` + out.slice(at)
  } else if (names.length) {
    out = out.replace(/import \{ ([^}]+) \} from '@\/lib\/i18n'/, (s, g) => {
      const cur = new Set(g.split(',').map((x) => x.trim()))
      names.forEach((n) => cur.add(n))
      return `import { ${[...cur].join(', ')} } from '@/lib/i18n'`
    })
  }
  fs.writeFileSync(file, out)
  return edits.length
}

const roots = process.argv.slice(2)
let total = 0
for (const r of roots) {
  const st = fs.statSync(r)
  const files = st.isDirectory()
    ? fs.readdirSync(r).filter((f) => /\.(tsx|ts)$/.test(f)).map((f) => path.join(r, f))
    : [r]
  for (const f of files) {
    const n = processFile(f)
    if (n) console.log(`${f}: ${n}`)
    total += n
  }
}
console.log('total edits:', total)
