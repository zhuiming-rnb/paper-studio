import express from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const PDF_DIR = path.join(DATA_DIR, 'pdfs')
const TEXT_DIR = path.join(DATA_DIR, 'texts')
const NOTE_DIR = path.join(DATA_DIR, 'notes')
const EXPLAIN_DIR = path.join(DATA_DIR, 'explains')
const ASK_DIR = path.join(DATA_DIR, 'asks')
const LIBRARY = path.join(DATA_DIR, 'library.json')
const CONFIG = path.join(DATA_DIR, 'config.json')
const PORT = Number(process.env.PORT) || 3000

for (const d of [DATA_DIR, PDF_DIR, TEXT_DIR, NOTE_DIR, EXPLAIN_DIR, ASK_DIR]) {
  await fs.mkdir(d, { recursive: true })
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

// ---------- PDF 文本提取 ----------
async function extractText(pdfPath) {
  const data = new Uint8Array(await fs.readFile(pdfPath))
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: true })
  const doc = await task.promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    for (const item of content.items) {
      if (item.str !== undefined) line += item.str
      if (item.hasEOL) {
        if (line.trim()) parts.push(line.trim())
        line = ''
      }
    }
    if (line.trim()) parts.push(line.trim())
    parts.push('\n【第 ' + i + ' 页】\n')
  }
  await task.destroy()
  return { text: parts.join('\n'), pageCount: doc.numPages }
}

// ---------- DeepSeek ----------
async function getKey() {
  const cfg = await readJson(CONFIG, {})
  return (cfg.deepseekKey || '').trim()
}

async function deepseekChat(messages, { temperature = 0.3, maxTokens = 4000 } = {}) {
  const key = await getKey()
  if (!key) throw new Error('尚未配置 DeepSeek API Key：请到论文库页右上角「设置」里填写（https://platform.deepseek.com 注册获取）')
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens: maxTokens, stream: false }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = ((await res.json()).error || {}).message || '' } catch { /* ignore */ }
    throw new Error('DeepSeek API 错误 ' + res.status + (detail ? '：' + detail : ''))
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''
  if (!content) throw new Error('DeepSeek 返回了空内容，请重试')
  return content
}

async function loadPaperText(id) {
  try {
    return await fs.readFile(path.join(TEXT_DIR, id + '.txt'), 'utf8')
  } catch {
    return ''
  }
}

function clip(text, n = 60000) {
  return text.length > n ? text.slice(0, n) + '\n……（内容过长，已截断）' : text
}

// ---------- 应用 ----------
const app = express()
app.use(express.json({ limit: '2mb' }))

app.use(express.static(path.join(__dirname, 'public')))
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist')))

// ---- 论文库 ----
app.get('/api/papers', async (req, res) => {
  const lib = await readJson(LIBRARY, [])
  const out = []
  for (const p of lib) {
    const notes = await readJson(path.join(NOTE_DIR, p.id + '.json'), null)
    out.push({ ...p, hasNotes: !!notes })
  }
  res.json(out)
})

async function readExplain(id) {
  try {
    return JSON.parse(await fs.readFile(path.join(EXPLAIN_DIR, id + '.json'), 'utf8'))
  } catch {
    return null
  }
}

async function readAsks(id) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(ASK_DIR, id + '.json'), 'utf8'))
    return Array.isArray(data.messages) ? data.messages : []
  } catch {
    return []
  }
}

app.get('/api/papers/:id', async (req, res) => {
  const lib = await readJson(LIBRARY, [])
  const p = lib.find((x) => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: '论文不存在' })
  const notes = await readJson(path.join(NOTE_DIR, p.id + '.json'), null)
  const explain = await readExplain(req.params.id)
  const asks = await readAsks(req.params.id)
  res.json({ ...p, notes, explain, asks })
})

app.get('/api/papers/:id/pdf', async (req, res) => {
  const p = path.join(PDF_DIR, req.params.id + '.pdf')
  try {
    await fs.access(p)
  } catch {
    return res.status(404).json({ error: 'PDF 不存在' })
  }
  res.type('application/pdf')
  res.sendFile(p)
})

