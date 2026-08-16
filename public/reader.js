import * as pdfjsLib from '/vendor/pdfjs/build/pdf.mjs'
import { renderMarkdown } from '/md.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs'

const $ = (s) => document.querySelector(s)
const id = new URLSearchParams(location.search).get('id')

let paper = null
let pdfDoc = null
let pageNum = 1
let zoom = 1.0
let fitMode = 'width'
let glossary = []

// ---------- 阅读向导状态 ----------
const DEFAULT_STEPS = {
  s1: { done: false, problem: '', verdict: '', note: '' },
  s2: { done: false, coreIdea: '', confusions: '' },
  s3: { done: false, importance: '', idea: '', evidence: '', limitation: '', next: '' },
  s4: { done: false },
}
const EMPTY_SIX = { problem: '', method: '', results: '', contribution: '', limitations: '', thoughts: '' }
let steps = JSON.parse(JSON.stringify(DEFAULT_STEPS))
let six = Object.assign({}, EMPTY_SIX)
let activeStep = 1

const STEP_DEFS = [
  { n: 1, key: 's1', icon: '①', chip: '门面', title: '第一遍 · 门面速读', desc: '只看标题、摘要、引言、结论和图表的标题，5-10 分钟判断：这是什么论文？解决什么问题？值得读吗？' },
  { n: 2, key: 's2', icon: '②', chip: '骨架', title: '第二遍 · 骨架概括', desc: '通读全文，看懂图表和方法；遇到不懂的先标记、别深究。读完后用两三句话概括核心思路——写不出来说明还没读懂。' },
  { n: 3, key: 's3', icon: '③', chip: '四问', title: '第三遍 · 带着问题读', desc: '逐条回答四个问题：问题重要吗？核心 idea 是什么？实验结果真的支持结论吗？局限在哪、下一步怎么做？' },
  { n: 4, key: 's4', icon: '④', chip: '沉淀', title: '沉淀 · 六要素笔记', desc: '把读到的内容整理成六要素笔记——这就是你以后的综述素材库。' },
]

async function api(url, opts = {}) {
  const res = await fetch(url, opts)
  let data = null
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error((data && data.error) || '请求失败 ' + res.status)
  return data
}

// ---------- PDF 查看 ----------
async function renderPage(n) {
  const page = await pdfDoc.getPage(n)
  const viewport = page.getViewport({ scale: zoom })
  const canvas = $('#pdf-canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = viewport.width + 'px'
  canvas.style.height = viewport.height + 'px'
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)
  await page.render({ canvasContext: ctx, viewport }).promise
  ctx.restore()
  pageNum = n
  $('#page-input').value = String(n)
  $('#page-indicator').textContent = '第 ' + n + ' / ' + pdfDoc.numPages + ' 页'
}

async function goPage(n) {
  if (!pdfDoc) return
  n = Math.max(1, Math.min(pdfDoc.numPages, n))
  try {
    await renderPage(n)
  } catch (e) {
    if (!/cancelled/i.test(String((e && e.message) || e))) console.error(e)
  }
}

async function fitWidth() {
  if (!pdfDoc) return
  const page = await pdfDoc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const avail = Math.max(200, $('#viewer').clientWidth - 20)
  zoom = Math.max(0.4, Math.min(3, avail / base.width))
  $('#zoom-level').textContent = Math.round(zoom * 100) + '%'
  await goPage(pageNum)
}

async function loadPdf() {
  pdfDoc = await pdfjsLib.getDocument({ url: '/api/papers/' + id + '/pdf' }).promise
  $('#page-total').textContent = String(pdfDoc.numPages)
  $('#page-input').max = pdfDoc.numPages
  await fitWidth()
}

// ---------- 阅读向导 ----------
function firstIncompleteStep() {
  for (const d of STEP_DEFS) {
    if (!steps[d.key].done) return d.n
  }
  return 4
}

