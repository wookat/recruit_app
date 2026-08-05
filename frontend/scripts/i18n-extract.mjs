// Extract all t()/tt keys → JSON list on stdout.
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const keys = new Set()
function walkDir(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) walkDir(p)
    else if (/\.(tsx|ts)$/.test(f.name) && !/i18n/.test(f.name)) scan(p)
  }
}
function scan(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const a = node.arguments[0]
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) keys.add(a.text)
    }
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'tt') {
      const tpl = node.template
      if (ts.isTemplateExpression(tpl)) {
        let key = tpl.head.text
        tpl.templateSpans.forEach((s, i) => { key += `{${i}}` + s.literal.text })
        keys.add(key)
      } else if (ts.isNoSubstitutionTemplateLiteral(tpl)) keys.add(tpl.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
walkDir('src')
const HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/
console.log(JSON.stringify([...keys].filter((k) => HAN.test(k)).sort(), null, 1))
