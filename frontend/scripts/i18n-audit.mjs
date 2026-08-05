// List Chinese strings not yet wrapped in t()/tt (ignores comments).
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/

function insideT(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === 't') return true
    if (ts.isTaggedTemplateExpression(cur) && ts.isIdentifier(cur.tag) && cur.tag.text === 'tt') return true
    cur = cur.parent
  }
  return false
}

function audit(file) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateExpression(node)) && HAN.test(node.getText()) && !insideT(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
      out.push(`${file}:${line + 1}: ${node.getText().replace(/\s*\n\s*/g, ' ').slice(0, 90)}`)
      if (ts.isTemplateExpression(node)) return ts.forEachChild(node, visit)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

for (const r of process.argv.slice(2)) {
  const st = fs.statSync(r)
  const files = st.isDirectory()
    ? fs.readdirSync(r).filter((f) => /\.(tsx|ts)$/.test(f)).map((f) => path.join(r, f))
    : [r]
  for (const f of files) audit(f).forEach((l) => console.log(l))
}
