// ═══════════════════════════════════════════════════════════════
//  CHART CONFIGURATION  — shared styles
// ═══════════════════════════════════════════════════════════════

const TOOLTIP_BASE = {
  backgroundColor: '#12141f',
  borderColor:     '#2a2d42',
  borderWidth:     1,
  titleColor:      '#f0f2ff',
  bodyColor:       '#9097b8',
  padding:         10,
  cornerRadius:    8,
};

const GRID_COLOR = 'rgba(42,45,66,0.6)';
const TICK_COLOR = '#5a6080';

// ═══════════════════════════════════════════════════════════════
//  CHART INIT
// ═══════════════════════════════════════════════════════════════

function initCharts() {
  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  // ── Donut – spending by category ──────────────────────────
  charts.cat = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP_BASE,
          callbacks: {
            label(ctx) {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? (ctx.raw / total * 100).toFixed(1) : '0.0';
              return ` ${ctx.label}: ${fmtAbs(ctx.raw)} (${pct}%)`;
            }
          }
        }
      },
      onClick(evt, els) {
        if (!els.length) { activeCatFilter = null; applyFilters(); return; }
        const cat = charts.cat.data.labels[els[0].index];
        activeCatFilter = activeCatFilter === cat ? null : cat;
        applyFilters();
      }
    }
  });

  // ── Bar – income vs expenses ───────────────────────────────
  charts.bar = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        { label:'Income',   data:[], backgroundColor:'rgba(16,185,129,0.75)',  borderRadius:5, borderSkipped:false },
        { label:'Expenses', data:[], backgroundColor:'rgba(239,68,68,0.75)',   borderRadius:5, borderSkipped:false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display:true, position:'top', labels:{ color:'#9097b8', usePointStyle:true, pointStyleWidth:8, font:{size:11} } },
        tooltip: { ...TOOLTIP_BASE, mode:'index', intersect:false, callbacks:{ label: c => ` ${c.dataset.label}: ${fmtAbs(c.raw)}` } }
      },
      scales: {
        x: { grid:{ color:GRID_COLOR }, ticks:{ color:TICK_COLOR, font:{size:10} } },
        y: { grid:{ color:GRID_COLOR }, ticks:{ color:TICK_COLOR, font:{size:10}, callback: v => fmtAbs(v) }, beginAtZero:true }
      }
    }
  });

  // ── Line – monthly trends ──────────────────────────────────
  charts.trend = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label:'Income',   data:[], borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.08)', tension:0.4, fill:true,  pointRadius:4, pointBackgroundColor:'#10b981', pointHoverRadius:6 },
        { label:'Expenses', data:[], borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.08)',  tension:0.4, fill:true,  pointRadius:4, pointBackgroundColor:'#ef4444', pointHoverRadius:6 },
        { label:'Net',      data:[], borderColor:'#8b5cf6', backgroundColor:'transparent',           tension:0.4, fill:false, pointRadius:4, pointBackgroundColor:'#8b5cf6', borderDash:[5,3], pointHoverRadius:6 },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { display:true, position:'top', labels:{ color:'#9097b8', usePointStyle:true, pointStyleWidth:8, font:{size:11} } },
        tooltip: { ...TOOLTIP_BASE, mode:'index', intersect:false, callbacks:{ label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid:{ color:GRID_COLOR }, ticks:{ color:TICK_COLOR, font:{size:10} } },
        y: { grid:{ color:GRID_COLOR }, ticks:{ color:TICK_COLOR, font:{size:10}, callback: v => fmtAbs(v) } }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  CHART UPDATE
// ═══════════════════════════════════════════════════════════════

function updateCharts(txs) {
  const catData = byCategory(txs);
  const mData   = byMonth(txs);

  // Donut
  charts.cat.data.labels                       = catData.map(c => c.cat);
  charts.cat.data.datasets[0].data             = catData.map(c => c.total);
  charts.cat.data.datasets[0].backgroundColor  = catData.map(c => CAT[c.cat]?.color || '#6b7280');
  charts.cat.update();

  // Category list (sidebar)
  const total = catData.reduce((s, c) => s + c.total, 0);
  el('category-list').innerHTML = catData.map(({ cat, total: t }) => {
    const pct = total > 0 ? (t / total * 100) : 0;
    const cfg = CAT[cat] || CAT['Other'];
    return `<div class="category-item">
      <span class="category-item-icon">${cfg.icon}</span>
      <span class="category-name" title="${cat}">${cat}</span>
      <span class="category-amount">${fmtAbs(t)}</span>
      <div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${pct.toFixed(1)}%;background:${cfg.color}"></div></div>
      <span class="category-pct">${pct.toFixed(1)}%</span>
    </div>`;
  }).join('');

  // Bar
  charts.bar.data.labels          = mData.map(m => m.label);
  charts.bar.data.datasets[0].data = mData.map(m => m.inc);
  charts.bar.data.datasets[1].data = mData.map(m => m.exp);
  charts.bar.update();

  // Trend
  charts.trend.data.labels          = mData.map(m => m.label);
  charts.trend.data.datasets[0].data = mData.map(m => m.inc);
  charts.trend.data.datasets[1].data = mData.map(m => m.exp);
  charts.trend.data.datasets[2].data = mData.map(m => m.net);
  charts.trend.update();
}

// ═══════════════════════════════════════════════════════════════
//  CHART TAB SWITCHES
// ═══════════════════════════════════════════════════════════════

let barMode = 'monthly';

function switchBarView(mode, tabEl) {
  barMode = mode;
  tabEl.parentElement.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  const data = mode === 'weekly' ? byWeek(filteredTx) : byMonth(filteredTx);
  charts.bar.data.labels          = data.map(d => d.label);
  charts.bar.data.datasets[0].data = data.map(d => d.inc);
  charts.bar.data.datasets[1].data = data.map(d => d.exp);
  charts.bar.update();
}

function switchTrendView(mode, tabEl) {
  tabEl.parentElement.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  charts.trend.data.datasets[0].hidden = mode === 'expense';
  charts.trend.data.datasets[1].hidden = mode === 'income';
  charts.trend.data.datasets[2].hidden = mode !== 'all';
  charts.trend.update();
}
