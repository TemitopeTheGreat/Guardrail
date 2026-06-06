// js/ledger-renderer.js — Transaction Ledger Renderer
// Guardrail Financial — renders GL with running balance, filters, pagination

(function () {
  'use strict';

  // ── CATEGORY METADATA ───────────────────────────────────────────────────────
  const CATEGORY_COLORS = {
    income:     { bg: 'bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700' },
    transfer:   { bg: 'bg-blue-50',    badge: 'bg-blue-100 text-blue-700' },
    salary:     { bg: 'bg-purple-50',  badge: 'bg-purple-100 text-purple-700' },
    rent:       { bg: 'bg-amber-50',   badge: 'bg-amber-100 text-amber-700' },
    utilities:  { bg: 'bg-cyan-50',    badge: 'bg-cyan-100 text-cyan-700' },
    fuel:       { bg: 'bg-red-50',     badge: 'bg-red-100 text-red-700' },
    purchases:  { bg: 'bg-indigo-50',  badge: 'bg-indigo-100 text-indigo-700' },
    telecoms:   { bg: 'bg-pink-50',    badge: 'bg-pink-100 text-pink-700' },
    logistics:  { bg: 'bg-orange-50',  badge: 'bg-orange-100 text-orange-700' },
    tax:        { bg: 'bg-slate-50',   badge: 'bg-slate-200 text-slate-700' },
    other:      { bg: 'bg-gray-50',    badge: 'bg-gray-100 text-gray-700' },
  };

  // ── FORMATTERS ──────────────────────────────────────────────────────────────
  function fmtNGN(n) {
    return 'NGN ' + Number(n || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  function fmtDate(isoStr) {
    const d = new Date(isoStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── LEDGER CLASS ────────────────────────────────────────────────────────────
  class Ledger {
    constructor(transactions = []) {
      this.transactions = transactions;
      this.filters = { category: null, flagged: null, dateFrom: null, dateTo: null };
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
      return this.transactions.filter(t => {
        if (this.filters.category && t.category !== this.filters.category) return false;
        if (this.filters.flagged !== null && t.is_flagged !== this.filters.flagged) return false;
        if (this.filters.dateFrom && t.date < this.filters.dateFrom) return false;
        if (this.filters.dateTo && t.date > this.filters.dateTo) return false;
        return true;
      });
    }

    getSorted() {
      const filtered = this.getFiltered();
      const sorted = [...filtered];
      if (this.sortBy === 'date') {
        sorted.sort((a, b) => new Date(b.date) - new Date(a.date));
      } else if (this.sortBy === 'amount') {
        sorted.sort((a, b) => (Number(b.credit) + Number(b.debit)) - (Number(a.credit) + Number(a.debit)));
      }
      return sorted;
    }

    getRunningBalances() {
      const sorted = this.getSorted();
      let balance = 0;
      return sorted.map(t => {
        const credit = Number(t.credit) || 0;
        const debit = Number(t.debit) || 0;
        balance += credit - debit;
        return { ...t, runningBalance: balance };
      });
    }

    getPaginated() {
      const withBalances = this.getRunningBalances();
      const total = withBalances.length;
      const start = (this.currentPage - 1) * this.pageSize;
      const end = start + this.pageSize;
      const items = withBalances.slice(start, end);
      const pageCount = Math.ceil(total / this.pageSize);
      return { items, currentPage: this.currentPage, pageCount, total };
    }

    nextPage() {
      const { pageCount } = this.getPaginated();
      if (this.currentPage < pageCount) this.currentPage++;
    }

    prevPage() {
      if (this.currentPage > 1) this.currentPage--;
    }

    toCSV() {
      const rows = ['Date,Description,Category,Debit,Credit,Running Balance'];
      this.getRunningBalances().forEach(t => {
        const credit = Number(t.credit) || 0;
        const debit = Number(t.debit) || 0;
        rows.push([
          t.date,
          `"${t.description || ''}"`,
          t.category || 'other',
          debit.toFixed(2),
          credit.toFixed(2),
          t.runningBalance.toFixed(2),
        ].join(','));
      });
      return rows.join('\n');
    }

    getFlaggedTransactions() {
      return this.transactions.filter(t => t.is_flagged);
    }

    getCategoryTotals() {
      const totals = {};
      this.transactions.forEach(t => {
        const cat = t.category || 'other';
        if (!totals[cat]) totals[cat] = { debit: 0, credit: 0, count: 0 };
        totals[cat].debit += Number(t.debit) || 0;
        totals[cat].credit += Number(t.credit) || 0;
        totals[cat].count++;
      });
      return totals;
    }
  }

  // ── RENDER FUNCTIONS ────────────────────────────────────────────────────────
  function renderLedgerRow(transaction, showBalance = true) {
    const cat = transaction.category || 'other';
    const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
    const debit = Number(transaction.debit) || 0;
    const credit = Number(transaction.credit) || 0;
    const flagged = transaction.is_flagged ? 'opacity-60 border-l-4 border-red-500' : '';

    return `
      <tr class="border-b border-slate-200 hover:bg-slate-50 ${flagged}">
        <td class="px-4 py-3 text-sm text-slate-600">${fmtDate(transaction.date)}</td>
        <td class="px-4 py-3 text-sm text-slate-900">${transaction.description || '—'}</td>
        <td class="px-4 py-3">
          <span class="inline-block px-2 py-1 rounded text-xs font-500 ${colors.badge}">${cat}</span>
          ${transaction.is_flagged ? '<span class="ml-2 text-red-600 text-xs">⚠ Flagged</span>' : ''}
        </td>
        <td class="px-4 py-3 text-sm text-red-600 font-mono text-right">${debit > 0 ? fmtNGN(debit) : '—'}</td>
        <td class="px-4 py-3 text-sm text-emerald-600 font-mono text-right">${credit > 0 ? fmtNGN(credit) : '—'}</td>
        ${showBalance ? `<td class="px-4 py-3 text-sm font-mono font-bold text-right">${fmtNGN(transaction.runningBalance)}</td>` : ''}
      </tr>
    `;
  }

  function renderLedgerTable(ledger, containerId, showBalance = true) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { items, total, currentPage, pageCount } = ledger.getPaginated();
    const cats = Object.keys(CATEGORY_COLORS).join(', ');

    const headerCols = ['Date', 'Description', 'Category', 'Debit', 'Credit'];
    if (showBalance) headerCols.push('Running Balance');

    const table = `
      <div class="space-y-4">
        <div class="flex gap-2 flex-wrap">
          <select id="filterCat" class="px-3 py-2 border border-slate-300 rounded text-sm" onchange="window.ledgerInstance.setFilter('category', this.value === '' ? null : this.value); updateLedgerView()">
            <option value="">All categories</option>
            ${Object.keys(CATEGORY_COLORS).map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="filterFlagged" onchange="window.ledgerInstance.setFilter('flagged', this.checked ? true : null); updateLedgerView()">
            Flagged only
          </label>
          <select id="sortBy" class="px-3 py-2 border border-slate-300 rounded text-sm" onchange="window.ledgerInstance.setSortBy(this.value); updateLedgerView()">
            <option value="date">Sort by date</option>
            <option value="amount">Sort by amount</option>
          </select>
          <button onclick="exportLedger()" class="px-3 py-2 bg-slate-600 text-white rounded text-sm hover:bg-slate-700">📥 Export CSV</button>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-sm">
            <thead class="bg-slate-100 border-b border-slate-300">
              <tr>
                ${headerCols.map(col => `<th class="px-4 py-3 text-left font-600 text-slate-700">${col}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${items.length > 0 ? items.map(t => renderLedgerRow(t, showBalance)).join('') : '<tr><td colspan="' + headerCols.length + '" class="px-4 py-6 text-center text-slate-500">No transactions</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between text-sm text-slate-600">
          <div>
            Showing ${items.length > 0 ? (this.currentPage - 1) * this.pageSize + 1 : 0}–${Math.min(this.currentPage * this.pageSize, total)} of ${total} transactions
          </div>
          <div class="flex gap-2">
            <button onclick="prevLedgerPage()" ${currentPage === 1 ? 'disabled' : ''} class="px-3 py-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">← Previous</button>
            <span class="px-3 py-1">Page ${currentPage}/${pageCount}</span>
            <button onclick="nextLedgerPage()" ${currentPage === pageCount ? 'disabled' : ''} class="px-3 py-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50">Next →</button>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = table;
  }

  function renderCategorySummary(ledger, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totals = ledger.getCategoryTotals();
    const rows = Object.entries(totals)
      .sort((a, b) => (b[1].credit + b[1].debit) - (a[1].credit + a[1].debit))
      .map(([cat, data]) => {
        const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.other;
        const net = data.credit - data.debit;
        return `
          <tr class="border-b border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-500 ${colors.badge}">${cat}</span></td>
            <td class="px-4 py-3 text-right font-mono text-red-600">${fmtNGN(data.debit)}</td>
            <td class="px-4 py-3 text-right font-mono text-emerald-600">${fmtNGN(data.credit)}</td>
            <td class="px-4 py-3 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}">${fmtNGN(net)}</td>
            <td class="px-4 py-3 text-right text-slate-600 text-sm">${data.count} txn</td>
          </tr>
        `;
      });

    const html = `
      <div class="border border-slate-200 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-100 border-b border-slate-300">
            <tr>
              <th class="px-4 py-3 text-left font-600 text-slate-700">Category</th>
              <th class="px-4 py-3 text-right font-600 text-slate-700">Debits</th>
              <th class="px-4 py-3 text-right font-600 text-slate-700">Credits</th>
              <th class="px-4 py-3 text-right font-600 text-slate-700">Net</th>
              <th class="px-4 py-3 text-right font-600 text-slate-700">Count</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    `;

    container.innerHTML = html;
  }

  // ── GLOBAL FUNCTIONS FOR PAGINATION/EXPORT ──────────────────────────────────
  window.ledgerInstance = null;

  window.nextLedgerPage = () => {
    if (window.ledgerInstance) {
      window.ledgerInstance.nextPage();
      updateLedgerView();
    }
  };

  window.prevLedgerPage = () => {
    if (window.ledgerInstance) {
      window.ledgerInstance.prevPage();
      updateLedgerView();
    }
  };

  window.updateLedgerView = () => {
    if (window.ledgerInstance) {
      renderLedgerTable(window.ledgerInstance, 'ledgerTable', true);
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
  };

  // ── EXPORTS ──────────────────────────────────────────────────────────────────
  window.GuardrailLedger = {
    Ledger,
    renderLedgerTable,
    renderCategorySummary,
    fmtNGN,
    fmtDate,
  };
})();
