// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════

const PAGE_SIZE = 30;

let statements    = [];   // [{ id, filename, txs[] }]
let stagedFiles   = [];   // File objects queued before analysis
let allTx         = [];   // combined, deduplicated transactions
let filteredTx    = [];
let currentPage   = 1;
let sortCol       = 'date';
let sortDir       = -1;
let charts        = {};
let editIdx       = null;
let currSym       = '$';
let activeCatFilter = null;

// ═══════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════

function el(id) { return document.getElementById(id); }

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(msg) {
  el('loading-text').textContent = msg;
  el('loading-overlay').style.display = 'flex';
}

function hideLoading() { el('loading-overlay').style.display = 'none'; }

let toastTimer;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function showError(msg) {
  const e = el('upload-error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

function tick() { return new Promise(r => setTimeout(r, 16)); }

// ═══════════════════════════════════════════════════════════════
//  DATA ANALYSIS
// ═══════════════════════════════════════════════════════════════

function stats(txs) {
  const inc = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const exp = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  return {
    inc, exp,
    net:  inc - exp,
    rate: inc > 0 ? (inc - exp) / inc * 100 : 0,
    incN: txs.filter(t => t.amount > 0).length,
    expN: txs.filter(t => t.amount < 0).length,
  };
}

function byCategory(txs) {
  const map = {};
  for (const t of txs.filter(t => t.amount < 0)) {
    map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([cat, total]) => ({ cat, total }));
}

function byMonth(txs) {
  const map = {};
  for (const t of txs) {
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}`;
    if (!map[k]) map[k] = { inc:0, exp:0 };
    if (t.amount > 0) map[k].inc += t.amount;
    else              map[k].exp += Math.abs(t.amount);
  }
  return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ k, label: monthLabel(k), inc: v.inc, exp: v.exp, net: v.inc - v.exp }));
}

function byWeek(txs) {
  const map = {};
  for (const t of txs) {
    const d = new Date(t.date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    const k = d.toISOString().slice(0,10);
    if (!map[k]) map[k] = { inc:0, exp:0 };
    if (t.amount > 0) map[k].inc += t.amount;
    else              map[k].exp += Math.abs(t.amount);
  }
  return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ k, label: k.slice(5), inc: v.inc, exp: v.exp }));
}

function monthLabel(k) {
  const [y, m] = k.split('-');
  return new Date(+y, +m-1, 1).toLocaleDateString('en-US', { month:'short', year:'2-digit' });
}

// ─── Formatting ───────────────────────────────────────────────

function fmt(n) {
  const a = Math.abs(n);
  let s;
  if (a >= 1_000_000)   s = (a/1_000_000).toFixed(1) + 'M';
  else if (a >= 10_000) s = (a/1_000).toFixed(1) + 'K';
  else                  s = a.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + currSym + s;
}

function fmtAbs(n) {
  return currSym + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ═══════════════════════════════════════════════════════════════
//  MULTI-FILE STAGING  (upload page)
// ═══════════════════════════════════════════════════════════════

function stageFiles(files) {
  let added = 0;
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.pdf')) continue;
    // Skip exact duplicates (same name + size)
    if (stagedFiles.find(s => s.name === f.name && s.size === f.size)) continue;
    stagedFiles.push(f);
    added++;
  }
  renderFileQueue();
  return added;
}

function renderFileQueue() {
  const qEl   = el('file-queue');
  const wrap  = el('analyze-btn-wrap');
  const btn   = el('analyze-btn');

  if (stagedFiles.length === 0) {
    qEl.innerHTML = '';
    wrap.style.display = 'none';
    return;
  }

  qEl.innerHTML = stagedFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-item-icon">📄</span>
      <span class="file-item-name" title="${esc(f.name)}">${esc(f.name)}</span>
      <span class="file-item-size">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="remove-file-btn" onclick="removeStagedFile(${i})" title="Remove">×</button>
    </div>
  `).join('');

  wrap.style.display = 'block';
  btn.textContent = `Analyze ${stagedFiles.length} Statement${stagedFiles.length > 1 ? 's' : ''}`;
}

function removeStagedFile(i) {
  stagedFiles.splice(i, 1);
  renderFileQueue();
}

// ═══════════════════════════════════════════════════════════════
//  STATEMENTS MANAGEMENT  (dashboard)
// ═══════════════════════════════════════════════════════════════

function rebuildAllTx() {
  const seen = new Set();
  const combined = [];
  for (const stmt of statements) {
    for (const tx of stmt.txs) {
      const key = `${tx.date.toDateString()}|${tx.description}|${tx.amount}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push({ ...tx, id: combined.length, stmtId: stmt.id });
      }
    }
  }
  combined.sort((a, b) => a.date - b.date);
  allTx = combined;
}

function renderStatementsBar() {
  const bar   = el('statements-bar');
  const chips = el('stmt-chips');

  if (statements.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  chips.innerHTML = statements.map(s => `
    <div class="stmt-chip">
      📄 <span class="stmt-chip-name" title="${esc(s.filename)}">${esc(s.filename)}</span>
      <button class="stmt-chip-remove" onclick="removeStatement(${s.id})" title="Remove statement">×</button>
    </div>
  `).join('');
}

function removeStatement(id) {
  statements = statements.filter(s => s.id !== id);
  if (statements.length === 0) {
    resetDashboard();
    toast('All statements removed');
    return;
  }
  rebuildAllTx();
  activeCatFilter = null;
  filteredTx = [...allTx];

  renderStatementsBar();
  updateNavPeriod();
  populateFilters();
  updateCards(allTx);
  updateCharts(allTx);
  applyFilters();
  toast('Statement removed');
}

function addMoreStatements() {
  el('add-more-input').click();
}

function updateNavPeriod() {
  if (allTx.length === 0) return;
  const dates = allTx.map(t => t.date);
  const minD  = new Date(Math.min(...dates));
  const maxD  = new Date(Math.max(...dates));
  el('nav-period').textContent =
    minD.toLocaleDateString('en-US', { month:'short', year:'numeric' }) + ' – ' +
    maxD.toLocaleDateString('en-US', { month:'short', year:'numeric' });
}

// ═══════════════════════════════════════════════════════════════
//  ANALYSIS  — processes staged files or a new set of files
// ═══════════════════════════════════════════════════════════════

async function analyzeAll() {
  if (stagedFiles.length === 0) return;

  el('upload-error').classList.add('hidden');
  const errors = [];

  for (let i = 0; i < stagedFiles.length; i++) {
    const file = stagedFiles[i];
    try {
      setLoading(`Processing ${file.name} (${i+1}/${stagedFiles.length})…`);
      const lines = await parsePDF(file);

      if (i === 0) currSym = detectCurrency(lines);

      setLoading(`Extracting transactions from ${file.name}…`);
      await tick();

      const txs = extractTx(lines);
      if (txs.length > 0) {
        statements.push({ id: Date.now() + i, filename: file.name, txs });
      } else {
        errors.push(`${file.name}: no transactions found`);
      }
    } catch (err) {
      console.error(`Error in ${file.name}:`, err);
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  stagedFiles = [];
  renderFileQueue();

  if (statements.length === 0) {
    hideLoading();
    showError('No transactions found in any uploaded file. ' +
      (errors.length ? errors.join('; ') : 'Try a text-based PDF export from your bank.'));
    return;
  }

  setLoading('Building dashboard…');
  await tick();

  rebuildAllTx();
  showDashboard(errors);
}

async function processAndAddFiles(files) {
  let added = 0;
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    // Skip already loaded (same name + size heuristic)
    if (statements.find(s => s.filename === file.name)) {
      errors.push(`${file.name} is already loaded`);
      continue;
    }

    try {
      setLoading(`Adding ${file.name} (${i+1}/${files.length})…`);
      const lines = await parsePDF(file);
      setLoading(`Extracting transactions from ${file.name}…`);
      await tick();

      const txs = extractTx(lines);
      if (txs.length > 0) {
        statements.push({ id: Date.now() + i, filename: file.name, txs });
        added++;
      }
    } catch (err) {
      console.error(err);
      errors.push(`${file.name}: ${err.message}`);
    }
  }

  if (added === 0) {
    hideLoading();
    if (errors.length) toast(errors[0]);
    return;
  }

  setLoading('Rebuilding dashboard…');
  await tick();

  rebuildAllTx();
  activeCatFilter = null;
  filteredTx = [...allTx];

  renderStatementsBar();
  updateNavPeriod();
  populateFilters();
  updateCards(allTx);
  updateCharts(allTx);
  applyFilters();
  hideLoading();

  const total = allTx.length;
  toast(`✓ ${total} transactions total from ${statements.length} statement${statements.length > 1 ? 's' : ''}`);
  if (errors.length) setTimeout(() => toast(errors[0]), 3200);
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD DISPLAY
// ═══════════════════════════════════════════════════════════════

function showDashboard(errors) {
  filteredTx = [...allTx];

  updateNavPeriod();

  el('upload-page').style.display = 'none';
  el('dashboard-page').style.display = 'block';

  renderStatementsBar();
  initCharts();
  populateFilters();
  updateCards(allTx);
  updateCharts(allTx);

  // Initial sort: newest first
  filteredTx.sort((a, b) => b.date - a.date);
  sortCol = 'date'; sortDir = -1;
  el('s-date').textContent = ' ▼';
  el('s-date').parentElement.classList.add('sorted');
  renderTable();

  // Warn if many uncategorized
  const otherPct = allTx.filter(t => t.category === 'Other').length / allTx.length * 100;
  if (otherPct > 35) {
    el('warn-text').textContent =
      `${otherPct.toFixed(0)}% of transactions are in "Other". Click a category badge to reassign.`;
    el('warn-banner').style.display = 'flex';
  }

  hideLoading();

  const stmtCount = statements.length;
  toast(`✓ Loaded ${allTx.length} transactions from ${stmtCount} statement${stmtCount > 1 ? 's' : ''}`);

  if (errors && errors.length) {
    setTimeout(() => toast(`⚠ ${errors[0]}`), 3200);
  }
}

function resetDashboard() {
  el('dashboard-page').style.display = 'none';
  el('upload-page').style.display = 'flex';
  el('upload-error').classList.add('hidden');
  el('upload-error').textContent = '';
  el('file-input').value = '';

  statements    = [];
  stagedFiles   = [];
  allTx         = [];
  filteredTx    = [];
  activeCatFilter = null;

  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  renderFileQueue();
  renderStatementsBar();
}

// ═══════════════════════════════════════════════════════════════
//  SUMMARY CARDS & INSIGHTS
// ═══════════════════════════════════════════════════════════════

function updateCards(txs) {
  const s = stats(txs);
  el('total-income').textContent  = fmtAbs(s.inc);
  el('total-expenses').textContent = fmtAbs(s.exp);
  el('income-count').textContent  = `${s.incN} transaction${s.incN !== 1 ? 's' : ''}`;
  el('expense-count').textContent = `${s.expN} transaction${s.expN !== 1 ? 's' : ''}`;

  const net = el('net-balance');
  net.textContent = (s.net >= 0 ? '+' : '') + fmt(s.net);
  net.className   = 'card-amount ' + (s.net >= 0 ? 'positive' : 'negative');

  const rate = el('savings-rate');
  rate.textContent = s.rate.toFixed(1) + '%';
  rate.className   = 'card-amount ' + (s.rate >= 0 ? 'positive' : 'negative');

  // Insights
  const cats = byCategory(txs);
  if (cats.length > 0) {
    const top = cats[0];
    el('top-category').textContent = `${CAT[top.cat]?.icon || '📋'} ${top.cat} · ${fmtAbs(top.total)}`;
  }

  const months = byMonth(txs);
  if (months.length > 0) {
    const big    = months.reduce((mx, m) => m.exp > mx.exp ? m : mx, months[0]);
    const avgExp = months.reduce((s, m) => s + m.exp, 0) / months.length;
    el('biggest-month').textContent = `${big.label} · ${fmtAbs(big.exp)}`;
    el('avg-monthly').textContent   = fmtAbs(avgExp);
  }
}

// ═══════════════════════════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════════════════════════

function populateFilters() {
  // Category dropdown
  const cf   = el('cat-filter');
  const prev = cf.value;
  cf.innerHTML = '<option value="">All Categories</option>';
  [...new Set(allTx.map(t => t.category))].sort().forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = `${CAT[c]?.icon || '📋'} ${c}`;
    if (c === prev) o.selected = true;
    cf.appendChild(o);
  });

  // Month dropdown
  const mf = el('month-filter');
  const pm = mf.value;
  mf.innerHTML = '<option value="">All Months</option>';
  [...new Set(allTx.map(t =>
    `${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}`))]
    .sort().reverse().forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = monthLabel(m);
      if (m === pm) o.selected = true;
      mf.appendChild(o);
    });
}

function applyFilters() {
  const search = el('search-input').value.toLowerCase();
  const cat    = activeCatFilter || el('cat-filter').value;
  const type   = el('type-filter').value;
  const month  = el('month-filter').value;

  if (activeCatFilter && el('cat-filter').value !== activeCatFilter) {
    el('cat-filter').value = activeCatFilter;
  }

  filteredTx = allTx.filter(t => {
    if (search && !t.description.toLowerCase().includes(search)) return false;
    if (cat   && t.category !== cat) return false;
    if (type === 'income'  && t.amount <= 0) return false;
    if (type === 'expense' && t.amount >= 0) return false;
    if (month) {
      const tk = `${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}`;
      if (tk !== month) return false;
    }
    return true;
  });

  currentPage = 1;
  renderTable();
  updateCards(filteredTx);
  updateCharts(filteredTx);
  if (barMode === 'weekly') switchBarView('weekly', document.querySelector('[data-view="weekly"]'));
}

// ═══════════════════════════════════════════════════════════════
//  TABLE
// ═══════════════════════════════════════════════════════════════

function toggleSort(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = col === 'amount' ? -1 : 1; }

  ['date','description','category','amount'].forEach(c => {
    el(`s-${c}`).textContent = '';
    el(`s-${c}`).parentElement.classList.remove('sorted');
  });
  el(`s-${sortCol}`).textContent = sortDir === 1 ? ' ▲' : ' ▼';
  el(`s-${sortCol}`).parentElement.classList.add('sorted');

  filteredTx.sort((a, b) => {
    if (sortCol === 'date')   return sortDir * (a.date - b.date);
    if (sortCol === 'amount') return sortDir * (a.amount - b.amount);
    return sortDir * String(a[sortCol]).localeCompare(String(b[sortCol]));
  });

  renderTable();
}

function renderTable() {
  const tbody = el('tx-tbody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredTx.slice(start, start + PAGE_SIZE);

  if (filteredTx.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div>No transactions match your filters</div>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = page.map((t, i) => {
      const d      = t.date.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
      const cfg    = CAT[t.category] || CAT['Other'];
      const bg     = cfg.color + '22';
      const credit = t.amount > 0;
      return `<tr>
        <td class="tx-date">${d}</td>
        <td class="tx-description" title="${esc(t.description)}">${esc(t.description)}</td>
        <td>
          <span class="category-badge" style="background:${bg};color:${cfg.color}"
            onclick="openModal(${start + i})" title="Click to change category">
            ${cfg.icon} ${t.category}
          </span>
        </td>
        <td class="tx-amount ${credit ? 'credit' : 'debit'}">${credit ? '+' : ''}${fmt(t.amount)}</td>
        <td><button class="edit-btn" onclick="openModal(${start + i})" title="Edit category">✎</button></td>
      </tr>`;
    }).join('');
  }

  const expSum = filteredTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const incSum = filteredTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  el('tx-summary').textContent =
    `${filteredTx.length} transactions · ${fmtAbs(expSum)} spent · ${fmtAbs(incSum)} received`;

  renderPagination();
}

function renderPagination() {
  const total = filteredTx.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  el('page-info').textContent = `Showing ${Math.min(start, total)}–${end} of ${total}`;

  if (pages <= 1) { el('page-controls').innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;

  let lo = Math.max(1, currentPage-2), hi = Math.min(pages, lo+4);
  lo = Math.max(1, hi-4);

  if (lo > 1) html += `<button class="page-btn" onclick="goPage(1)">1</button>`;
  if (lo > 2) html += `<span style="padding:0 2px;color:var(--text-3);font-size:.8rem">…</span>`;

  for (let p = lo; p <= hi; p++)
    html += `<button class="page-btn ${p===currentPage?'active':''}" onclick="goPage(${p})">${p}</button>`;

  if (hi < pages-1) html += `<span style="padding:0 2px;color:var(--text-3);font-size:.8rem">…</span>`;
  if (hi < pages)   html += `<button class="page-btn" onclick="goPage(${pages})">${pages}</button>`;

  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>›</button>`;
  el('page-controls').innerHTML = html;
}

function goPage(p) {
  const pages = Math.ceil(filteredTx.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
}

// ═══════════════════════════════════════════════════════════════
//  CATEGORY MODAL
// ═══════════════════════════════════════════════════════════════

function openModal(idx) {
  editIdx = idx;
  const t = filteredTx[idx];
  el('modal-desc').textContent    = t.description;
  el('category-grid').innerHTML   = ALL_CATS.map(c => {
    const cfg = CAT[c];
    return `<div class="cat-option ${c===t.category?'selected':''}" data-cat="${c}" onclick="selectCat(this)">
      <span>${cfg.icon}</span><span>${c}</span>
    </div>`;
  }).join('');
  el('modal-overlay').style.display = 'flex';
}

function selectCat(elNode) {
  document.querySelectorAll('.cat-option').forEach(o => o.classList.remove('selected'));
  elNode.classList.add('selected');
}

function saveCategory() {
  const sel = document.querySelector('.cat-option.selected');
  if (!sel || editIdx === null) return;
  const nc = sel.dataset.cat;
  const t  = filteredTx[editIdx];
  t.category = nc;
  const ai = allTx.findIndex(x => x.id === t.id);
  if (ai !== -1) allTx[ai].category = nc;
  closeModal();
  renderTable();
  updateCharts(filteredTx);
  updateCards(filteredTx);
  toast('Category updated ✓');
}

function closeModal() {
  el('modal-overlay').style.display = 'none';
  editIdx = null;
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════

function exportCSV() {
  const rows = [['Date','Description','Category','Amount','Source']];
  for (const t of allTx) {
    const stmt = statements.find(s => s.id === t.stmtId);
    rows.push([
      t.date.toLocaleDateString('en-US'),
      `"${t.description.replace(/"/g,'""')}"`,
      t.category,
      t.amount.toFixed(2),
      stmt ? `"${stmt.filename.replace(/"/g,'""')}"` : '',
    ]);
  }
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'transactions.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV exported ✓');
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

// Upload page — file picker & drag-drop
el('file-input').addEventListener('change', e => {
  stageFiles([...e.target.files]);
  e.target.value = ''; // allow re-selecting same files
});

const dz = el('drop-zone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag-over');
  stageFiles([...e.dataTransfer.files]);
});

// Dashboard — add more statements
el('add-more-input').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  await processAndAddFiles(files);
});

// Modal — close on backdrop click or Escape
el('modal-overlay').addEventListener('click', e => {
  if (e.target === el('modal-overlay')) closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
