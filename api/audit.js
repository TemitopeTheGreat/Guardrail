if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

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

// ── MULTI-FORMAT FILE PARSING ─────────────────────────────────────────────────
// Sniff the delimiter from the header line — Nigerian bank exports show up as
// comma, semicolon, or tab separated depending on the export tool used.
function detectDelimiter(text, ext) {
  if (ext === 'tsv') return '\t';
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = {
    ',':  (firstLine.match(/,/g)  || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';':  (firstLine.match(/;/g)  || []).length,
  };
  const [best, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return bestCount > 0 ? best : ',';
}

function parseDelimitedText(text, ext) {
  const delimiter = detectDelimiter(text, ext);
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

// Asks Claude to turn unstructured PDF statement text into a structured
// transaction list — PDFs have no consistent columnar layout to parse with regex.
async function extractTransactionsFromText(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('PDF processing is not configured on the server (missing ANTHROPIC_API_KEY).');

  const excerpt = text.slice(0, 60000); // stay within the model's practical input budget

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content:
          'Extract every bank transaction from the statement text below as a JSON array. ' +
          'Each element must be an object with exactly these keys: "date" (YYYY-MM-DD string), ' +
          '"description" (string), "debit" (number, or null if not a debit), ' +
          '"credit" (number, or null if not a credit). ' +
          'Respond with ONLY the JSON array — no markdown fencing, no commentary.\n\n' +
          '--- STATEMENT TEXT ---\n' + excerpt,
      }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`PDF extraction via Claude failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  const raw = (payload.content || []).map(block => block.text || '').join('').trim();
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not locate a transaction list in the PDF.');

  let extracted;
  try {
    extracted = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Could not parse the transaction list extracted from the PDF.');
  }

  return extracted.map(t => ({
    date:        t.date || '',
    description: t.description || '',
    debit:       t.debit  ?? '',
    credit:      t.credit ?? '',
  }));
}

async function parsePdfStatement(buffer) {
  const { text } = await pdfParse(buffer);
  return extractTransactionsFromText(text);
}

// OFX (`<STMTTRN>...</STMTTRN>` SGML-ish blocks) and QIF (line-coded entries,
// e.g. "D01/15/2024", "T-2500.00", "PMemo") both lack a tabular layout, so we
// pull fields out with targeted regexes rather than a real parser.
function parseQifDate(s) {
  const m = (s || '').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-']?(\d{2,4})/);
  if (!m) return '';
  let [, a, b, year] = m;
  if (year.length === 2) year = (parseInt(year, 10) >= 50 ? '19' : '20') + year;
  return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
}

function parseQIF(text) {
  return text.split(/^\^\s*$/m)
    .map(entry => {
      let date = '', amount = null, memo = '';
      for (const line of entry.split(/\r?\n/)) {
        const code = line[0];
        const val = line.slice(1).trim();
        if (code === 'D') date = parseQifDate(val);
        else if (code === 'T' || code === 'U') amount = parseFloat(val.replace(/,/g, ''));
        else if ((code === 'P' || code === 'M') && !memo) memo = val;
      }
      if (!date && amount === null) return null;
      return {
        date,
        description: memo,
        debit:  (amount != null && amount < 0) ? Math.abs(amount) : '',
        credit: (amount != null && amount > 0) ? amount : '',
      };
    })
    .filter(Boolean);
}

function parseOFX(text, ext) {
  if (ext === 'qif') return parseQIF(text);

  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  };

  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  return blocks.map(block => {
    const dtposted = tag(block, 'DTPOSTED');     // e.g. 20240115120000[-5:EST]
    const amount   = parseFloat(tag(block, 'TRNAMT'));
    const memo     = tag(block, 'MEMO') || tag(block, 'NAME');
    const dateMatch = dtposted.match(/^(\d{4})(\d{2})(\d{2})/);

    return {
      date:        dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '',
      description: memo,
      debit:       (!isNaN(amount) && amount < 0) ? Math.abs(amount) : '',
      credit:      (!isNaN(amount) && amount > 0) ? amount : '',
    };
  });
}

// Single entry point — branches on file extension and always resolves to the
// standard { date, description, debit, credit } row shape the audit pipeline expects.
async function parseFileContent(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  switch (ext) {
    case 'csv':
    case 'tsv':
    case 'txt':
      return parseDelimitedText(buffer.toString('utf-8'), ext);
    case 'xlsx':
    case 'xls':
      return parseSpreadsheet(buffer);
    case 'pdf':
      return parsePdfStatement(buffer);
    case 'ofx':
    case 'qif':
      return parseOFX(buffer.toString('utf-8'), ext);
    default:
      throw new Error(`Unsupported file type: .${ext}`);
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
