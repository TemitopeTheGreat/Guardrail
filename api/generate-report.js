if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── HELPERS ───────────────────────────────────────────────────────────────────
function scoreColour(score) {
  if (score >= 90) return '#34D399';
  if (score >= 70) return '#FBBF24';
  return '#F87171';
}

function fmtMoney(n) {
  if (n == null) return '';
  return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '';
  try { return new Date(str).toLocaleDateString('en-GB'); } catch { return str; }
}

// Draw a simple table row — returns new Y position
function tableRow(doc, y, cols, values, opts = {}) {
  const { font = 'Helvetica', fontSize = 9, flagged = false } = opts;
  if (flagged) doc.fillColor('#F87171'); else doc.fillColor('#CBD5E1');
  doc.font(font).fontSize(fontSize);

  cols.forEach((col, i) => {
    doc.text(String(values[i] ?? ''), col.x, y, { width: col.w, lineBreak: false, ellipsis: true });
  });

  return y + 16;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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

  const { audit_id } = req.body || {};
  if (!audit_id) return res.status(400).json({ error: 'audit_id is required' });

  try {
    // 1. Fetch audit — confirm ownership
    const { data: audit, error: auditErr } = await supabaseAdmin
      .from('audits')
      .select('*')
      .eq('id', audit_id)
      .eq('user_id', userId)
      .single();
    if (auditErr || !audit) return res.status(404).json({ error: 'Audit not found' });

    // 2. Fetch transactions
    const { data: txns, error: txnErr } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('audit_id', audit_id)
      .order('row_number', { ascending: true });
    if (txnErr) throw new Error(`Failed to fetch transactions: ${txnErr.message}`);

    // 3. Fetch profile for name
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, account_type')
      .eq('id', userId)
      .single();

    const displayName = profile?.full_name || user.email || 'User';

    // ── BUILD PDF ─────────────────────────────────────────────────────────────
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - 100; // usable width

      // ── PAGE 1: COVER ─────────────────────────────────────────────────────
      doc.moveDown(4);

      // Logo text
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#34D399')
        .text('GUARDRAIL FINANCIAL', { align: 'center', characterSpacing: 4 });

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#1E293B').stroke();
      doc.moveDown(1.5);

      doc.font('Helvetica-Bold').fontSize(32).fillColor('#F8FAFC')
        .text('Financial Audit Report', { align: 'center' });

      doc.moveDown(1);
      doc.font('Helvetica').fontSize(14).fillColor('#94A3B8')
        .text(displayName, { align: 'center' });

      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(12).fillColor('#64748B')
        .text('Generated ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), { align: 'center' });

      doc.moveDown(3);

      // Score
      const sCol = scoreColour(audit.audit_score);
      doc.font('Helvetica-Bold').fontSize(72).fillColor(sCol)
        .text(`${audit.audit_score}/100`, { align: 'center' });
      doc.font('Helvetica').fontSize(13).fillColor('#94A3B8')
        .text('Audit Score', { align: 'center' });

      // ── PAGE 2: SUMMARY ───────────────────────────────────────────────────
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#F8FAFC').text('Audit Summary');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#334155').stroke();
      doc.moveDown(1);

      const summaryItems = [
        ['File',               audit.file_name],
        ['Total rows processed', String(audit.total_rows)],
        ['Duplicates removed',   String(audit.duplicate_count)],
        ['Errors flagged',       String(audit.error_count)],
        ['Balance status',       audit.balance_valid ? 'Balanced ✓' : 'Not Balanced ✗'],
        ['Total debits',         fmtMoney(audit.total_debits  ?? 0)],
        ['Total credits',        fmtMoney(audit.total_credits ?? 0)],
        ['Account type',         (audit.account_type || '').charAt(0).toUpperCase() + (audit.account_type || '').slice(1)],
      ];

      summaryItems.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#94A3B8').text(label, 50, doc.y, { width: 200, continued: true });
        doc.font('Helvetica').fontSize(10).fillColor('#F8FAFC').text(value);
        doc.moveDown(0.4);
      });

      // ── PAGE 3: TRANSACTION LEDGER ────────────────────────────────────────
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#F8FAFC').text('Transaction Ledger');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#334155').stroke();
      doc.moveDown(0.8);

      const cols = [
        { x: 50,  w: 72,  label: 'Date' },
        { x: 128, w: 155, label: 'Description' },
        { x: 289, w: 80,  label: 'Category' },
        { x: 375, w: 70,  label: 'Debit' },
        { x: 451, w: 70,  label: 'Credit' },
        { x: 527, w: 55,  label: 'Status' },
      ];

      // Header
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B');
      cols.forEach(c => doc.text(c.label, c.x, doc.y, { width: c.w, lineBreak: false }));
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#1E293B').stroke();
      doc.moveDown(0.3);

      let y = doc.y;
      (txns || []).forEach(txn => {
        if (y > 730) {
          doc.addPage();
          y = 50;
          // Re-draw header on new page
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B');
          cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w, lineBreak: false }));
          y += 14;
          doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#1E293B').stroke();
          y += 6;
        }
        const values = [
          fmtDate(txn.txn_date),
          txn.description,
          txn.category,
          txn.debit  ? fmtMoney(txn.debit)  : '',
          txn.credit ? fmtMoney(txn.credit) : '',
          txn.is_flagged ? '⚑ ' + (txn.flag_reason || '') : '✓',
        ];
        y = tableRow(doc, y, cols, values, { flagged: txn.is_flagged });
      });

      // ── PAGE 4: FLAGS (only if errors > 0) ───────────────────────────────
      const flagged = (txns || []).filter(t => t.is_flagged);
      if (flagged.length > 0) {
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#F8FAFC').text('Flags & Errors');
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#334155').stroke();
        doc.moveDown(1);

        flagged.forEach(txn => {
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#F87171')
            .text(`Row ${txn.row_number} — ${txn.flag_reason}`, { continued: true });
          doc.font('Helvetica').fillColor('#CBD5E1')
            .text(`  ${txn.description || '(no description)'}   ${fmtDate(txn.txn_date)}`);
          doc.moveDown(0.3);
        });
      }

      doc.end();
    });

    // 4. Upload PDF to storage
    const pdfPath = `${userId}/${audit_id}/report.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('pdf-reports')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`);

    // 5. Update audit row
    await supabaseAdmin.from('audits').update({ report_url: pdfPath }).eq('id', audit_id);

    // Create a signed URL valid for 5 minutes
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('pdf-reports')
      .createSignedUrl(pdfPath, 300);
    if (signErr) throw new Error(`Failed to create signed URL: ${signErr.message}`);

    return res.status(200).json({ success: true, report_url: signed.signedUrl });

  } catch (err) {
    console.error('[generate-report] error:', err.message);
    return res.status(500).json({ error: 'Report generation failed', detail: err.message });
  }
};
