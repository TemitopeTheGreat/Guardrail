// js/tax-nigeria.js — Nigerian Tax Computation Engine
// Guardrail Financial — for planning estimates only.
// All rates cited from specific legislation below.
// NOT a substitute for advice from a FIRS-registered chartered accountant.

(function () {
  'use strict';

  // ── VAT ─────────────────────────────────────────────────────────────────────
  // Value Added Tax Act (VATA) Cap V1 LFN 2004 as amended
  const VAT_RATE = 0.075; // Finance Act 2019, effective 01 Feb 2020 (FIRS Circular 2020/01)

  const VAT_OUTPUT_CATS = new Set(['income', 'transfer']); // taxable supplies
  const VAT_INPUT_CATS  = new Set(['fuel', 'purchases', 'utilities', 'telecoms', 'logistics']); // input-eligible
  const VAT_EXEMPT_CATS = new Set(['salary', 'rent', 'tax']); // exempt

  // ── CIT ─────────────────────────────────────────────────────────────────────
  // Companies Income Tax Act (CITA) Cap C21 LFN 2004, Finance Act 2023 — s.40
  const CIT_THRESHOLDS = [
    { label: 'Small',  maxRevenue: 25_000_000,  rate: 0.00 }, // 0%  for turnover < NGN 25m
    { label: 'Medium', maxRevenue: 100_000_000, rate: 0.20 }, // 20% for NGN 25m–100m
    { label: 'Large',  maxRevenue: Infinity,    rate: 0.30 }, // 30% above NGN 100m
  ];
  // Minimum CIT: 0.5% of gross turnover — CITA s.33 as amended by Finance Act 2022
  const CIT_MINIMUM_RATE = 0.005;

  // ── WHT ─────────────────────────────────────────────────────────────────────
  // Withholding Tax — CITA s.78–80, PITA s.69, Finance Act 2023
  const WHT_RATES = {
    rent:      0.10,  // 10% on rent payments
    salary:    0.00,  // Handled via PAYE — not WHT (PITA s.81)
    fuel:      0.05,  // 5% on petroleum product purchases
    purchases: 0.05,  // 5% on goods (S.78 CITA)
    utilities: 0.05,  // 5% on utility services
    telecoms:  0.05,  // 5% on telecom services
    logistics: 0.05,  // 5% on logistics/haulage
    tax:       0.00,  // Tax payments — not subject to WHT
    income:    0.00,  // Receipts — WHT not applicable
    transfer:  0.00,  // Receipts — WHT not applicable
    other:     0.05,  // 5% default for unclassified payments (S.78 CITA)
  };

  // ── PIT ─────────────────────────────────────────────────────────────────────
  // Personal Income Tax Act (PITA) Cap P8 LFN 2004, Finance Act 2023
  // Progressive bands applied to taxable income (after CRA)
  const PIT_BANDS = [
    { limit: 300_000,   rate: 0.07 }, // 7%  on first NGN 300k
    { limit: 300_000,   rate: 0.11 }, // 11% on next  NGN 300k
    { limit: 500_000,   rate: 0.15 }, // 15% on next  NGN 500k
    { limit: 500_000,   rate: 0.19 }, // 19% on next  NGN 500k
    { limit: 1_600_000, rate: 0.21 }, // 21% on next  NGN 1.6m
    { limit: Infinity,  rate: 0.24 }, // 24% on balance
  ];
  // Consolidated Relief Allowance — PITA s.33
  const CRA_FLAT         = 200_000; // NGN 200,000 flat
  const CRA_INCOME_RATE  = 0.20;    // + 20% of gross income
  const CRA_MIN_PCT      = 0.01;    // Higher of 200k OR 1% of gross income
  // Minimum tax: 1% of gross income — PITA s.37
  const PIT_MIN_RATE     = 0.01;

  // ── TAX CALENDAR ────────────────────────────────────────────────────────────
  const TAX_CALENDAR = [
    { deadline: '21st of every month',  obligation: 'VAT return and payment',              law: 'VATA s.15',    authority: 'FIRS' },
    { deadline: '21st of every month',  obligation: 'WHT remittance',                       law: 'CITA s.81',    authority: 'FIRS' },
    { deadline: '31 January annually',  obligation: 'Annual PAYE return',                   law: 'PITA s.81',    authority: 'State IRS' },
    { deadline: '31 March annually',    obligation: 'Annual CIT self-assessment return',    law: 'CITA s.55',    authority: 'FIRS' },
    { deadline: '31 March annually',    obligation: 'Annual PIT return (self-employed)',    law: 'PITA s.41',    authority: 'State IRS' },
    { deadline: '30 June annually',     obligation: 'CIT first instalment payment',         law: 'CITA s.77',    authority: 'FIRS' },
    { deadline: '31 July annually',     obligation: 'Mid-year PAYE reconciliation',         law: 'PITA s.82',    authority: 'State IRS' },
    { deadline: '31 December annually', obligation: 'CIT final instalment payment',         law: 'CITA s.77',    authority: 'FIRS' },
  ];

  // ── FORMATTERS ───────────────────────────────────────────────────────────────
  function fmtNGN(n) {
    return 'NGN ' + Number(n || 0).toLocaleString('en-NG', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }
  function pct(r) { return (r * 100).toFixed(1) + '%'; }

  // ── COMPUTE VAT ──────────────────────────────────────────────────────────────
  function computeVAT(transactions) {
    const clean = transactions.filter(t => !t.is_flagged);

    const taxableCredits = clean.filter(t =>
      Number(t.credit) > 0 && VAT_OUTPUT_CATS.has(t.category || ''));
    const taxableSales = taxableCredits.reduce((s, t) => s + Number(t.credit), 0);
    const outputVAT    = taxableSales * VAT_RATE;

    const eligibleDebits = clean.filter(t =>
      Number(t.debit) > 0 && VAT_INPUT_CATS.has(t.category || ''));
    const eligibleExp = eligibleDebits.reduce((s, t) => s + Number(t.debit), 0);
    const inputVAT    = eligibleExp * VAT_RATE;

    const netVATPayable = outputVAT - inputVAT;

    const now = new Date();
    const periodLabel     = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const nextMonth       = new Date(now.getFullYear(), now.getMonth() + 1, 21);
    const filingDeadline  = nextMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    return { taxableSales, outputVAT, eligibleExp, inputVAT, netVATPayable,
             isCredit: netVATPayable < 0, periodLabel, filingDeadline, vatRate: VAT_RATE };
  }

  // ── COMPUTE CIT ──────────────────────────────────────────────────────────────
  function computeCIT(totalRevenue, totalExpenses) {
    const taxableProfit = Math.max(0, totalRevenue - totalExpenses);
    const bracket = CIT_THRESHOLDS.find(t => totalRevenue <= t.maxRevenue) || CIT_THRESHOLDS[2];
    const normalTax   = taxableProfit  * bracket.rate;
    const minimumTax  = totalRevenue   * CIT_MINIMUM_RATE;
    const citLiability = Math.max(normalTax, minimumTax);

    return { totalRevenue, totalExpenses, taxableProfit,
             companySize: bracket.label, rateApplied: bracket.rate,
             normalTax, minimumTax, citLiability,
             minimumTaxApplied: minimumTax > normalTax };
  }

  // ── COMPUTE WHT ──────────────────────────────────────────────────────────────
  function computeWHT(transactions) {
    const clean = transactions.filter(t => !t.is_flagged && Number(t.debit) > 0);
    const byCat = {};
    clean.forEach(t => {
      const cat  = t.category || 'other';
      const rate = WHT_RATES[cat] ?? WHT_RATES.other;
      if (rate === 0) return;
      if (!byCat[cat]) byCat[cat] = { amount: 0, wht: 0, rate, count: 0 };
      byCat[cat].amount += Number(t.debit);
      byCat[cat].wht   += Number(t.debit) * rate;
      byCat[cat].count++;
    });
    const totalWHT = Object.values(byCat).reduce((s, v) => s + v.wht, 0);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(21);
    const remittanceDeadline = nextMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return { byCat, totalWHT, remittanceDeadline };
  }

  // ── COMPUTE PIT ──────────────────────────────────────────────────────────────
  function computePIT(annualIncome) {
    const gross = Math.max(0, annualIncome);
    const craFlat    = Math.max(CRA_FLAT, gross * CRA_MIN_PCT);
    const craPercent = gross * CRA_INCOME_RATE;
    const totalCRA   = craFlat + craPercent;
    const taxable    = Math.max(0, gross - totalCRA);

    const bands = [];
    let remaining = taxable;
    let computed  = 0;
    let cumulative = 0;
    for (const b of PIT_BANDS) {
      if (remaining <= 0) break;
      const inBand  = b.limit === Infinity ? remaining : Math.min(remaining, b.limit);
      const taxOnBand = inBand * b.rate;
      computed += taxOnBand;
      bands.push({ rate: b.rate, inBand, taxOnBand,
                   from: cumulative, to: cumulative + inBand });
      cumulative += inBand;
      remaining  -= inBand;
    }

    const minimumTax  = gross * PIT_MIN_RATE;
    const pitLiability = Math.max(computed, minimumTax);
    const effectiveRate = gross > 0 ? pitLiability / gross : 0;
    const monthlyPAYE  = pitLiability / 12;

    return { gross, craFlat, craPercent, totalCRA, taxable, bands,
             computed, minimumTax, pitLiability, effectiveRate, monthlyPAYE,
             minimumTaxApplied: minimumTax > computed };
  }

  // ── DISCLAIMER ───────────────────────────────────────────────────────────────
  const DISCLAIMER = `Tax estimates are based on uploaded transaction data and are for
financial planning purposes only. Guardrail Financial is not a licensed tax advisor.
Always engage a FIRS-registered chartered accountant for official tax filings.`;

  // ── EXPORTS ──────────────────────────────────────────────────────────────────
  window.GuardrailTax = {
    VAT_RATE, CIT_THRESHOLDS, CIT_MINIMUM_RATE, WHT_RATES, PIT_BANDS,
    TAX_CALENDAR, DISCLAIMER,
    computeVAT, computeCIT, computeWHT, computePIT,
    fmtNGN, pct,
  };
})();
