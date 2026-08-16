const $ = (s) => document.querySelector(s)

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function showStatus(msg, ok = true) {
  const el = $('#upload-status')
  el.textContent = msg
  el.className = 'status ' + (ok ? 'ok' : 'err')
}

// ---------- 论文库 ----------
async function loadPapers() {
  const papers = await api('/api/papers')
  $('#count').textContent = papers.length ? '（' + papers.length + ' 篇）' : ''
  const list = $('#paper-list')
  list.innerHTML = ''
  $('#empty-hint').classList.toggle('hidden', papers.length > 0)
  for (const p of papers) {
    const card = document.createElement('div')
    card.className = 'paper-card'
    const date = (p.uploadedAt || '').slice(0, 10)
    const badges =
      (p.likelyScanned ? '<span class="badge warn">扫描版</span>' : '') +
      (p.hasNotes ? '<span class="badge ok">有笔记</span>' : '')
    card.innerHTML =
      '<div class="paper-title">' + escapeHtml(p.title) + badges + '</div>' +
      '<div class="paper-meta muted">' + escapeHtml(p.filename) + ' · ' + (p.pageCount || '?') + ' 页 · ' + date + '</div>' +
      '<div class="paper-actions">' +
      '  <button class="btn primary sm" data-open="' + p.id + '">📖 阅读</button>' +
      '  <button class="btn danger sm" data-del="' + p.id + '">删除</button>' +
      '</div>'
    list.appendChild(card)
  }
}

// ---------- 上传 ----------
async function uploadFile(file) {
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showStatus('只支持 PDF 文件', false)
    return
  }
  const fd = new FormData()
  fd.append('file', file)
  showStatus('正在上传并解析：' + file.name + ' …')
  try {
    const data = await api('/api/upload', { method: 'POST', body: fd })
    showStatus('✅ 已入库：' + data.paper.title + '（' + data.paper.pageCount + ' 页）')
    await loadPapers()
  } catch (e) {
    showStatus('❌ ' + e.message, false)
  }
}

$('#dropzone').addEventListener('click', () => $('#file-input').click())
$('#file-input').addEventListener('change', (e) => {
  uploadFile(e.target.files[0])
  e.target.value = ''
})
$('#dropzone').addEventListener('dragover', (e) => {
  e.preventDefault()
  $('#dropzone').classList.add('over')
})
$('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('over'))
$('#dropzone').addEventListener('drop', (e) => {
  e.preventDefault()
  $('#dropzone').classList.remove('over')
  uploadFile(e.dataTransfer.files[0])
})

$('#paper-list').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]')
  const del = e.target.closest('[data-del]')
  if (open) {
    location.href = '/reader.html?id=' + open.dataset.open
    return
  }
  if (del) {
    if (!confirm('确定删除这篇论文吗？笔记会一起删除。')) return
    try {
      await api('/api/papers/' + del.dataset.del, { method: 'DELETE' })
      await loadPapers()
    } catch (err) {
      showStatus('❌ ' + err.message, false)
    }
  }
})

// ---------- 设置 ----------
const modal = $('#settings-modal')

$('#btn-settings').addEventListener('click', async () => {
  modal.classList.remove('hidden')
  try {
    const cfg = await api('/api/config')
    const st = $('#key-status')
    st.textContent = cfg.hasKey ? '✅ 已配置 API Key' : '⚠️ 尚未配置 API Key（AI 讲解会提示你配置）'
    st.className = 'status ' + (cfg.hasKey ? 'ok' : 'err')
  } catch (e) {
    const st = $('#key-status')
    st.textContent = '❌ ' + e.message
    st.className = 'status err'
  }
})

$('#btn-key-close').addEventListener('click', () => modal.classList.add('hidden'))

$('#btn-key-save').addEventListener('click', async () => {
  const key = $('#key-input').value.trim()
  try {
    const r = await api('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deepseekKey: key }),
    })
    const st = $('#key-status')
    st.textContent = r.hasKey ? '✅ 已保存' : '⚠️ Key 为空，未保存'
    st.className = 'status ' + (r.hasKey ? 'ok' : 'err')
    $('#key-input').value = ''
  } catch (e) {
    const st = $('#key-status')
    st.textContent = '❌ ' + e.message
    st.className = 'status err'
  }
})

loadPapers().catch((e) => showStatus('❌ ' + e.message, false))