function normalizeSteps(raw) {
  const out = JSON.parse(JSON.stringify(DEFAULT_STEPS))
  if (raw && typeof raw === 'object') {
    for (const d of STEP_DEFS) {
      const s = raw[d.key]
      if (s && typeof s === 'object') {
        out[d.key].done = !!s.done
        for (const k of Object.keys(out[d.key])) {
          if (k !== 'done' && typeof s[k] === 'string') out[d.key][k] = s[k]
        }
      }
    }
  }
  return out
}

function showNoteStatus(msg, ok = true) {
  const st = $('#notes-status')
  st.textContent = msg
  st.className = 'status ' + (ok ? 'ok' : 'err')
}

function makeField(label, value, onChange, opts = {}) {
  const wrap = document.createElement('div')
  wrap.style.marginBottom = '10px'
  const lab = document.createElement('label')
  lab.className = 'six-label'
  lab.textContent = label
  wrap.appendChild(lab)
  let input
  if (opts.select) {
    input = document.createElement('select')
    input.className = 'guide-select'
    for (const pair of opts.options) {
      const opt = document.createElement('option')
      opt.value = pair[0]
      opt.textContent = pair[1]
      if (pair[0] === value) opt.selected = true
      input.appendChild(opt)
    }
    input.addEventListener('change', (e) => onChange(e.target.value))
  } else {
    input = document.createElement(opts.multiline ? 'textarea' : 'input')
    input.className = 'six-input'
    input.value = value
    if (opts.placeholder) input.placeholder = opts.placeholder
    input.addEventListener('input', (e) => onChange(e.target.value))
  }
  wrap.appendChild(input)
  return wrap
}

async function saveNotes(silent = false) {
  const r = await api('/api/papers/' + id + '/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ six, steps, glossary }),
  })
  if (!silent) showNoteStatus('✅ 已保存')
  return r
}

function stepActionButton(def) {
  const btn = document.createElement('button')
  btn.className = 'btn primary'
  if (def.n === 4) {
    btn.textContent = steps.s4.done ? '✓ 已完成（保存修改）' : '✓ 完成阅读'
  } else {
    btn.textContent = steps[def.key].done ? '✓ 已完成（保存修改）' : '✓ 完成本步'
  }
  btn.addEventListener('click', async () => {
    steps[def.key].done = true
    if (def.n === 1) {
      if (steps.s1.verdict === 'no') {
        activeStep = 4
        showNoteStatus('💡 判定不值得精读——直接跳到第四步沉淀一下结论就好')
      } else {
        activeStep = 2
        showNoteStatus('✅ 第一遍完成，进入第二遍骨架阅读')
      }
    } else if (def.n === 2) {
      activeStep = 3
      showNoteStatus('✅ 第二遍完成，进入第三遍带着问题读')
    } else if (def.n === 3) {
      activeStep = 4
      showNoteStatus('✅ 第三遍完成，最后一步：沉淀六要素笔记')
    }
    try {
      await saveNotes()
    } catch (e) {
      showNoteStatus('❌ ' + e.message, false)
    }
    renderGuide()
  })
  return btn
}