app.put('/api/papers/:id/meta', async (req, res) => {
  const lib = await readJson(LIBRARY, [])
  const p = lib.find((x) => x.id === req.params.id)
  if (!p) return res.status(404).json({ error: '论文不存在' })
  if (typeof req.body.title === 'string' && req.body.title.trim()) {
    p.title = req.body.title.trim().slice(0, 200)
  }
  await writeJson(LIBRARY, lib)
  res.json({ ok: true, paper: p })
})

app.delete('/api/papers/:id', async (req, res) => {
  const lib = await readJson(LIBRARY, [])
  const idx = lib.findIndex((x) => x.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: '论文不存在' })
  const [p] = lib.splice(idx, 1)
  await writeJson(LIBRARY, lib)
  for (const f of [path.join(PDF_DIR, p.id + '.pdf'), path.join(TEXT_DIR, p.id + '.txt'), path.join(NOTE_DIR, p.id + '.json'), path.join(EXPLAIN_DIR, p.id + '.json'), path.join(ASK_DIR, p.id + '.json')]) {
    await fs.rm(f, { force: true })
  }
  res.json({ ok: true })
})

// ---- 上传 ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '没有收到文件' })
    const ext = path.extname(req.file.originalname || '').toLowerCase()
    if (ext !== '.pdf') return res.status(400).json({ error: '只支持 PDF 文件' })
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex')
    const pdfPath = path.join(PDF_DIR, id + '.pdf')
    await fs.writeFile(pdfPath, req.file.buffer)
    const { text, pageCount } = await extractText(pdfPath)
    await fs.writeFile(path.join(TEXT_DIR, id + '.txt'), text, 'utf8')
    const base = path.basename(req.file.originalname, '.pdf').trim() || '未命名论文'
    const paper = {
      id,
      filename: req.file.originalname,
      title: base.slice(0, 200),
      uploadedAt: new Date().toISOString(),
      pageCount,
      charCount: text.length,
      likelyScanned: text.trim().length < 300,
    }
    const lib = await readJson(LIBRARY, [])
    lib.unshift(paper)
    await writeJson(LIBRARY, lib)
    res.json({ ok: true, paper })
  } catch (e) {
    console.error('upload error', e)
    res.status(500).json({ error: '处理失败：' + String((e && e.message) || e) })
  }
})

// ---- 笔记 ----
const SIX_KEYS = ['problem', 'method', 'results', 'contribution', 'limitations', 'thoughts']

function sanitizeSix(six) {
  const out = {}
  for (const k of SIX_KEYS) {
    out[k] = typeof six[k] === 'string' ? six[k].slice(0, 10000) : ''
  }
  return out
}

function sanitizeSteps(steps) {
  const raw = steps && typeof steps === 'object' ? steps : {}
  const fields = {
    s1: ['problem', 'verdict', 'note'],
    s2: ['coreIdea', 'confusions'],
    s3: ['importance', 'idea', 'evidence', 'limitation', 'next'],
    s4: [],
  }
  const out = {}
  for (const key of ['s1', 's2', 's3', 's4']) {
    const s = raw[key] && typeof raw[key] === 'object' ? raw[key] : {}
    const o = { done: !!s.done }
    for (const f of fields[key]) {
      o[f] = typeof s[f] === 'string' ? s[f].slice(0, 4000) : ''
    }
    out[key] = o
  }
  return out
}

app.put('/api/papers/:id/notes', async (req, res) => {
  const lib = await readJson(LIBRARY, [])
  if (!lib.find((x) => x.id === req.params.id)) return res.status(404).json({ error: '论文不存在' })
  const glossary = Array.isArray(req.body.glossary)
    ? req.body.glossary.slice(0, 500).map((g) => ({
        term: String((g && g.term) || '').slice(0, 100),
        explanation: String((g && g.explanation) || '').slice(0, 500),
      }))
    : []
  const steps = sanitizeSteps(req.body.steps)
  const notes = {
    id: req.params.id,
    six: sanitizeSix(req.body.six || {}),
    steps,
    progress: {
      pass1: steps.s1.done,
      pass2: steps.s2.done,
      pass3: steps.s3.done && steps.s4.done,
    },
    glossary,
    updatedAt: new Date().toISOString(),
  }
  await writeJson(path.join(NOTE_DIR, req.params.id + '.json'), notes)
  res.json({ ok: true, notes })
})

