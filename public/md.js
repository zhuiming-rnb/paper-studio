// 极简 Markdown 渲染器（只覆盖 AI 输出会用到的语法）
export function renderMarkdown(src) {
  if (!src) return ''
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const inline = (s) =>
    s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

  const lines = esc(src).split('\n')
  const out = []
  let list = null
  let table = null
  let para = []

  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + para.join(' ') + '</p>')
      para = []
    }
  }
  const flushList = () => {
    if (list) {
      out.push('</' + list + '>')
      list = null
    }
  }
  const flushTable = () => {
    if (table) {
      out.push(
        '<table>' +
          table
            .map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
            .join('') +
          '</table>',
      )
      table = null
    }
  }
  const flushAll = () => {
    flushList()
    flushTable()
    flushPara()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushAll()
      const lv = h[1].length
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>')
      continue
    }

    if (line.trim().startsWith('|')) {
      flushList()
      flushPara()
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue // 分隔行
      if (!table) table = []
      table.push(cells)
      continue
    }
    if (table) flushTable()

    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ul || ol) {
      flushPara()
      flushTable()
      const type = ul ? 'ul' : 'ol'
      if (list !== type) {
        flushList()
        out.push('<' + type + '>')
        list = type
      }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>')
      continue
    }
    if (list) flushList()

    if (line.trim() === '') {
      flushPara()
      continue
    }
    para.push(inline(line))
  }
  flushAll()
  return out.join('\n')
}