function renderStepBody(def) {
  const body = document.createElement('div')
  body.className = 'step-body'
  const h = document.createElement('h4')
  h.textContent = def.icon + ' ' + def.title
  const desc = document.createElement('p')
  desc.className = 'step-desc'
  desc.textContent = def.desc
  body.appendChild(h)
  body.appendChild(desc)

  if (def.n === 1) {
    const s = steps.s1
    body.appendChild(makeField('它解决什么问题？（一句话）', s.problem, (v) => { s.problem = v }))
    body.appendChild(makeField('值得继续读吗？', s.verdict, (v) => { s.verdict = v }, {
      select: true,
      options: [
        ['', '—— 请选择 ——'],
        ['worth', '值得精读'],
        ['maybe', '不确定，先读完骨架再定'],
        ['no', '不值得，跳过精读'],
      ],
    }))
    body.appendChild(makeField('备注 / 疑问（可选）', s.note, (v) => { s.note = v }, { multiline: true, placeholder: '比如：第一遍没看懂的地方…' }))
  } else if (def.n === 2) {
    const s = steps.s2
    body.appendChild(makeField('用两三句话概括这篇论文的核心思路', s.coreIdea, (v) => { s.coreIdea = v }, { multiline: true, placeholder: '这是检验"读没读懂"的标准，写不出来说明还要再读一遍' }))
    body.appendChild(makeField('哪些术语 / 方法还没懂？（可到下方术语表记下）', s.confusions, (v) => { s.confusions = v }, { multiline: true }))
  } else if (def.n === 3) {
    const s = steps.s3
    body.appendChild(makeField('① 这个问题重要吗？为什么？', s.importance, (v) => { s.importance = v }, { multiline: true }))
    body.appendChild(makeField('② 核心 idea 是什么？（一两句话）', s.idea, (v) => { s.idea = v }, { multiline: true }))
    body.appendChild(makeField('③ 实验结果真的支持结论吗？（数字全不全？baseline 公平吗？）', s.evidence, (v) => { s.evidence = v }, { multiline: true }))
    body.appendChild(makeField('④ 局限是什么？如果是你，下一步怎么做？', s.limitation, (v) => { s.limitation = v }, { multiline: true }))
  } else {
    const form = document.createElement('div')
    const sixDefs = [
      ['problem', '问题：解决什么问题？重要吗？'],
      ['method', '方法：核心 idea（一两句话）'],
      ['results', '实验结果：结论是否被数据支持？'],
      ['contribution', '贡献'],
      ['limitations', '局限'],
      ['thoughts', '我的想法 / 下一步'],
    ]
    for (const pair of sixDefs) {
      form.appendChild(makeField(pair[1], six[pair[0]], (v) => { six[pair[0]] = v }, { multiline: true }))
    }
    body.appendChild(form)
  }

  const actions = document.createElement('div')
  actions.className = 'step-actions'
  actions.appendChild(stepActionButton(def))
  if (def.n === 4) {
    const fill = document.createElement('button')
    fill.className = 'btn'
    fill.textContent = '🪄 一键带入前面步骤的答案'
    fill.addEventListener('click', () => {
      fillSixFromSteps()
      renderGuide()
      showNoteStatus('已把前面步骤的内容带入（只填空着的格子，已填的不覆盖）')
    })
    actions.appendChild(fill)
    const save = document.createElement('button')
    save.className = 'btn'
    save.textContent = '💾 只保存不标记完成'
    save.addEventListener('click', () => saveNotes().catch((e) => showNoteStatus('❌ ' + e.message, false)))
    actions.appendChild(save)
  }
  body.appendChild(actions)
  return body
}

function fillSixFromSteps() {
  const map = [
    ['problem', 'problem', 's1'],
    ['method', 'idea', 's3'],
    ['results', 'evidence', 's3'],
    ['limitations', 'limitation', 's3'],
    ['thoughts', 'next', 's3'],
  ]
  for (const pair of map) {
    const val = steps[pair[2]][pair[1]]
    if (!six[pair[0]].trim() && val && val.trim()) six[pair[0]] = val.trim()
  }
}

