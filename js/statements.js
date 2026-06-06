// js/statements.js — Financial Statements Generator (IAS 1 aligned)
// Guardrail Financial — P&L, Balance Sheet, Cash Flow

(function () {
  'use strict';

  // ── ACCOUNT CLASSIFICATION ──────────────────────────────────────────────────
  const ACCOUNT_CLASS = {
    // Income (credits)
    income:   { side: 'credit', statement: 'PL', class: 'Revenue' },
    transfer: { side: 'credit', statement: 'PL', class: 'Other Income' },
    // Expenses (debits)
    salary:    { side: 'debit', statement: 'PL', class: 'Cost of Goods/Services' },
    fuel:      { side: 'debit', statement: 'PL', class: 'Operating Expenses' },
    purchases: { side: 'debit', statement: 'PL', class: 'Cost of Goods/Services' },
    utilities: { side: 'debit', statement: 'PL', class: 'Operating Expenses' },
    telecoms:  { side: 'debit', statement: 'PL', class: 'Operating Expenses' },
    logistics: { side: 'debit', statement: 'PL', class: 'Operating Expenses' },
    rent:      { side: 'debit', statement: 'PL', class: 'Operating Expenses' },
    tax:       { side: 'debit', statement: 'PL', class: 'Tax Expense' },
    other:     { side: 'debit', statement: 'PL', class: 'Other Expenses' },
  };

  function fmtNGN(n) {
    return 'NGN ' + Number(n || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  // ── PROFIT & LOSS STATEMENT ──────────────────────────────────────────────────
  function computePL(transactions, periodLabel = 'Current Period') {
    const clean = transactions.filter(t => !t.is_flagged);
    const items = {};

    clean.forEach(t => {
      const cat = t.category || 'other';
      const cls = ACCOUNT_CLASS[cat];
      if (!cls || cls.statement !== 'PL') return;

      const section = cls.class;
      if (!items[section]) items[section] = 0;

      const credit = Number(t.credit) || 0;
      const debit = Number(t.debit) || 0;

      if (cls.side === 'credit') items[section] += credit;
      else items[section] -= debit;
    });

    const revenue = items['Revenue'] || 0;
    const otherIncome = items['Other Income'] || 0;
    const totalIncome = revenue + otherIncome;

    const cogs = items['Cost of Goods/Services'] || 0;
    const opex = items['Operating Expenses'] || 0;
    const taxExp = items['Tax Expense'] || 0;
    const otherExp = items['Other Expenses'] || 0;
    const totalExpenses = cogs + opex + taxExp + otherExp;

    const ebit = totalIncome - totalExpenses;
    const netProfit = ebit;

    return {
      periodLabel,
      revenue,
      otherIncome,
      totalIncome,
      cogs,
      grossProfit: revenue - cogs,
      opex,
      ebit,
      taxExp,
      netProfit,
      totalExpenses,
      line: {
        revenue: { label: 'Revenue from services', amount: revenue },
        otherIncome: { label: 'Other income', amount: otherIncome },
        cogs: { label: 'Cost of goods/services', amount: cogs },
        opex: { label: 'Operating expenses', amount: opex },
        taxExp: { label: 'Tax expense', amount: taxExp },
        otherExp: { label: 'Other expenses', amount: otherExp },
      },
    };
  }

  // ── BALANCE SHEET (simplified) ───────────────────────────────────────────────
  function computeBalanceSheet(transactions, periodLabel = 'As at') {
    const pl = computePL(transactions, '');
    const retained = pl.netProfit;
    const equity = retained;
    const balances = {};

    // Accumulate cash (sum of all transactions)
    let cash = 0;
    transactions.filter(t => !t.is_flagged).forEach(t => {
      cash += (Number(t.credit) || 0) - (Number(t.debit) || 0);
    });

    const assets = {
      cash: Math.max(0, cash),
      receivables: 0, // placeholder — would require AR aging
    };

    const liabilities = {
      payables: 0, // placeholder — would require AP aging
    };

    const assetTotal = Object.values(assets).reduce((s, v) => s + v, 0);
    const liabilitiesTotal = Object.values(liabilities).reduce((s, v) => s + v, 0);
    const equityTotal = equity + liabilitiesTotal - (assetTotal - liabilitiesTotal);

    return {
      periodLabel,
      assets,
      assetTotal,
      liabilities,
      liabilitiesTotal,
      equity: { retained },
      equityTotal,
      line: {
        cash: { label: 'Cash at bank', amount: assets.cash, section: 'assets' },
        receivables: { label: 'Receivables', amount: assets.receivables, section: 'assets' },
        payables: { label: 'Payables', amount: liabilities.payables, section: 'liabilities' },
        retained: { label: 'Retained earnings', amount: retained, section: 'equity' },
      },
    };
  }

  // ── CASH FLOW STATEMENT ──────────────────────────────────────────────────────
  function computeCashFlow(transactions, periodLabel = 'Current Period') {
    const clean = transactions.filter(t => !t.is_flagged);
    let operating = 0;
    let investing = 0;
    let financing = 0;

    clean.forEach(t => {
      const cat = t.category || 'other';
      const credit = Number(t.credit) || 0;
      const debit = Number(t.debit) || 0;
      const net = credit - debit;

      // Classify by category
      if (['income', 'salary', 'purchases', 'fuel', 'utilities', 'telecoms', 'rent', 'tax', 'other'].includes(cat)) {
        operating += net;
      } else if (cat === 'transfer') {
        // Transfer could be investing or financing — default to financing
        financing += net;
      }
    });

    const netChange = operating + investing + financing;
    let endingCash = 0;
    clean.forEach(t => {
      endingCash += (Number(t.credit) || 0) - (Number(t.debit) || 0);
    });

    return {
      periodLabel,
      operating,
      investing,
      financing,
      netChange,
      endingCash: Math.max(0, endingCash),
      sections: {
        operating: { label: 'Operating activities', amount: operating },
        investing: { label: 'Investing activities', amount: investing },
        financing: { label: 'Financing activities', amount: financing },
      },
    };
  }

  // ── RENDER FUNCTIONS ────────────────────────────────────────────────────────
  function renderPL(pl, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const renderLine = (label, amount) => {
      const amountStr = fmtNGN(amount);
      const amountClass = amount >= 0 ? 'text-emerald-600' : 'text-red-600';
      return `
        <tr class="border-b border-slate-200">
          <td class="px-4 py-2 text-slate-700">${label}</td>
          <td class="px-4 py-2 text-right font-mono font-bold ${amountClass}">${amountStr}</td>
        </tr>
      `;
    };

    const html = `
      <div class="space-y-6">
        <div class="text-center pb-4 border-b border-slate-300">
          <h2 class="text-lg font-bold text-slate-900">PROFIT & LOSS STATEMENT</h2>
          <p class="text-sm text-slate-600">${pl.periodLabel}</p>
        </div>

        <table class="w-full text-sm">
          <tbody>
            ${renderLine('Revenue from services', pl.revenue)}
            ${renderLine('Other income', pl.otherIncome)}
            <tr class="bg-slate-100 font-bold border-b-2 border-slate-400">
              <td class="px-4 py-2">Total Income</td>
              <td class="px-4 py-2 text-right font-mono">${fmtNGN(pl.totalIncome)}</td>
            </tr>

            <tr class="h-2"><td colspan="2"></td></tr>

            ${renderLine('Cost of goods/services', pl.cogs)}
            <tr class="bg-emerald-50 font-bold">
              <td class="px-4 py-2">Gross Profit</td>
              <td class="px-4 py-2 text-right font-mono text-emerald-600">${fmtNGN(pl.grossProfit)}</td>
            </tr>

            <tr class="h-2"><td colspan="2"></td></tr>

            ${renderLine('Operating expenses', pl.opex)}
            <tr class="bg-slate-100 font-bold border-b-2 border-slate-400">
              <td class="px-4 py-2">EBIT (Operating Profit)</td>
              <td class="px-4 py-2 text-right font-mono">${fmtNGN(pl.ebit)}</td>
            </tr>

            <tr class="h-2"><td colspan="2"></td></tr>

            ${renderLine('Tax expense', pl.taxExp)}
            ${renderLine('Other expenses', pl.otherExp)}
            <tr class="bg-emerald-100 font-bold text-lg border-t-2 border-b-2 border-emerald-400">
              <td class="px-4 py-2">NET PROFIT</td>
              <td class="px-4 py-2 text-right font-mono text-emerald-700">${fmtNGN(pl.netProfit)}</td>
            </tr>
          </tbody>
        </table>

        <div class="text-xs text-slate-500 text-center mt-4 pt-4 border-t border-slate-200">
          Flagged transactions excluded. Accrual basis. For planning only — not a legal filing.
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  function renderBalanceSheet(bs, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const renderLine = (label, amount, indent = false) => `
      <tr class="border-b border-slate-200 ${indent ? 'bg-slate-50' : ''}">
        <td class="px-4 py-2 ${indent ? 'pl-8 text-slate-600' : 'text-slate-900 font-500'}">${label}</td>
        <td class="px-4 py-2 text-right font-mono text-slate-700">${fmtNGN(amount)}</td>
      </tr>
    `;

    const html = `
      <div class="space-y-6">
        <div class="text-center pb-4 border-b border-slate-300">
          <h2 class="text-lg font-bold text-slate-900">BALANCE SHEET</h2>
          <p class="text-sm text-slate-600">${bs.periodLabel}</p>
        </div>

        <table class="w-full text-sm">
          <tbody>
            <tr class="bg-blue-100 font-bold text-blue-900">
              <td class="px-4 py-2">ASSETS</td>
              <td></td>
            </tr>
            ${renderLine('Cash at bank', bs.assets.cash, true)}
            ${renderLine('Receivables', bs.assets.receivables, true)}
            <tr class="bg-blue-50 font-bold border-b-2 border-blue-400">
              <td class="px-4 py-2">Total Assets</td>
              <td class="px-4 py-2 text-right font-mono text-blue-700">${fmtNGN(bs.assetTotal)}</td>
            </tr>

            <tr class="h-3"><td colspan="2"></td></tr>

            <tr class="bg-amber-100 font-bold text-amber-900">
              <td class="px-4 py-2">LIABILITIES</td>
              <td></td>
            </tr>
            ${renderLine('Payables', bs.liabilities.payables, true)}
            <tr class="bg-amber-50 font-bold border-b-2 border-amber-400">
              <td class="px-4 py-2">Total Liabilities</td>
              <td class="px-4 py-2 text-right font-mono text-amber-700">${fmtNGN(bs.liabilitiesTotal)}</td>
            </tr>

            <tr class="h-3"><td colspan="2"></td></tr>

            <tr class="bg-emerald-100 font-bold text-emerald-900">
              <td class="px-4 py-2">EQUITY</td>
              <td></td>
            </tr>
            ${renderLine('Retained earnings', bs.equity.retained, true)}
            <tr class="bg-emerald-50 font-bold border-b-2 border-b-2 border-emerald-400">
              <td class="px-4 py-2">Total Equity</td>
              <td class="px-4 py-2 text-right font-mono text-emerald-700">${fmtNGN(bs.equityTotal)}</td>
            </tr>

            <tr class="h-2"><td colspan="2"></td></tr>

            <tr class="font-bold text-slate-900 border-t-2 border-slate-400">
              <td class="px-4 py-2">TOTAL LIAB. & EQUITY</td>
              <td class="px-4 py-2 text-right font-mono">${fmtNGN(bs.liabilitiesTotal + bs.equityTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div class="text-xs text-slate-500 text-center mt-4 pt-4 border-t border-slate-200">
          Simplified balance sheet. Receivables & Payables are estimated. For planning only.
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  function renderCashFlow(cf, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const renderSection = (label, amount) => {
      const amountStr = fmtNGN(amount);
      const amountClass = amount >= 0 ? 'text-emerald-600' : 'text-red-600';
      return `
        <tr class="border-b border-slate-200 bg-slate-50">
          <td class="px-4 py-2 font-500 text-slate-700">${label}</td>
          <td class="px-4 py-2 text-right font-mono font-bold ${amountClass}">${amountStr}</td>
        </tr>
      `;
    };

    const html = `
      <div class="space-y-6">
        <div class="text-center pb-4 border-b border-slate-300">
          <h2 class="text-lg font-bold text-slate-900">CASH FLOW STATEMENT</h2>
          <p class="text-sm text-slate-600">${cf.periodLabel}</p>
        </div>

        <table class="w-full text-sm">
          <tbody>
            ${renderSection('Cash from operating activities', cf.operating)}
            ${renderSection('Cash from investing activities', cf.investing)}
            ${renderSection('Cash from financing activities', cf.financing)}
            <tr class="bg-emerald-100 font-bold text-lg border-t-2 border-b-2 border-emerald-400">
              <td class="px-4 py-2">Net change in cash</td>
              <td class="px-4 py-2 text-right font-mono text-emerald-700">${fmtNGN(cf.netChange)}</td>
            </tr>
            <tr class="border-b border-slate-200">
              <td class="px-4 py-2 text-slate-600">Ending cash balance</td>
              <td class="px-4 py-2 text-right font-mono font-bold">${fmtNGN(cf.endingCash)}</td>
            </tr>
          </tbody>
        </table>

        <div class="text-xs text-slate-500 text-center mt-4 pt-4 border-t border-slate-200">
          Simplified indirect method. Investing/financing categorization based on transaction type.
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ── EXPORTS ──────────────────────────────────────────────────────────────────
  window.GuardrailStatements = {
    computePL,
    computeBalanceSheet,
    computeCashFlow,
    renderPL,
    renderBalanceSheet,
    renderCashFlow,
    fmtNGN,
  };
})();
