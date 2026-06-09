if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
// pdf-parse is required lazily inside parseFile to avoid crashing the module on cold start

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── DATE PARSING ──────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const s = str.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : s;
  }

  // DD/MM/YYYY or MM/DD/YYYY — assume DD/MM/YYYY (Nigerian context)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [a, b, year] = s.split('/');
    const day = a.padStart(2, '0');
    const month = b.padStart(2, '0');
    const d = new Date(`${year}-${month}-${day}`);
    return isNaN(d) ? null : `${year}-${month}-${day}`;
  }

  // D/M/YY or DD/MM/YY
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) {
    const [a, b, yy] = s.split('/');
    const day = a.padStart(2, '0');
    const month = b.padStart(2, '0');
    const year = parseInt(yy) >= 50 ? `19${yy}` : `20${yy}`;
    const d = new Date(`${year}-${month}-${day}`);
    return isNaN(d) ? null : `${year}-${month}-${day}`;
  }

  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [a, b, year] = s.split('-');
    const day = a.padStart(2, '0');
    const month = b.padStart(2, '0');
    const d = new Date(`${year}-${month}-${day}`);
    return isNaN(d) ? null : `${year}-${month}-${day}`;
  }

  // Last resort
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  return null;
}

// ── AMOUNT CLEANING ───────────────────────────────────────────────────────────
// cleanAmount: used internally where sign must be preserved (makeRowSingle, PDF tier).
function cleanAmount(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (!s) return null;
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
  s = s.replace(/^[A-Za-z₦$£€]+\s*/, '').replace(/,/g, '').replace(/\s/g, '');
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '.' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? NaN : Math.round(num * 100) / 100;
}

// parseAmount: applied to every debit/credit cell read from a file.
// Always returns a number (0 for empty/unparseable). Strips ₦, NGN, commas,
// spaces, and any non-numeric character so trailing commas never corrupt the value.
function parseAmount(val) {
  if (!val && val !== 0) return 0;
  const cleaned = String(val)
    .replace(/[₦NGN,\s]/gi, '')
    .replace(/[^0-9.]/g, '')
    .trim();
  return parseFloat(cleaned) || 0;
}

// ── CLASSIFICATION ENGINE ─────────────────────────────────────────────────────
function classifyTransaction(description, debit, credit) {
  const d = (description || '').toLowerCase().trim();
  const isIncome  = credit > 0 && (debit  === 0 || debit  == null);
  const isExpense = debit  > 0 && (credit === 0 || credit == null);

  const revenueKeywords  = ['payment received','client payment','retainer','invoice payment','transfer from','trf frm','nip credit','inflow','sales','revenue','freelance','consulting fee','service fee','commission','rental income','contract payment','settlement','refund received','rebate','opening balance','deposit from','proceeds'];
  const salaryKeywords   = ['salary','payroll','wages','staff payment','employee','net pay','monthly pay','paye','allowance','bonus payment','gratuity','pension','nsitf','nhf contribution'];
  const fuelKeywords     = ['fuel','diesel','petrol','generator','filling station','conoil','oando','mobil','nnpc','ardova','gas station','lubricant','engine oil'];
  const rentKeywords     = ['rent','lease','tenancy','office space','warehouse','shop rent','annual rent','property payment','accommodation'];
  const utilityKeywords  = ['nepa','phcn','ekedc','ibedc','aedc','electricity','water board','lawma','waste','utility','ikedc','kedco'];
  const telecomKeywords  = ['mtn','airtel','glo','9mobile','etisalat','spectranet','smile','ipnx','swift','airtime','data subscription','internet','broadband','recharge','telco'];
  const taxKeywords      = ['vat','firs','tax','withholding','wht','cit','company income','paye remit','lirs','state revenue','customs','duty','stamp duty','levies','irs payment'];
  const bankKeywords     = ['bank charge','commission on turnover','cot','sms alert','maintenance fee','card fee','transfer fee','atm fee','annual charge','overdraft interest','interest charge','vat on cot','e-banking'];
  const purchaseKeywords = ['purchase','bought','market','supplies','inventory','stock','raw material','goods','pos purchase','online purchase','order','procurement','vendor payment','supplier'];
  const logisticsKeywords= ['logistics','transport','delivery','courier','dispatch','shipping','freight','uber','bolt','taxify','bus fare','vehicle','maintenance vehicle','tyre','spare part'];
  const loanKeywords     = ['loan','repayment','installment','mortgage','overdraft','credit facility','debt','borrowed','borrowing'];
  const assetKeywords    = ['equipment','machinery','computer','laptop','phone','furniture','air conditioner','ac unit','generator purchase','vehicle purchase','car','property','land','building','asset'];

  const match = (keywords) => keywords.some(kw => d.includes(kw));

  if (isExpense && match(assetKeywords) && debit >= 50000) {
    return { category: 'asset', financialType: 'asset' };
  }
  if (match(loanKeywords)) {
    return { category: 'liability', financialType: isIncome ? 'liability_receipt' : 'liability_payment' };
  }
  if (isIncome) {
    if (match(revenueKeywords)) return { category: 'income', financialType: 'revenue' };
    return { category: 'income', financialType: 'revenue' };
  }
  if (isExpense) {
    if (match(salaryKeywords))    return { category: 'salary',       financialType: 'expense' };
    if (match(fuelKeywords))      return { category: 'fuel',         financialType: 'expense' };
    if (match(rentKeywords))      return { category: 'rent',         financialType: 'expense' };
    if (match(utilityKeywords))   return { category: 'utilities',    financialType: 'expense' };
    if (match(telecomKeywords))   return { category: 'telecoms',     financialType: 'expense' };
    if (match(taxKeywords))       return { category: 'tax',          financialType: 'expense' };
    if (match(bankKeywords))      return { category: 'bank_charges', financialType: 'expense' };
    if (match(purchaseKeywords))  return { category: 'purchases',    financialType: 'expense' };
    if (match(logisticsKeywords)) return { category: 'logistics',    financialType: 'expense' };
    return { category: 'other', financialType: 'expense' };
  }
  return { category: 'other', financialType: 'other' };
}

