// 生成一个最小有效 PDF（含两行文本），用于端到端测试
import fs from 'node:fs'

const lines = ['Hello Paper Studio', 'This is a test PDF for the reading guide.']
const content = 'BT\n/F1 24 Tf\n72 720 Td\n' + lines.map((l) => '(' + l + ') Tj\n0 -30 Td\n').join('') + 'ET\n'

const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  '<< /Length ' + Buffer.byteLength(content, 'utf8') + ' >>\nstream\n' + content + 'endstream',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let pdf = '%PDF-1.4\n'
const offsets = []
for (let i = 0; i < objs.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'utf8'))
  pdf += i + 1 + ' 0 obj\n' + objs[i] + '\nendobj\n'
}
const xrefPos = Buffer.byteLength(pdf, 'utf8')
pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
for (const o of offsets) pdf += String(o).padStart(10, '0') + ' 00000 n \n'
pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF'

fs.writeFileSync(new URL('./test-paper.pdf', import.meta.url), pdf, 'utf8')
console.log('test-paper.pdf written,', Buffer.byteLength(pdf, 'utf8'), 'bytes')
