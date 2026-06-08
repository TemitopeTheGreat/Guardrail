// js/ledger-renderer.js — Transaction Ledger Renderer
// Guardrail Financial — renders GL with running balance, filters, pagination
// Dark-theme to match dashboard shell (bg-slate-950 / panels bg-slate-900 border-slate-800)

(function () {
  'use strict';

  // ── MATERIALITY ─────────────────────────────────────────────────────────────
  // Materiality principle: flag any single transaction above this threshold for
  // extra scrutiny — NGN 500,000.
  const MATERIALITY_THRESHOLD = 500_000;

  // ── CATEGORY → TYPE GROUPING (drives badge colour, consistency principle) ───
  const CATEGORY_TYPE = {
    income: 'income', transfer: 'income',
    fuel: 'cost', purchases: 'cost',
    salary: 'opex', rent: 'opex', utilities: 'opex', telecoms: 'opex', logistics: 'opex',
    tax: 'tax', vat: 'tax',
  };

  const TYPE_BADGE = {
    income: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    cost:   'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    opex:   'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30',
    tax:    'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30',
    other:  'bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/40',
  };

  const TYPE_BAR_COLOR = {
    income: '#34D399', cost: '#FBBF24', opex: '#94A3B8', tax: '#818CF8', other: '#64748B',
  };

  function badgeClassFor(category) {
    const type = CATEGORY_TYPE[category] || 'other';
    return TYPE_BADGE[type] || TYPE_BADGE.other;
  }

  function barColorFor(category) {
    const type = CATEGORY_TYPE[category] || 'other';
    return TYPE_BAR_COLOR[type] || TYPE_BAR_COLOR.other;
  }

  const ALL_CATEGORIES = ['income', 'transfer', 'salary', 'rent', 'utilities', 'fuel',
    'purchases', 'telecoms', 'logistics', 'tax', 'vat', 'other'];

  // ── FORMATTERS ──────────────────────────────────────────────────────────────
  function fmtNGN(n) {
    return 'NGN ' + Number(n || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr + 'T00:00:00Z');
    if (isNaN(d)) return isoStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ── LEDGER CLASS ────────────────────────────────────────────────────────────
  class Ledger {
    constructor(transactions = []) {
      // Running balance is computed ONCE, in chronological (ledger) order, and
      // cached on each row. Display sorting/filtering must never recompute it —
      // a ledger's balance reflects the order entries were posted, not the
      // order they happen to be viewed in.
      const chronological = [...transactions].sort((a, b) => {
        const an = Number(a.row_number), bn = Number(b.row_number);
        if (!isNaN(an) && !isNaN(bn)) return an - bn;
        return new Date(a.txn_date || a.date) - new Date(b.txn_date || b.date);
      });

      let balance = 0;
      this.ledgerRows = chronological.map(t => {
        const credit = Number(t.credit) || 0;
        const debit = Number(t.debit) || 0;
        balance += credit - debit;
        return { ...t, runningBalance: balance };
      });

      this.filters = { category: null, type: null, search: '', dateFrom: null, dateTo: null, flagged: null };
      this.sortBy = 'date'; // date, amount, balance
      this.pageSize = 20;
      this.currentPage = 1;
    }

    setFilter(field, value) {
      this.filters[field] = value;
      this.currentPage = 1;
    }

    setSortBy(field) {
      this.sortBy = field;
      this.currentPage = 1;
    }

    getFiltered() {
      const search = (this.filters.search || '').trim().toLowerCase();
      return this.ledgerRows.filter(t => {
        if (this.filters.category && t.category !== this.filters.category) return false;
        if (this.filters.flagged !== null && Boolean(t.is_flagged) !== this.filters.flagged) return false;
        if (this.filters.type === 'income' && !(Number(t.credit) > 0)) return false;
        if (this.filters.type === 'expense' && !(Number(t.debit) > 0)) return false;
        if (search && !String(t.description || '').toLowerCase().includes(search)) return false;
        const date = t.txn_date || t.date;
        if (this.filters.dateFrom && (!date || date < this.filters.dateFrom)) return false;
        if (this.filters.dateTo && (!date || date > this.filters.dateTo)) return false;
        return true;
      });
    }

    getSorted() {
      const filtered = this.getFiltered();
      const sorted = [...filtered];
      if (this.sortBy === 'date') {
        sorted.sort((a, b) => new Date(b.txn_date || b.date) - new Date(a.txn_date || a.date));
      } else if (this.sortBy === 'amount') {
        sorted.sort((a, b) => (Number(b.credit) + Number(b.debit)) - (Number(a.credit) + Number(a.debit)));
      } else if (this.sortBy === 'balance') {
        sorted.sort((a, b) => b.runningBalance - a.runningBalance);
      }
      return sorted;
    }

    getPaginated() {
      const sorted = this.getSorted();
      const total = sorted.length;
      const pageCount = Math.max(1, Math.ceil(total / this.pageSize));
      if (this.currentPage > pageCount) this.currentPage = pageCount;
      const start = (this.currentPage - 1) * this.pageSize;
      const end = start + this.pageSize;
      const items = sorted.slice(start, end);
      return { items, currentPage: this.currentPage, pageCount, total, allFiltered: sorted };
    }

    nextPage() {
      const { pageCount } = this.getPaginated();
      if (this.currentPage < pageCount) this.currentPage++;
    }

    prevPage() {
      if (this.currentPage > 1) this.currentPage--;
    }

    goToPage(n) {
      const { pageCount } = this.getPaginated();
      const page = Math.min(Math.max(1, Math.floor(Number(n) || 1)), pageCount);
      this.currentPage = page;
    }

    getTotals() {
      const { items, allFiltered } = this.getPaginated();
      const sum = (rows, field) => rows.reduce((s, t) => s + (Number(t[field]) || 0), 0);
      return {
        pageDebit: sum(items, 'debit'),
        pageCredit: sum(items, 'credit'),
        grandDebit: sum(allFiltered, 'debit'),
        grandCredit: sum(allFiltered, 'credit'),
        grandCount: allFiltered.length,
      };
    }

    toCSV() {
      const rows = ['#,Date,Description,Category,Debit,Credit,Balance'];
      this.getSorted().forEach((t, i) => {
        const credit = Number(t.credit) || 0;
        const debit = Number(t.debit) || 0;
        rows.push([
          i + 1,
          t.txn_date || t.date || '',
          `"${String(t.description || '').replace(/"/g, '""')}"`,
          t.category || 'other',
          debit.toFixed(2),
          credit.toFixed(2),
          t.runningBalance.toFixed(2),
        ].join(','));
      });
      return rows.join('\n');
    }

    getFlaggedTransactions() {
      return this.ledgerRows.filter(t => t.is_flagged);
    }

    getCategoryTotals() {
      const totals = {};
      this.ledgerRows.forEach(t => {
        const cat = t.category || 'other';
        if (!totals[cat]) totals[cat] = { debit: 0, credit: 0, count: 0 };
        totals[cat].debit += Number(t.debit) || 0;
        totals[cat].credit += Number(t.credit) || 0;
        totals[cat].count++;
      });
      return totals;
    }
  }

  // ── RENDER: LEDGER ROW ──────────────────────────────────────────────────────
  function renderLedgerRow(transaction, rowNumber, showBalance = true) {
    const cat = transaction.category || 'other';
    const debit = Number(transaction.debit) || 0;
    const credit = Number(transaction.credit) || 0;
    const isMaterial = debit > MATERIALITY_THRESHOLD || credit > MATERIALITY_THRESHOLD;
    const balance = transaction.runningBalance || 0;

    // Row left-border: flagged > income/expense (per spec — flagged takes priority)
    let borderClass = 'border-l-2 border-transparent';
    if (transaction.is_flagged) borderClass = 'border-l-2 border-amber-500';
    else if (credit > 0) borderClass = 'border-l-2 border-emerald-500';
    else if (debit > 0) borderClass = 'border-l-2 border-rose-500';

    const descClass = isMaterial ? 'font-bold text-white' : 'text-slate-200';
    const materialBadge = isMaterial
      ? `<span class="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold align-middle bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/40">MATERIAL</span>`
      : '';
    const flagIcon = transaction.is_flagged
      ? `<span class="ml-2 inline-flex items-center text-amber-400 text-xs align-middle" title="${escapeHtml(transaction.flag_reason || 'flagged')}">⚠</span>`
      : '';

    return `
      <tr class="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${borderClass}">
        <td class="px-3 py-3 text-xs text-slate-500 mono">${rowNumber}</td>
        <td class="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">${fmtDate(transaction.txn_date || transaction.date)}</td>
        <td class="px-4 py-3 text-sm ${descClass}">${escapeHtml(transaction.description) || '—'}${materialBadge}${flagIcon}</td>
        <td class="px-4 py-3">
          <span class="inline-block px-2 py-1 rounded text-xs font-medium ${badgeClassFor(cat)}">${escapeHtml(cat)}</span>
        </td>
        <td class="px-4 py-3 text-sm text-rose-400 mono text-right">${debit > 0 ? fmtNGN(debit) : '—'}</td>
        <td class="px-4 py-3 text-sm text-emerald-400 mono text-right">${credit > 0 ? fmtNGN(credit) : '—'}</td>
        ${showBalance ? `<td class="px-4 py-3 text-sm font-bold mono text-right ${balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${fmtNGN(balance)}</td>` : ''}
      </tr>
    `;
  }

  // ── RENDER: LEDGER TABLE ────────────────────────────────────────────────────
  function renderLedgerTable(ledger, containerId, showBalance = true) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { items, total, currentPage, pageCount } = ledger.getPaginated();
    const totals = ledger.getTotals();
    const startRow = total > 0 ? (currentPage - 1) * ledger.pageSize + 1 : 0;
    const endRow = Math.min(currentPage * ledger.pageSize, total);

    const headerCols = ['#', 'Date', 'Description', 'Category', 'Debit', 'Credit'];
    if (showBalance) headerCols.push('Balance');
    const colCount = headerCols.length;

    const inputCls = 'px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-400 transition-colors';
    const selectCls = inputCls + ' appearance-none';

    const f = ledger.filters;

    const table = `
      <div class="space-y-4">
        <!-- Search & filter bar -->
        <div class="flex flex-wrap gap-2 items-center">
          <input type="text" id="ledgerSearch" placeholder="Search description…" value="${escapeHtml(f.search)}"
            class="${inputCls} flex-1 min-w-[180px]"
            oninput="window.setLedgerSearch(this.value)">

          <select id="filterCat" class="${selectCls}" onchange="window.ledgerInstance.setFilter('category', this.value || null); updateLedgerView()">
            <option value="">All categories</option>
            ${ALL_CATEGORIES.map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>

          <select id="filterType" class="${selectCls}" onchange="window.ledgerInstance.setFilter('type', this.value || null); updateLedgerView()">
            <option value="" ${!f.type ? 'selected' : ''}>All types</option>
            <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income only</option>
            <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expenses only</option>
          </select>

          <label class="flex items-center gap-1.5 text-xs text-slate-400">
            From
            <input type="date" value="${f.dateFrom || ''}" class="${inputCls} py-1.5"
              onchange="window.ledgerInstance.setFilter('dateFrom', this.value || null); updateLedgerView()">
          </label>
          <label class="flex items-center gap-1.5 text-xs text-slate-400">
            To
            <input type="date" value="${f.dateTo || ''}" class="${inputCls} py-1.5"
              onchange="window.ledgerInstance.setFilter('dateTo', this.value || null); updateLedgerView()">
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" id="filterFlagged" ${f.flagged ? 'checked' : ''}
              onchange="window.ledgerInstance.setFilter('flagged', this.checked ? true : null); updateLedgerView()">
            Flagged only
          </label>

          <select id="sortBy" class="${selectCls}" onchange="window.ledgerInstance.setSortBy(this.value); updateLedgerView()">
            <option value="date" ${ledger.sortBy === 'date' ? 'selected' : ''}>Sort by date</option>
            <option value="amount" ${ledger.sortBy === 'amount' ? 'selected' : ''}>Sort by amount</option>
            <option value="balance" ${ledger.sortBy === 'balance' ? 'selected' : ''}>Sort by balance</option>
          </select>

          <button onclick="exportLedger()" class="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg text-sm transition-colors">⬇ Export ledger</button>
        </div>

        <div class="overflow-x-auto border border-slate-800 rounded-xl">
          <table class="w-full text-sm">
            <thead class="bg-slate-800/60 border-b border-slate-700">
              <tr>
                ${headerCols.map(col => `<th class="px-4 py-3 text-left font-semibold text-slate-400 text-xs uppercase tracking-wider whitespace-nowrap ${(col === 'Debit' || col === 'Credit' || col === 'Balance') ? 'text-right' : ''}">${col}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${items.length > 0
                ? items.map((t, i) => renderLedgerRow(t, (currentPage - 1) * ledger.pageSize + i + 1, showBalance)).join('')
                : `<tr><td colspan="${colCount}" class="px-4 py-10 text-center text-slate-500">No transactions match the current filters</td></tr>`}
            </tbody>
            <tfoot>
              <tr class="bg-slate-800/40 border-t border-slate-700 text-xs">
                <td colspan="4" class="px-4 py-2 text-slate-400 font-semibold uppercase tracking-wider">Subtotal (this page)</td>
                <td class="px-4 py-2 text-right mono text-rose-400 font-semibold">${fmtNGN(totals.pageDebit)}</td>
                <td class="px-4 py-2 text-right mono text-emerald-400 font-semibold">${fmtNGN(totals.pageCredit)}</td>
                ${showBalance ? '<td></td>' : ''}
              </tr>
              <tr class="bg-slate-800/70 border-t border-slate-700 text-xs">
                <td colspan="4" class="px-4 py-2 text-slate-300 font-bold uppercase tracking-wider">Grand total (${totals.grandCount} filtered rows)</td>
                <td class="px-4 py-2 text-right mono text-rose-300 font-bold">${fmtNGN(totals.grandDebit)}</td>
                <td class="px-4 py-2 text-right mono text-emerald-300 font-bold">${fmtNGN(totals.grandCredit)}</td>
                ${showBalance ? '<td></td>' : ''}
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <div>Showing ${startRow}–${endRow} of ${total} transactions</div>
          <div class="flex items-center gap-2">
            <button onclick="prevLedgerPage()" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Previous</button>
            <span class="px-2">Page ${currentPage} / ${pageCount}</span>
            <button onclick="nextLedgerPage()" ${currentPage === pageCount ? 'disabled' : ''} class="px-3 py-1.5 border border-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next →</button>
            <label class="flex items-center gap-1.5 ml-2 text-xs">
              Jump to
              <input type="number" min="1" max="${pageCount}" value="${currentPage}" id="ledgerJumpPage"
                class="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 outline-none focus:border-emerald-400"
                onkeydown="if(event.key==='Enter'){window.jumpLedgerPage(this.value)}">
              <button onclick="window.jumpLedgerPage(document.getElementById('ledgerJumpPage').value)"
                class="px-2 py-1 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors">Go</button>
            </label>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = table;
  }

  // ── RENDER: CATEGORY SUMMARY ────────────────────────────────────────────────
  function renderCategorySummary(ledger, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totals = ledger.getCategoryTotals();
    const entries = Object.entries(totals)
      .map(([cat, data]) => ({ cat, ...data, activity: data.debit + data.credit, net: data.credit - data.debit }))
      .sort((a, b) => b.activity - a.activity);

    const grandActivity = entries.reduce((s, e) => s + e.activity, 0) || 1;
    const activeCategory = ledger.filters.category;

    const rows = entries.map(e => {
      const pct = (e.activity / grandActivity) * 100;
      const selected = activeCategory === e.cat;
      return `
        <button type="button" onclick="window.ledgerInstance.setFilter('category', ${selected ? 'null' : `'${e.cat}'`}); updateLedgerView(); updateCategorySummaryView();"
          class="w-full text-left px-3 py-3 rounded-lg border transition-colors ${selected ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'}">
          <div class="flex items-center justify-between mb-1.5">
            <span class="inline-flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-xs font-medium ${badgeClassFor(e.cat)}">${escapeHtml(e.cat)}</span>
              <span class="text-xs text-slate-500">${e.count} txn${e.count === 1 ? '' : 's'}</span>
            </span>
            <span class="text-xs font-semibold text-slate-400">${pct.toFixed(1)}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2">
            <div class="h-full rounded-full" style="width:${pct.toFixed(2)}%; background:${barColorFor(e.cat)}"></div>
          </div>
          <div class="flex items-center justify-between text-xs mono">
            <span class="text-rose-400">Dr ${fmtNGN(e.debit)}</span>
            <span class="text-emerald-400">Cr ${fmtNGN(e.credit)}</span>
            <span class="font-semibold ${e.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}">Net ${fmtNGN(e.net)}</span>
          </div>
        </button>
      `;
    });

    container.innerHTML = entries.length
      ? `<div class="space-y-2">${rows.join('')}</div>
         <p class="text-xs text-slate-600 mt-3">Click a category to filter the ledger to just those transactions.</p>`
      : `<p class="text-sm text-slate-500 text-center py-8">No category data yet</p>`;
  }

  // ── GLOBAL FUNCTIONS FOR FILTER/PAGINATION/EXPORT ───────────────────────────
  window.ledgerInstance = null;

  window.nextLedgerPage = () => {
    if (window.ledgerInstance) { window.ledgerInstance.nextPage(); updateLedgerView(); }
  };

  window.prevLedgerPage = () => {
    if (window.ledgerInstance) { window.ledgerInstance.prevPage(); updateLedgerView(); }
  };

  window.jumpLedgerPage = (value) => {
    if (window.ledgerInstance) { window.ledgerInstance.goToPage(value); updateLedgerView(); }
  };

  window.setLedgerSearch = (value) => {
    if (!window.ledgerInstance) return;
    window.ledgerInstance.setFilter('search', value);
    // Re-render the table body/footer without rebuilding the search input itself,
    // so the user doesn't lose focus/cursor position while typing.
    const container = document.getElementById('ledgerTable');
    const input = document.getElementById('ledgerSearch');
    const caret = input ? input.selectionStart : null;
    renderLedgerTable(window.ledgerInstance, 'ledgerTable', true);
    const restored = document.getElementById('ledgerSearch');
    if (restored) {
      restored.focus();
      if (caret !== null) restored.setSelectionRange(caret, caret);
    }
  };

  window.updateLedgerView = () => {
    if (window.ledgerInstance) {
      renderLedgerTable(window.ledgerInstance, 'ledgerTable', true);
    }
  };

  window.updateCategorySummaryView = () => {
    if (window.ledgerInstance) {
      renderCategorySummary(window.ledgerInstance, 'categorySummary');
    }
  };

  window.exportLedger = () => {
    if (!window.ledgerInstance) return;
    const csv = window.ledgerInstance.toCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `guardrail-ledger-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // ── EXPORTS ──────────────────────────────────────────────────────────────────
  window.GuardrailLedger = {
    Ledger,
    renderLedgerTable,
    renderCategorySummary,
    fmtNGN,
    fmtDate,
    MATERIALITY_THRESHOLD,
  };
})();