// ── TIERED FILE PARSING ENGINE ────────────────────────────────────────────────

// Reused regexes for PDF tier
const PDF_DATE_RE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{4}|\d{2})|\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/;
const PDF_AMTS_RE = /([\d,]+(?:\.\d{1,2})?)/g;

// Parse delimited text (CSV/TSV/TXT) into { headers, rows }.
// Headers keep their original casing; row keys match headers exactly.
function csvToRows(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(l => l.trim());
  if (hi === -1) return { headers: [], rows: [] };

  const sample = lines[hi];
  const delim = (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ',';

  function split(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (c === delim && !q) {
        out.push(cur.trim()); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = split(lines[hi]);
  const rows = [];
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = split(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = cells[j] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// Parse XLSX/XLS buffer into { headers, rows }.
function xlsxToRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, header: 1 });

  const hi = raw.findIndex(r => r.some(c => String(c).trim()));
  if (hi === -1) return { headers: [], rows: [] };

  const headers = raw[hi].map(c => String(c).trim());
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const cells = raw[i];
    if (!cells.some(c => String(c).trim())) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = String(cells[j] ?? '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// Row builders — all accept lowercase-keyed rows (Tier 1) or original-cased rows (Tier 2/3).
function makeRow(row, dk, desck, dbk, crk) {
  return {
    date:        String(row[dk]    ?? '').trim(),
    description: String(row[desck] ?? '').trim(),
    debit:       String(row[dbk]   ?? '').trim(),
    credit:      String(row[crk]   ?? '').trim(),
  };
}

// For UBA/Wema: amount + Dr/Cr type column.
function makeRowTyped(row, dk, desck, amtk, typek) {
  const raw  = String(row[amtk]  ?? '').trim();
  const type = String(row[typek] ?? '').trim().toUpperCase();
  const isDr = type === 'DR' || type === 'D' || type === 'DEBIT';
  return {
    date:        String(row[dk]    ?? '').trim(),
    description: String(row[desck] ?? '').trim(),
    debit:       isDr ? raw : '',
    credit:      isDr ? '' : raw,
  };
}

// For single signed amount column: negative = debit, positive = credit.
function makeRowSingle(row, dk, desck, amtk) {
  const raw = String(row[amtk] ?? '').trim();
  const num = cleanAmount(raw);
  return {
    date:        String(row[dk]    ?? '').trim(),
    description: String(row[desck] ?? '').trim(),
    debit:       (num !== null && !isNaN(num) && num < 0) ? String(Math.abs(num)) : '',
    credit:      (num !== null && !isNaN(num) && num > 0) ? String(num)           : '',
  };
}

function nonEmpty(rows) {
  return rows.filter(r => r.date || r.description || r.debit || r.credit);
}

// ── TIER 1: NIGERIAN BANK TEMPLATES ──────────────────────────────────────────
// `must` and all map keys are lowercase — rows are normalised before matching.
const BANK_TEMPLATES = [
  {
    bank: 'GTBank',
    must: ['trans. date', 'debit', 'credit', 'remarks'],
    map:  r => makeRow(r, 'trans. date', 'remarks', 'debit', 'credit'),
  },
  {
    bank: 'Access Bank',
    must: ['date', 'narration', 'debit', 'credit'],
    map:  r => makeRow(r, 'date', 'narration', 'debit', 'credit'),
  },
  {
    bank: 'Zenith Bank',
    must: ['date', 'remarks', 'debit', 'credit'],
    map:  r => makeRow(r, 'date', 'remarks', 'debit', 'credit'),
  },
  {
    bank: 'UBA',
    must: ['date', 'beneficiary', 'amount', 'dr/cr'],
    map:  r => makeRowTyped(r, 'date', 'beneficiary', 'amount', 'dr/cr'),
  },
  {
    bank: 'First Bank',
    must: ['date', 'description', 'withdrawal', 'deposit'],
    map:  r => makeRow(r, 'date', 'description', 'withdrawal', 'deposit'),
  },
  {
    bank: 'Stanbic IBTC',
    must: ['posting date', 'description', 'debit', 'credit'],
    map:  r => makeRow(r, 'posting date', 'description', 'debit', 'credit'),
  },
  {
    bank: 'Fidelity Bank',
    must: ['tran date', 'tran details', 'debit amt', 'credit amt'],
    map:  r => makeRow(r, 'tran date', 'tran details', 'debit amt', 'credit amt'),
  },
  {
    bank: 'Wema/ALAT',
    must: ['date', 'narration', 'amount', 'type'],
    map:  r => makeRowTyped(r, 'date', 'narration', 'amount', 'type'),
  },
];

function tryBankTemplate(headers, rows) {
  const lo = headers.map(h => h.toLowerCase().trim());

  for (const tmpl of BANK_TEMPLATES) {
    if (!tmpl.must.every(m => lo.includes(m))) continue;

    // Normalise row keys to lowercase so map functions work regardless of file casing
    const normRows = rows.map(row => {
      const n = {};
      Object.entries(row).forEach(([k, v]) => { n[k.toLowerCase().trim()] = v; });
      return n;
    });

    const result = nonEmpty(normRows.map(tmpl.map));
    if (result.length) return { bank: tmpl.bank, rows: result };
  }
  return null;
}

// ── TIER 2 + 3: AUTO COLUMN DETECTION ────────────────────────────────────────
const CANDIDATES = {
  date:   ['trans. date', 'tran date', 'posting date', 'transaction date', 'value date', 'trans date', 'date'],
  desc:   ['tran details', 'transaction details', 'narration', 'description', 'remarks', 'particulars', 'details', 'beneficiary', 'reference'],
  debit:  ['debit amt', 'debit amount', 'amount dr', 'withdrawals', 'withdrawal', 'money out', 'charge', 'debit', 'dr'],
  credit: ['credit amt', 'credit amount', 'amount cr', 'deposits', 'deposit', 'lodgement', 'money in', 'credit', 'cr'],
  amount: ['transaction amount', 'amount', 'value'],
  type:   ['dr/cr', 'cr/dr', 'transaction type', 'type'],
};

function pickCol(lo, orig, list) {
  for (const c of list) {
    const i = lo.indexOf(c);
    if (i !== -1) return orig[i];
  }
  // Partial-match fallback
  for (const c of list) {
    const i = lo.findIndex(h => h.includes(c));
    if (i !== -1) return orig[i];
  }
  return null;
}

function tryAutoDetect(headers, rows) {
  const lo    = headers.map(h => h.toLowerCase().trim());
  const dateK = pickCol(lo, headers, CANDIDATES.date);
  const descK = pickCol(lo, headers, CANDIDATES.desc);
  if (!dateK || !descK) return null;

  const dbK = pickCol(lo, headers, CANDIDATES.debit);
  const crK = pickCol(lo, headers, CANDIDATES.credit);

  // Tier 2: explicit debit + credit columns found
  if (dbK && crK) {
    return nonEmpty(rows.map(r => makeRow(r, dateK, descK, dbK, crK)));
  }

  const amtK  = pickCol(lo, headers, CANDIDATES.amount);
  const typeK = pickCol(lo, headers, CANDIDATES.type);

  // Tier 3a: single amount + Dr/Cr type indicator
  if (amtK && typeK) {
    return nonEmpty(rows.map(r => makeRowTyped(r, dateK, descK, amtK, typeK)));
  }

  // Tier 3b: single signed amount column
  if (amtK) {
    return nonEmpty(rows.map(r => makeRowSingle(r, dateK, descK, amtK)));
  }

  return null;
}

// ── TIER 4: PDF REGEX EXTRACTION ─────────────────────────────────────────────
function extractFromPdfText(text) {
  const results = [];

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    const dm = t.match(PDF_DATE_RE);
    if (!dm) continue;

    const amts = [];
    let m;
    PDF_AMTS_RE.lastIndex = 0;
    while ((m = PDF_AMTS_RE.exec(t)) !== null) {
      const n = cleanAmount(m[1]);
      if (n !== null && n > 0) amts.push(m[1]);
    }
    if (!amts.length) continue;

    const desc = t
      .replace(PDF_DATE_RE, '')
      .replace(PDF_AMTS_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!desc) continue;

    const up   = t.toUpperCase();
    const isDr = /\bDR\b/.test(up) || /\bDEBIT\b/.test(up)  || /\bWITHDRAW/.test(up);
    const isCr = /\bCR\b/.test(up) || /\bCREDIT\b/.test(up) || /\bDEPOSIT\b/.test(up);
    // Last amount is usually running balance; use second-to-last as the transaction amount
    const txnAmt = amts.length >= 2 ? amts[amts.length - 2] : amts[0];

    results.push({
      date:        dm[1],
      description: desc,
      debit:       (isDr && !isCr) ? txnAmt : '',
      credit:      (!isDr || isCr) ? txnAmt : '',
    });
  }

  return results;
}

// ── TIER 5: FAILURE MESSAGE ───────────────────────────────────────────────────
const UNREADABLE = 'We could not read this file. Please export your statement as CSV from your banking app and try again.';

function unreadableError() {
  const err = new Error(UNREADABLE);
  err.status = 400;
  return err;
}

// ── PARSE ENTRY POINT ─────────────────────────────────────────────────────────
async function parseFile(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // PDF path — Tier 4 regex extraction
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const rows = extractFromPdfText(data.text);
    if (!rows.length) throw unreadableError();
    return rows;
  }

  // Structured file: CSV, TSV, TXT, XLSX, XLS
  const { headers, rows } = (ext === 'xlsx' || ext === 'xls')
    ? xlsxToRows(buffer)
    : csvToRows(buffer.toString('utf8'));

  if (!headers.length || !rows.length) throw unreadableError();

  const tier1 = tryBankTemplate(headers, rows);
  if (tier1 && tier1.rows.length) return tier1.rows;

  const tier23 = tryAutoDetect(headers, rows);
  if (tier23 && tier23.length) return tier23;

  throw unreadableError();
}

// ── CORS ──────────────────────────────────────────────────────────────────────
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Health check — GET /api/audit confirms env vars are wired up
  if (req.method === 'GET') {
    return res.status(200).json({
      ok:          true,
      supabaseUrl: !!process.env.SUPABASE_URL,
      serviceKey:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // audit_id declared here so the catch block can mark it failed
  let audit_id;

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    const jwt = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    const userId = user.id;

    const body = req.body || {};
    audit_id        = body.audit_id;
    const file_path = body.file_path;
    if (!file_path || !audit_id) {
      return res.status(400).json({ error: 'file_path and audit_id are required' });
    }
    if (!file_path.startsWith(userId + '/')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // ── File processing ───────────────────────────────────────────────────────
    // STEP 1: Download the raw file from Supabase Storage
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
      .from('raw-uploads')
      .download(file_path);
    if (downloadErr) throw new Error(`Storage download failed: ${downloadErr.message}`);
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const fileName = file_path.split('/').pop();

    // STEP 2: Parse file — Tier 1 bank templates → Tier 2/3 auto-detect → Tier 4 PDF → 400
    const rawRows = await parseFile(buffer, fileName);
    console.log(`[audit] Parsed ${rawRows.length} rows from ${fileName}`);

    // Normalise rows into working objects
    let rows = rawRows.map((raw, i) => ({
      raw,
      row_number: i + 1,
      is_flagged: false,
      flag_reason: null,
      is_duplicate: false,
      txn_date: null,
      debit: null,
      credit: null,
      category: 'other',
    }));

    // STEP 3: Detect duplicates
    const seen = new Map();
    let duplicateCount = 0;
    rows = rows.map(row => {
      const { raw } = row;
      const key = [
        (raw.date || '').toLowerCase(),
        (raw.description || '').toLowerCase(),
        (raw.debit || ''),
        (raw.credit || ''),
      ].join('||');

      if (seen.has(key)) {
        duplicateCount++;
        return { ...row, is_duplicate: true, is_flagged: true, flag_reason: 'duplicate' };
      }
      seen.set(key, true);
      return row;
    });

    // STEP 4: Standardise dates (skip duplicates)
    rows = rows.map(row => {
      if (row.is_duplicate) return row;
      const parsed = parseDate(row.raw.date);
      if (!parsed) {
        return { ...row, is_flagged: true, flag_reason: 'invalid_date' };
      }
      return { ...row, txn_date: parsed };
    });

    // STEP 5: Validate amounts (skip duplicates)
    // parseAmount always returns a number; 0 means empty/missing.
    rows = rows.map(row => {
      if (row.is_duplicate) return row;
      const debit  = parseAmount(row.raw.debit);
      const credit = parseAmount(row.raw.credit);

      if (debit === 0 && credit === 0) {
        return { ...row, is_flagged: true, flag_reason: row.flag_reason || 'missing_amount' };
      }
      return {
        ...row,
        debit:  debit  || null,
        credit: credit || null,
      };
    });

    // STEP 6: Balance check on clean rows only
    const cleanRows = rows.filter(r => !r.is_flagged);
    let totalDebits = 0;
    let totalCredits = 0;
    cleanRows.forEach(r => {
      if (r.debit)  totalDebits  += r.debit;
      if (r.credit) totalCredits += r.credit;
    });
    totalDebits  = Math.round(totalDebits  * 100) / 100;
    totalCredits = Math.round(totalCredits * 100) / 100;
    const balanceValid = Math.abs(totalDebits - totalCredits) < 0.01;

    // STEP 7: Classify transactions
    rows = rows.map(row => {
      const { category, financialType } = classifyTransaction(
        row.raw.description,
        row.debit  ?? 0,
        row.credit ?? 0,
      );
      return { ...row, category, financial_type: financialType };
    });

    // STEP 8: Audit score
    const invalidDateCount   = rows.filter(r => r.flag_reason === 'invalid_date').length;
    const invalidAmountCount = rows.filter(r => r.flag_reason === 'invalid_amount' || r.flag_reason === 'missing_amount').length;
    const errorCount         = rows.filter(r => r.is_flagged && !r.is_duplicate).length;
    const totalRows          = rows.filter(r => !r.is_duplicate).length;

    let score = 100;
    score -= Math.min(duplicateCount   * 5,  30);
    score -= Math.min(invalidDateCount * 10, 20);
    score -= Math.min(invalidAmountCount * 10, 20);
    if (!balanceValid) score -= 20;
    score = Math.max(0, Math.floor(score));

    // STEP 9: Persist to Supabase
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('account_type')
      .eq('id', userId)
      .single();

    const { error: auditErr } = await supabaseAdmin.from('audits').insert({
      id:              audit_id,
      user_id:         userId,
      file_name:       fileName,
      file_path,
      status:          'complete',
      audit_score:     score,
      total_rows:      totalRows,
      error_count:     errorCount,
      duplicate_count: duplicateCount,
      balance_valid:   balanceValid,
      account_type:    profile?.account_type || 'individual',
    });
    if (auditErr) throw new Error(`Audit insert failed: ${auditErr.message}`);

    // Batch insert transactions in groups of 100
    const txnRows = rows.map(r => ({
      audit_id,
      user_id:        userId,
      txn_date:       r.txn_date || null,
      description:    r.raw.description || '',
      debit:          r.debit  ?? null,
      credit:         r.credit ?? null,
      category:       r.category,
      is_flagged:     r.is_flagged,
      flag_reason:    r.flag_reason || null,
      row_number:     r.row_number,
    }));

    const BATCH = 100;
    let insertErrors = 0;
    for (let i = 0; i < txnRows.length; i += BATCH) {
      const batch = txnRows.slice(i, i + BATCH);
      console.log(`[audit] Inserting batch of ${batch.length} rows (offset ${i})`);
      const { error: batchErr } = await supabaseAdmin.from('transactions').insert(batch);
      if (batchErr) {
        // Batch rejected — retry one row at a time so good rows still get saved
        console.error(`[audit] Batch ${Math.floor(i / BATCH) + 1} failed (${batchErr.message}), retrying row-by-row`);
        for (const txnRow of batch) {
          const { error: rowErr } = await supabaseAdmin.from('transactions').insert(txnRow);
          if (rowErr) {
            console.error(`[audit] Skipping row ${txnRow.row_number}: ${rowErr.message}`);
            insertErrors++;
          }
        }
      }
    }
    if (insertErrors > 0) {
      console.warn(`[audit] ${insertErrors} of ${txnRows.length} rows could not be saved`);
    }

    // STEP 10: Build financial summary
    const categoryBreakdown = {};
    let summaryRevenue = 0, summaryExpenses = 0, summaryAssets = 0, summaryLiabilities = 0;
    rows.filter(r => !r.is_flagged).forEach(r => {
      const cat = r.category || 'other';
      const ft  = r.financial_type || 'other';
      const cr  = r.credit ?? 0;
      const db  = r.debit  ?? 0;
      if (!categoryBreakdown[cat]) categoryBreakdown[cat] = 0;
      if (ft === 'revenue')           { summaryRevenue     += cr; categoryBreakdown[cat] += cr; }
      if (ft === 'expense')           { summaryExpenses    += db; categoryBreakdown[cat] += db; }
      if (ft === 'asset')             { summaryAssets      += db; categoryBreakdown[cat] += db; }
      if (ft === 'liability_receipt') { summaryLiabilities += cr; categoryBreakdown[cat] += cr; }
      if (ft === 'liability_payment') { categoryBreakdown[cat] += db; }
    });
    summaryRevenue     = Math.round(summaryRevenue     * 100) / 100;
    summaryExpenses    = Math.round(summaryExpenses    * 100) / 100;
    summaryAssets      = Math.round(summaryAssets      * 100) / 100;
    summaryLiabilities = Math.round(summaryLiabilities * 100) / 100;
    const summaryEquity    = Math.round((summaryRevenue - summaryExpenses) * 100) / 100;

    // STEP 11: Return result
    const flaggedRows = rows
      .filter(r => r.is_flagged)
      .map(r => ({
        row_number:  r.row_number,
        description: r.raw.description || '',
        flag_reason: r.flag_reason,
      }));

    return res.status(200).json({
      success:         true,
      audit_id,
      audit_score:     score,
      total_rows:      totalRows,
      duplicate_count: duplicateCount,
      error_count:     errorCount,
      balance_valid:   balanceValid,
      total_debits:    totalDebits,
      total_credits:   totalCredits,
      flagged_rows:    flaggedRows,
      financialSummary: {
        totalRevenue:     summaryRevenue,
        totalExpenses:    summaryExpenses,
        netProfit:        summaryEquity,
        totalAssets:      summaryAssets,
        totalLiabilities: summaryLiabilities,
        equity:           summaryEquity,
        categoryBreakdown,
      },
    });

  } catch (err) {
    console.error('[audit] crash:', err.stack || err.message);
    if (audit_id) {
      try {
        await supabaseAdmin.from('audits').update({ status: 'failed' }).eq('id', audit_id);
      } catch (_) {}
    }
    const httpStatus = err.status === 400 ? 400 : 500;
    return res.status(httpStatus).json({
      error:  err.message,
      detail: httpStatus === 500 ? err.message : undefined,
    });
  }
};