function renderGuide() {
  const doneCount = STEP_DEFS.filter((d) => steps[d.key].done).length
  const pct = Math.round((doneCount / STEP_DEFS.length) * 100)
  $('#guide-progress').innerHTML = '<div class="guide-progress-fill" style="width:' + pct + '%"></div>'
  const wrap = $('#guide-steps')
  wrap.innerHTML = ''

  const stepper = document.createElement('div')
  stepper.className = 'stepper'
  const firstOpen = firstIncompleteStep()
  for (const d of STEP_DEFS) {
    const chip = document.createElement('div')
    chip.className = 'step-chip'
    if (steps[d.key].done) chip.classList.add('done')
    if (d.n === activeStep) chip.classList.add('active')
    const canOpen = steps[d.key].done || d.n === firstOpen
    if (!canOpen) chip.classList.add('locked')
    chip.textContent = d.icon + ' ' + d.chip + (steps[d.key].done ? ' ✓' : '')
    if (canOpen) {
      chip.addEventListener('click', () => {
        activeStep = d.n
        renderGuide()
      })
    }
    stepper.appendChild(chip)
  }
  wrap.appendChild(stepper)

  const def = STEP_DEFS.find((d) => d.n === activeStep)
  wrap.appendChild(renderStepBody(def))

  if (doneCount === STEP_DEFS.length) {
    const banner = document.createElement('div')
    banner.className = 'guide-done-banner'
    banner.textContent = '🎉 这篇论文读完啦！阅读进度已保存。'
    wrap.appendChild(banner)
  }
}

// ---------- 术语表 ----------
function renderGlossary() {
  const wrap = $('#glossary-list')
  wrap.innerHTML = ''
  if (!glossary.length) {
    wrap.innerHTML = '<div class="muted">（还没有术语，读的时候随手记）</div>'
    return
  }
  for (const g of glossary) {
    const row = document.createElement('div')
    row.className = 'gl-item'
    const t = document.createElement('span')
    t.className = 'gl-term'
    t.textContent = g.term
    const x = document.createElement('span')
    x.className = 'gl-expl'
    x.textContent = g.explanation
    row.appendChild(t)
    row.appendChild(x)
    wrap.appendChild(row)
  }
}

// ---------- AI ----------
function showExplainStatus(msg, ok = true) {
  const st = $('#explain-status')
  st.textContent = msg
  st.className = 'status ' + (ok ? 'ok' : 'err')
}

async function doExplain() {
  const btn = $('#btn-explain')
  btn.disabled = true
  btn.textContent = '⏳ 正在讲解，约需 30-90 秒…'
  showExplainStatus('')
  try {
    const r = await api('/api/papers/' + id + '/explain', { method: 'POST' })
    $('#explain-out').innerHTML = renderMarkdown(r.answer)
    $('#explain-meta').textContent =
      '🤖 讲解已保存（生成于 ' + new Date(r.generatedAt).toLocaleString() + '），打开页面无需重新生成；需要更新可点上方按钮。'
  } catch (e) {
    showExplainStatus('❌ ' + e.message, false)
  } finally {
    btn.disabled = false
    btn.textContent = '🔄 重新生成讲解'
  }
}

function appendAsk(role, text) {
  const row = document.createElement('div')
  row.className = 'ask-row'
  const r = document.createElement('div')
  r.className = 'ask-role'
  r.textContent = role
  const b = document.createElement('div')
  b.className = 'ask-body md-out'
  b.innerHTML = renderMarkdown(text)
  row.appendChild(r)
  row.appendChild(b)
  const log = $('#ask-log')
  log.appendChild(row)
  log.scrollTop = log.scrollHeight
  return b
}

async function doAsk() {
  const q = $('#ask-input').value.trim()
  if (!q) return
  appendAsk('🧑‍🎓', q)
  $('#ask-input').value = ''
  const body = appendAsk('🤖', '思考中…')
  try {
    const r = await api('/api/papers/' + id + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    })
    body.innerHTML = renderMarkdown(r.answer)
  } catch (e) {
    body.textContent = '❌ ' + e.message
  }
}

