// Guardrail Financial — File Uploader
// Requires window.supabaseClient to be initialised by the dashboard page.

(function () {
  'use strict';

  // Browsers report MIME types inconsistently for spreadsheet/CSV exports,
  // so validation is by file extension, not MIME type.
  const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
  const ACCEPTED_EXT   = /\.(csv|xlsx|xls)$/i;
  const MAX_BYTES      = 10 * 1024 * 1024; // 10 MB

  // ── PUBLIC INIT ─────────────────────────────────────────────────────────────
  window.initUploader = function initUploader(containerElementId) {
    const container = document.getElementById(containerElementId);
    if (!container) {
      console.error('[uploader] Container not found:', containerElementId);
      return;
    }
    if (!window.supabaseClient) {
      container.innerHTML = '<p class="text-red-400 text-sm">Uploader error: Supabase client not initialised.</p>';
      return;
    }

    // Build the drop-zone UI
    container.innerHTML = `
      <div id="gr-dropzone"
        class="border-2 border-dashed border-slate-700 hover:border-emerald-400/60 rounded-2xl p-10 text-center cursor-pointer transition-all select-none"
        style="transition: border-color 0.2s, background 0.2s;">
        <svg class="mx-auto mb-4 opacity-40" width="48" height="48" fill="none" viewBox="0 0 48 48">
          <rect x="8" y="12" width="32" height="28" rx="3" stroke="#94A3B8" stroke-width="2"/>
          <path d="M24 20v12M18 26l6-6 6 6" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 12V9a2 2 0 012-2h12a2 2 0 012 2v3" stroke="#94A3B8" stroke-width="2"/>
        </svg>
        <p class="text-slate-300 font-semibold text-base mb-1">Drop your CSV or Excel file here</p>
        <p class="text-slate-500 text-sm">or <span class="text-emerald-400 underline cursor-pointer" id="gr-browse-link">browse files</span></p>
        <p class="text-slate-600 text-xs mt-3">Accepts .csv, .xlsx, .xls — max 10 MB</p>
      </div>

      <input id="gr-file-input" type="file" accept="${ACCEPTED_EXTENSIONS.join(',')}" class="hidden">

      <div id="gr-status"  class="mt-4 hidden"></div>
      <div id="gr-results" class="mt-6 hidden"></div>
    `;

    const dropzone  = document.getElementById('gr-dropzone');
    const fileInput = document.getElementById('gr-file-input');
    const browseLink = document.getElementById('gr-browse-link');

    // Click to browse
    dropzone.addEventListener('click',  () => fileInput.click());
    browseLink.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag and drop
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.style.borderColor = '#34D399';
      dropzone.style.background  = 'rgba(52,211,153,0.04)';
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = '';
      dropzone.style.background  = '';
    });
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.style.borderColor = '';
      dropzone.style.background  = '';
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  };

  // ── STATUS HELPERS ─────────────────────────────────────────────────────────
  function setStatus(html, type = 'info') {
    const el = document.getElementById('gr-status');
    if (!el) return;
    const colours = {
      info:    'text-slate-400',
      success: 'text-emerald-400',
      error:   'text-red-400',
    };
    el.className = `mt-4 text-sm font-medium ${colours[type] || colours.info}`;
    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  function resetDropzone() {
    const dz = document.getElementById('gr-dropzone');
    const fi = document.getElementById('gr-file-input');
    if (dz) dz.style.opacity = '1';
    if (fi) fi.value = '';
  }

  // ── FILE VALIDATION ─────────────────────────────────────────────────────────
  function validateFile(file) {
    // Validate by extension — browsers report MIME types inconsistently for CSV/Excel.
    if (!ACCEPTED_EXT.test(file.name)) {
      return 'Unsupported file type. Accepts .csv, .xlsx, .xls.';
    }
    if (file.size > MAX_BYTES) {
      return 'File is too large. Maximum size is 10MB.';
    }
    return null;
  }

  // ── MAIN UPLOAD FLOW ────────────────────────────────────────────────────────
  async function handleFile(file) {
    const validationError = validateFile(file);
    if (validationError) {
      setStatus(validationError, 'error');
      return;
    }

    const dz = document.getElementById('gr-dropzone');
    if (dz) dz.style.opacity = '0.5';
    document.getElementById('gr-results').classList.add('hidden');

    try {
      // Get session — redirect to login if it's missing/expired rather than
      // failing deep inside the upload with a confusing 401.
      const { data: { session }, error: sessErr } = await window.supabaseClient.auth.getSession();
      if (sessErr || !session) {
        setStatus('Your session has expired. Redirecting to sign in…', 'error');
        setTimeout(() => window.location.replace('/login.html'), 1200);
        return;
      }
      const userId      = session.user.id;
      const accessToken = session.access_token;
      const auditId     = crypto.randomUUID();
      // Storage paths must be plain ASCII with forward slashes — strip
      // anything that isn't alphanumeric/dot/dash so spaces, parentheses,
      // accents, etc. in the original filename can't produce a bad path.
      const safeName    = file.name.replace(/[^a-zA-Z0-9.-]/g, '');
      const filePath    = `${userId}/${auditId}/${safeName}`;

      // Stage 1: Upload to storage
      setStatus('<span class="animate-pulse">⟳ Uploading file…</span>');
      console.log('Uploading to bucket "raw-uploads":', { filePath, fileSize: file.size });
      const { data, error } = await window.supabaseClient.storage
        .from('raw-uploads')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/octet-stream',
        });
      if (error) {
        console.error('Storage error:', error);
        throw new Error('File upload failed: ' + error.message);
      }

      // Stage 2: Call audit API
      setStatus('<span class="animate-pulse">⟳ Running audit…</span>');
      const auditRes = await fetch('/api/audit', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ file_path: filePath, audit_id: auditId }),
      });

      // Stage 3: Saving — parse defensively. A misconfigured route or a
      // server crash can return HTML/plaintext instead of JSON, and
      // `res.json()` throws a cryptic "Unexpected token <" in that case.
      setStatus('<span class="animate-pulse">⟳ Saving results…</span>');
      const rawBody = await auditRes.text();
      let auditData;
      try {
        auditData = JSON.parse(rawBody);
      } catch {
        throw new Error('Server error. Please try again.');
      }

      if (!auditRes.ok || !auditData.success) {
        throw new Error(auditData.error || 'Audit failed. Please try again.');
      }

      // Stage 4: Done — show results
      setStatus('Audit complete', 'success');
      showResults(auditData, accessToken);

    } catch (err) {
      setStatus(err.message || 'Something went wrong. Please try again.', 'error');
      resetDropzone();
    }
  }

  // ── RESULT DISPLAY ──────────────────────────────────────────────────────────
  function showResults(data, accessToken) {
    const score    = data.audit_score;
    const scoreCol = score >= 90 ? '#34D399' : score >= 70 ? '#FBBF24' : '#F87171';

    const balanceBadge = data.balance_valid
      ? '<span class="text-emerald-400">Balanced ✓</span>'
      : '<span class="text-red-400">Not Balanced ✗</span>';

    let flagTable = '';
    if (data.flagged_rows && data.flagged_rows.length > 0) {
      const rows = data.flagged_rows.map(r =>
        `<tr class="border-t border-slate-800">
          <td class="py-2 pr-4 text-slate-400 mono text-xs">Row ${r.row_number}</td>
          <td class="py-2 pr-4 text-slate-300 text-xs">${escHtml(r.description)}</td>
          <td class="py-2 text-red-400 text-xs mono">${r.flag_reason}</td>
        </tr>`
      ).join('');
      flagTable = `
        <div class="mt-5">
          <p class="text-sm font-semibold text-slate-400 mb-2">Flagged Rows</p>
          <div class="overflow-x-auto rounded-xl border border-slate-800">
            <table class="w-full text-left">
              <thead><tr class="bg-slate-900">
                <th class="py-2 px-3 text-xs text-slate-500 font-semibold">Row</th>
                <th class="py-2 px-3 text-xs text-slate-500 font-semibold">Description</th>
                <th class="py-2 px-3 text-xs text-slate-500 font-semibold">Reason</th>
              </tr></thead>
              <tbody class="bg-slate-950">${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    const el = document.getElementById('gr-results');
    el.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div class="flex items-start justify-between mb-5">
          <div>
            <p class="text-slate-400 text-sm font-semibold uppercase tracking-widest mono mb-1">Audit Score</p>
            <p class="font-black text-5xl" style="color:${scoreCol}">${score}<span class="text-xl text-slate-600">/100</span></p>
          </div>
          <button id="gr-download-btn"
            class="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-300 hover:text-white text-sm font-semibold transition-all">
            ↓ Download Report
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-2">
          ${statCard('Total Rows',   data.total_rows)}
          ${statCard('Duplicates',   data.duplicate_count)}
          ${statCard('Errors',       data.error_count)}
          ${statCard('Balance',      balanceBadge, true)}
        </div>

        ${flagTable}
      </div>
    `;
    el.classList.remove('hidden');
    resetDropzone();

    // Wire download button
    document.getElementById('gr-download-btn').addEventListener('click', () => {
      downloadReport(data.audit_id, accessToken);
    });
  }

  function statCard(label, value, raw = false) {
    return `
      <div class="bg-slate-800/60 rounded-xl p-4">
        <p class="text-slate-500 text-xs font-semibold uppercase tracking-widest mono mb-1">${label}</p>
        <p class="text-white font-bold text-xl">${raw ? value : escHtml(String(value))}</p>
      </div>`;
  }

  // ── PDF DOWNLOAD ────────────────────────────────────────────────────────────
  async function downloadReport(auditId, accessToken) {
    const btn = document.getElementById('gr-download-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Generating…'; }

    try {
      const res = await fetch('/api/generate-report', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ audit_id: auditId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Report generation failed.');

      // Open signed URL — browser triggers download
      const a = document.createElement('a');
      a.href     = data.report_url;
      a.download = 'guardrail-audit-report.pdf';
      a.target   = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↓ Download Report'; }
    }
  }

  // ── UTILS ───────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