// ---- 配置（API Key）----
app.get('/api/config', async (req, res) => {
  const cfg = await readJson(CONFIG, {})
  res.json({ hasKey: !!(cfg.deepseekKey || '').trim() })
})

app.put('/api/config', async (req, res) => {
  const cfg = await readJson(CONFIG, {})
  if (typeof req.body.deepseekKey === 'string') cfg.deepseekKey = req.body.deepseekKey.trim()
  await writeJson(CONFIG, cfg)
  res.json({ ok: true, hasKey: !!cfg.deepseekKey })
})

// ---- AI ----
app.post('/api/papers/:id/explain', async (req, res) => {
  try {
    const lib = await readJson(LIBRARY, [])
    const p = lib.find((x) => x.id === req.params.id)
    if (!p) return res.status(404).json({ error: '论文不存在' })
    const text = clip(await loadPaperText(p.id))
    if (text.trim().length < 50) {
      return res.json({
        ok: true,
        answer: '⚠️ 这篇 PDF 几乎提取不到文字，很可能是**扫描版**（图片型 PDF）。\n\n建议：\n1. 换用带文字层的 PDF 版本（很多论文官网/arXiv 提供）；\n2. 或者告诉我论文标题/摘要，我可以先离线讲个大概。',
      })
    }
    const answer = await deepseekChat(
      [
        {
          role: 'system',
          content:
            '你是一位耐心、通俗的科研导师，专门给科研新手讲论文。要求：1) 用大白话，术语第一次出现时用一句话解释；2) 不编造，论文里没有的内容要写明"未获取到"；3) 用 Markdown 组织输出。',
        },
        {
          role: 'user',
          content:
            '论文信息：\n标题：' + p.title + '\n文件名：' + p.filename + '\n页数：' + p.pageCount +
            '\n\n论文全文（节选）：\n' + text +
            '\n\n请按以下结构用中文输出一篇"新手友好讲解"：\n# 一句话定位\n# 领域背景（3-5 句）\n# 核心贡献（1-2 句）\n# 方法拆解（输入→处理→输出，通俗版）\n# 实验结果怎么看（结论是否被数据支持）\n# 局限与下一步\n# 读前问题（3-5 个）\n# 关键术语表（5-10 个，每个一句话）',
        },
      ],
      { temperature: 0.4, maxTokens: 4000 },
    )
    const explain = { answer, generatedAt: new Date().toISOString() }
    await writeJson(path.join(EXPLAIN_DIR, p.id + '.json'), explain)
    res.json({ ok: true, answer, generatedAt: explain.generatedAt })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

app.post('/api/papers/:id/ask', async (req, res) => {
  try {
    const question = (req.body.question || '').trim().slice(0, 2000)
    if (!question) return res.status(400).json({ error: '问题不能为空' })
    const lib = await readJson(LIBRARY, [])
    const p = lib.find((x) => x.id === req.params.id)
    if (!p) return res.status(404).json({ error: '论文不存在' })
    const text = clip(await loadPaperText(p.id))
    const answer = await deepseekChat(
      [
        {
          role: 'system',
          content:
            '你是一位耐心的科研导师，基于用户提供的论文内容回答问题。要求：通俗、不编造；论文里没有的信息要明确说"论文里没有提到"。用中文回答，Markdown 组织。',
        },
        {
          role: 'user',
          content: '论文：' + p.title + '\n\n论文全文（节选）：\n' + text + '\n\n我的问题：' + question,
        },
      ],
      { temperature: 0.4, maxTokens: 2500 },
    )
    const history = await readAsks(p.id)
    history.push({ role: 'user', content: question, at: new Date().toISOString() })
    history.push({ role: 'assistant', content: answer, at: new Date().toISOString() })
    const trimmed = history.length > 100 ? history.slice(-100) : history
    await writeJson(path.join(ASK_DIR, p.id + '.json'), { id: p.id, messages: trimmed, updatedAt: new Date().toISOString() })
    res.json({ ok: true, answer })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
})

// ---- 错误兜底 ----
app.use((err, req, res, next) => {
  console.error('server error', err)
  res.status(500).json({ error: String((err && err.message) || err) })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log('📚 论文阅读站已启动：http://127.0.0.1:' + PORT)
})