// ---------- 事件 ----------
$('#prev').addEventListener('click', () => goPage(pageNum - 1))
$('#next').addEventListener('click', () => goPage(pageNum + 1))
$('#page-input').addEventListener('change', () => goPage(Number($('#page-input').value) || 1))
$('#zoom-in').addEventListener('click', () => {
  fitMode = 'custom'
  zoom = Math.min(3, Math.round((zoom + 0.25) * 100) / 100)
  $('#zoom-level').textContent = Math.round(zoom * 100) + '%'
  goPage(pageNum)
})
$('#zoom-out').addEventListener('click', () => {
  fitMode = 'custom'
  zoom = Math.max(0.4, Math.round((zoom - 0.25) * 100) / 100)
  $('#zoom-level').textContent = Math.round(zoom * 100) + '%'
  goPage(pageNum)
})
$('#fit').addEventListener('click', () => {
  fitMode = 'width'
  fitWidth()
})
$('#btn-panel').addEventListener('click', () => {
  const hidden = document.body.classList.toggle('panel-hidden')
  $('#btn-panel').textContent = hidden ? '📝 显示笔记面板' : '📝 隐藏笔记面板'
  if (fitMode === 'width') setTimeout(() => fitWidth(), 60)
})
let resizeTimer = null
window.addEventListener('resize', () => {
  if (fitMode !== 'width') return
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => fitWidth(), 150)
})

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn))
    document.querySelectorAll('.tab-body').forEach((b) => b.classList.remove('active'))
    $('#tab-' + btn.dataset.tab).classList.add('active')
  })
})

$('#btn-gl-add').addEventListener('click', () => {
  const term = $('#gl-term').value.trim()
  const explanation = $('#gl-expl').value.trim()
  if (!term || !explanation) return
  glossary.push({ term, explanation })
  $('#gl-term').value = ''
  $('#gl-expl').value = ''
  renderGlossary()
  saveNotes(true).catch(() => {})
})

$('#btn-explain').addEventListener('click', doExplain)
$('#btn-ask').addEventListener('click', doAsk)
$('#ask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAsk()
})

// 改标题
$('#btn-edit-title').addEventListener('click', () => {
  const input = $('#title-input')
  input.value = paper.title
  $('#paper-title').classList.add('hidden')
  input.classList.remove('hidden')
  input.focus()
  input.select()
})
$('#title-input').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const title = $('#title-input').value.trim()
    if (title) {
      try {
        const r = await api('/api/papers/' + id + '/meta', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        paper.title = r.paper.title
        $('#paper-title').textContent = paper.title
      } catch (err) {
        alert('保存标题失败：' + err.message)
      }
    }
    $('#title-input').classList.add('hidden')
    $('#paper-title').classList.remove('hidden')
  } else if (e.key === 'Escape') {
    $('#title-input').classList.add('hidden')
    $('#paper-title').classList.remove('hidden')
  }
})

// ---------- 初始化 ----------
async function init() {
  if (!id) {
    location.href = '/'
    return
  }
  try {
    paper = await api('/api/papers/' + id)
    $('#paper-title').textContent = paper.title
    if (paper.explain && paper.explain.answer) {
      $('#explain-out').innerHTML = renderMarkdown(paper.explain.answer)
      $('#explain-meta').textContent =
        '🤖 讲解已保存（生成于 ' + new Date(paper.explain.generatedAt).toLocaleString() + '），打开页面无需重新生成；需要更新可点上方按钮。'
      $('#btn-explain').textContent = '🔄 重新生成讲解'
    }
    if (paper.asks && paper.asks.length) {
      for (const m of paper.asks) {
        appendAsk(m.role === 'user' ? '🧑‍🎓' : '🤖', m.content)
      }
    }
    if (paper.notes) {
      six = Object.assign({}, EMPTY_SIX, paper.notes.six || {})
      steps = normalizeSteps(paper.notes.steps)
      glossary = paper.notes.glossary || []
    }
    activeStep = firstIncompleteStep()
    renderGuide()
    renderGlossary()
    if (paper.likelyScanned) {
      showExplainStatus('⚠️ 这篇疑似扫描版 PDF（文字提取很少），AI 讲解可能受限。', false)
    }
    await loadPdf()
  } catch (e) {
    alert('加载失败：' + e.message)
  }
}

init()
