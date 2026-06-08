if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const XLSX = require('xlsx');

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
function cleanAmount(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str === '') return null;
  // Keep only digits, decimal point, and leading minus — strip currency symbols,
  // thousands commas, spaces, and any letter prefix (₦, N, $, £, etc.)
  const cleaned = str.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return NaN;
  return Math.round(num * 100) / 100;
}

// ── CATEGORISATION ────────────────────────────────────────────────────────────
const CATEGORY_RULES = [
  { pattern: /salary|payroll|wages/i,              category: 'salary' },
  { pattern: /fuel|diesel|petrol|generator/i,      category: 'fuel' },
  { pattern: /rent|lease/i,                        category: 'rent' },
  { pattern: /electricity|nepa|ekedc|ibedc/i,      category: 'utilities' },
  { pattern: /internet|data|mtn|airtel/i,          category: 'telecoms' },
  { pattern: /transfer|payment received/i,         category: 'income' },
  { pattern: /purchase|bought|market/i,            category: 'purchases' },
  { pattern: /tax|vat|firs/i,                      category: 'tax' },
];

function categorise(description) {
  const desc = (description || '').toLowerCase();
  const match = CATEGORY_RULES.find(r => r.pattern.test(desc));
  return match ? match.category : 'other';
}

// ── COLUMN DETECTION ──────────────────────────────────────────────────────────
// Nigerian bank CSV exports use inconsistent header names. Map every known
// variant — already lower-cased by Papa's transformHeader — onto the
// standard field name we work with internally.
const COLUMN_ALIASES = {
  date:        ['date', 'trans date', 'transaction date', 'value date', 'txn date'],
  description: ['description', 'narration', 'particulars', 'details', 'transaction details', 'remarks'],
  debit:       ['debit', 'dr', 'withdrawals', 'withdrawal', 'amount (dr)', 'debit amount'],
  credit:      ['credit', 'cr', 'deposits', 'deposit', 'amount (cr)', 'credit amount'],
};

function detectColumns(headers) {
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = aliases.find(alias => headers.includes(alias));
    if (found) map[field] = found;
  }
  return map;
}

// Map a row of arbitrary lower-cased headers onto the standard
// date/description/debit/credit shape via COLUMN_ALIASES, dropping rows
// that carry no usable data in any of the four fields.
function mapRowsToStandardFields(rows) {
  if (!rows.length) return [];
  const colMap = detectColumns(Object.keys(rows[0]));
  return rows
    .map(row => ({
      date:        row[colMap.date]        ?? row.date        ?? '',
      description: row[colMap.description] ?? row.description ?? '',
      debit:       row[colMap.debit]       ?? row.debit       ?? '',
      credit:      row[colMap.credit]      ?? row.credit      ?? '',
    }))
    .filter(row => [row.date, row.description, row.debit, row.credit]
      .some(v => String(v ?? '').trim() !== ''));
}

// ── FILE PARSING (CSV + Excel only) ───────────────────────────────────────────
// Sniff the delimiter from the header line — Nigerian bank CSV exports show up
// as comma- or semicolon-separated depending on the export tool used.
function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
  };
  const [best, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return bestCount > 0 ? best : ',';
}

function parseDelimitedText(text) {
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: h => h.trim().toLowerCase(),
    transform: v => (typeof v === 'string' ? v.trim() : v),
  });
  return mapRowsToStandardFields(parsed.data || []);
}

function parseSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  const normalised = sheetRows.map(row => {
    const out = {};
    for (const [key, val] of Object.entries(row)) {
      out[String(key).trim().toLowerCase()] = typeof val === 'string' ? val.trim() : val;
    }
    return out;
  });
  return mapRowsToStandardFields(normalised);
}

// Single entry point — branches on file extension and always resolves to the
// standard { date, description, debit, credit } row shape the audit pipeline expects.
// PDF/OFX/QIF support was removed for now — CSV and Excel are the two formats
// that upload and parse reliably; other formats can be reintroduced later
// once the core upload path is stable.
async function parseFileContent(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  switch (ext) {
    case 'csv':
      return parseDelimitedText(buffer.toString('utf-8'));
    case 'xlsx':
    case 'xls':
      return parseSpreadsheet(buffer);
    default:
      throw new Error(`Unsupported file type: .${ext}. Please upload a CSV or Excel file.`);
  }
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

  // STEP 1: POST only
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // STEP 2–3: Verify JWT
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

  const { file_path, audit_id } = req.body || {};
  if (!file_path || !audit_id) {
    return res.status(400).json({ error: 'file_path and audit_id are required' });
  }

  // Verify the file belongs to the authenticated user
  if (!file_path.startsWith(userId + '/')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // STEP 1: Download the raw file from Supabase Storage
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
      .from('raw-uploads')
      .download(file_path);
    if (downloadErr) throw new Error(`Storage download failed: ${downloadErr.message}`);
    const buffer = Buffer.from(await fileData.arrayBuffer());
    const fileName = file_path.split('/').pop();

    // STEP 2: Parse — branches by extension (csv/tsv/txt, xlsx/xls, pdf, ofx/qif)
    // and always resolves to the standard { date, description, debit, credit } shape.
    const rawRows = await parseFileContent(buffer, fileName);

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
    rows = rows.map(row => {
      if (row.is_duplicate) return row;
      const debit = cleanAmount(row.raw.debit);
      const credit = cleanAmount(row.raw.credit);

      if (debit === null && credit === null) {
        return { ...row, is_flagged: true, flag_reason: row.flag_reason || 'missing_amount' };
      }
      if ((debit !== null && isNaN(debit)) || (credit !== null && isNaN(credit))) {
        return { ...row, is_flagged: true, flag_reason: row.flag_reason || 'invalid_amount', debit: null, credit: null };
      }
      return {
        ...row,
        debit: isNaN(debit) ? null : debit,
        credit: isNaN(credit) ? null : credit,
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

    // STEP 7: Categorise
    rows = rows.map(row => ({
      ...row,
      category: categorise(row.raw.description),
    }));

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
      user_id:     userId,
      txn_date:    r.txn_date || null,
      description: r.raw.description || '',
      debit:       r.debit  ?? null,
      credit:      r.credit ?? null,
      category:    r.category,
      is_flagged:  r.is_flagged,
      flag_reason: r.flag_reason || null,
      row_number:  r.row_number,
    }));

    const BATCH = 100;
    for (let i = 0; i < txnRows.length; i += BATCH) {
      const { error: txnErr } = await supabaseAdmin
        .from('transactions')
        .insert(txnRows.slice(i, i + BATCH));
      if (txnErr) throw new Error(`Transaction insert failed (batch ${Math.floor(i/BATCH)+1}): ${txnErr.message}`);
    }

    // STEP 10: Return result
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
    });

  } catch (err) {
    console.error('[audit] error:', err.message);
    try {
      await supabaseAdmin.from('audits').update({ status: 'failed' }).eq('id', audit_id);
    } catch (_) {}
    return res.status(500).json({ error: 'Audit processing failed', detail: err.message });
  }
};
