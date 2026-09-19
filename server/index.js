// CrediTrack — backend API.
//
// Plain Node.js + Express + pg. No TypeScript, no build step, no ORM.
//
// AUTH NOTE: every /api/* route requires a header `x-family-key` matching
// process.env.FAMILY_ACCESS_KEY. This is a lightweight *shared passcode*
// gate meant only to keep this private family app off the open internet if
// it's ever exposed on a home network — it is NOT real multi-user auth
// (no per-user accounts, sessions, or permissions). Anyone with the
// passcode has full read/write access to all the data.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function slugify(name, prefix) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return prefix + s;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ============================================================
// Row <-> camelCase mapping
// ============================================================

function mapLoan(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    totalAmount: num(r.total_amount) ?? 0,
    totalOutstanding: num(r.total_outstanding),
    settledAmount: num(r.settled_amount),
    balance: num(r.balance) ?? 0,
    emi: num(r.emi),
    plannedEmiStartDate: r.planned_emi_start_date || null,
    emiTenureMonths: r.emi_tenure_months === null || r.emi_tenure_months === undefined ? null : Number(r.emi_tenure_months),
    status: r.status,
    progress: r.progress || '',
    remarks: r.remarks || '',
    order: r.order ?? 0,
    settlementLetter: r.settlement_letter || null,
    nocCopy: r.noc_copy || null,
  };
}

function mapClosedLoan(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    originalAmount: num(r.original_amount) ?? 0,
    settledAmount: num(r.settled_amount) ?? 0,
    amountPaid: num(r.amount_paid) ?? 0,
    balanceRemaining: num(r.balance_remaining) ?? 0,
    datePaid: r.date_paid,
    source: r.source || '',
    remarks: r.remarks || '',
    order: r.order ?? 0,
    settlementLetter: r.settlement_letter || null,
    nocCopy: r.noc_copy || null,
  };
}

function mapIncome(r) {
  return { id: r.id, label: r.label, amount: num(r.amount) ?? 0 };
}

function mapEntry(r) {
  return {
    id: r.id,
    name: r.name,
    date: r.date || '',
    amount: num(r.amount) ?? 0,
    paidAmount: num(r.paid_amount),
    type: r.type,
    remarks: r.remarks || '',
    applied: !!r.applied,
  };
}

function mapMeta(r) {
  if (!r) return { familyLabel: 'Family', currency: 'INR' };
  return {
    familyLabel: r.family_label || 'Family',
    currency: r.currency || 'INR',
    seededFrom: r.seeded_from || undefined,
    seededAt: r.seeded_at || undefined,
    driveFolderId: r.drive_folder_id || undefined,
  };
}

// ============================================================
// Health check — deliberately OUTSIDE the /api prefix so it needs no
// passcode. Checks the database round-trip too, not just "the process is
// alive", so it's useful for an uptime check or a container/orchestrator
// readiness probe if this is ever deployed that way.
// ============================================================

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: err.message });
  }
});

// ============================================================
// Auth middleware — shared family passcode (see note at top of file).
// ============================================================

app.use('/api', (req, res, next) => {
  const key = req.header('x-family-key');
  const expected = process.env.FAMILY_ACCESS_KEY;
  if (!expected || key !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

// ============================================================
// GET /api/state — whole app state in one payload
// ============================================================

app.get('/api/state', async (req, res) => {
  try {
    const [loansRes, closedRes, monthsRes, incomesRes, entriesRes, metaRes] = await Promise.all([
      pool.query('SELECT * FROM loans ORDER BY "order" ASC'),
      pool.query('SELECT * FROM closed_loans ORDER BY "order" ASC'),
      pool.query('SELECT * FROM spend_months ORDER BY id ASC'),
      pool.query('SELECT * FROM incomes ORDER BY "order" ASC'),
      pool.query('SELECT * FROM spend_entries ORDER BY "order" ASC'),
      pool.query('SELECT * FROM app_meta WHERE id = 1'),
    ]);

    const spends = {};
    monthsRes.rows.forEach((m) => {
      spends[m.id] = { label: m.label, incomes: [], entries: [] };
    });
    incomesRes.rows.forEach((i) => {
      if (spends[i.month_id]) spends[i.month_id].incomes.push(mapIncome(i));
    });
    entriesRes.rows.forEach((e) => {
      if (spends[e.month_id]) spends[e.month_id].entries.push(mapEntry(e));
    });

    res.json({
      loans: loansRes.rows.map(mapLoan),
      closed: closedRes.rows.map(mapClosedLoan),
      spends,
      meta: mapMeta(metaRes.rows[0]),
    });
  } catch (err) {
    console.error('GET /api/state failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not load state from the database.' });
  }
});

// ============================================================
// Loans
// ============================================================

app.post('/api/loans', async (req, res) => {
  try {
    const b = req.body || {};
    const id = slugify(b.name, 'a-') + '-' + uid();
    const { rows } = await pool.query(
      `INSERT INTO loans
         (id, name, category, total_amount, total_outstanding, settled_amount, balance, emi, planned_emi_start_date, emi_tenure_months, status, progress, remarks, "order", settlement_letter, noc_copy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id,
        b.name || '',
        b.category,
        b.totalAmount || 0,
        b.totalOutstanding ?? null,
        b.settledAmount ?? null,
        b.balance || 0,
        b.emi ?? null,
        b.plannedEmiStartDate || null,
        b.emiTenureMonths ?? null,
        b.status || 'active',
        b.progress || '',
        b.remarks || '',
        b.order ?? 0,
        b.settlementLetter ? JSON.stringify(b.settlementLetter) : null,
        b.nocCopy ? JSON.stringify(b.nocCopy) : null,
      ]
    );
    res.status(201).json(mapLoan(rows[0]));
  } catch (err) {
    console.error('POST /api/loans failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not create loan.' });
  }
});

const LOAN_FIELD_MAP = {
  name: 'name',
  category: 'category',
  totalAmount: 'total_amount',
  totalOutstanding: 'total_outstanding',
  settledAmount: 'settled_amount',
  balance: 'balance',
  emi: 'emi',
  plannedEmiStartDate: 'planned_emi_start_date',
  emiTenureMonths: 'emi_tenure_months',
  status: 'status',
  progress: 'progress',
  remarks: 'remarks',
  order: '"order"',
};

function buildPatch(body, fieldMap) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, col] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      sets.push(`${col} = $${i}`);
      values.push(body[key]);
      i++;
    }
  }
  return { sets, values, next: i };
}

app.patch('/api/loans/:id', async (req, res) => {
  try {
    const { sets, values, next } = buildPatch(req.body || {}, LOAN_FIELD_MAP);
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM loans WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      return res.json(mapLoan(rows[0]));
    }
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE loans SET ${sets.join(', ')}, updated_at = now() WHERE id = $${next} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapLoan(rows[0]));
  } catch (err) {
    console.error('PATCH /api/loans/:id failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update loan.' });
  }
});

app.delete('/api/loans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM loans WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/loans/:id failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not delete loan.' });
  }
});

app.patch('/api/loans/:id/document', async (req, res) => {
  try {
    const { kind, doc } = req.body || {};
    if (kind !== 'settlementLetter' && kind !== 'nocCopy') {
      return res.status(400).json({ error: 'bad_request', message: 'kind must be settlementLetter or nocCopy' });
    }
    const col = kind === 'settlementLetter' ? 'settlement_letter' : 'noc_copy';
    const { rows } = await pool.query(
      `UPDATE loans SET ${col} = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(doc), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapLoan(rows[0]));
  } catch (err) {
    console.error('PATCH /api/loans/:id/document failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not attach document.' });
  }
});

// Server-side version of the old frontend moveLoanToClosed(): moves an
// active loan into closed_loans in one transaction.
app.post('/api/loans/:id/close', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: loanRows } = await client.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [req.params.id]);
    const loan = loanRows[0];
    if (!loan) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    const closedId = slugify(loan.name, 'c-') + '-' + uid();
    const { rows: countRows } = await client.query('SELECT count(*)::int AS c FROM closed_loans');
    const totalAmount = num(loan.total_amount) || 0;
    const balance = num(loan.balance) || 0;
    const settledAmount = num(loan.settled_amount) ?? 0;

    const { rows: closedRows } = await client.query(
      `INSERT INTO closed_loans
         (id, name, category, original_amount, settled_amount, amount_paid, balance_remaining, date_paid, source, remarks, "order", settlement_letter, noc_copy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        closedId,
        loan.name,
        loan.category,
        totalAmount,
        settledAmount,
        totalAmount - balance,
        balance,
        null,
        'Moved from Active Loans',
        loan.remarks || '',
        countRows[0].c,
        loan.settlement_letter || null,
        loan.noc_copy || null,
      ]
    );
    await client.query('DELETE FROM loans WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ closedLoan: mapClosedLoan(closedRows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/loans/:id/close failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not close loan.' });
  } finally {
    client.release();
  }
});

// ============================================================
// Closed loans
// ============================================================

app.post('/api/closed-loans', async (req, res) => {
  try {
    const b = req.body || {};
    const id = slugify(b.name, 'c-') + '-' + uid();
    const { rows } = await pool.query(
      `INSERT INTO closed_loans
         (id, name, category, original_amount, settled_amount, amount_paid, balance_remaining, date_paid, source, remarks, "order", settlement_letter, noc_copy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        id,
        b.name || '',
        b.category,
        b.originalAmount || 0,
        b.settledAmount || 0,
        b.amountPaid || 0,
        b.balanceRemaining || 0,
        b.datePaid ?? null,
        b.source || '',
        b.remarks || '',
        b.order ?? 0,
        b.settlementLetter ? JSON.stringify(b.settlementLetter) : null,
        b.nocCopy ? JSON.stringify(b.nocCopy) : null,
      ]
    );
    res.status(201).json(mapClosedLoan(rows[0]));
  } catch (err) {
    console.error('POST /api/closed-loans failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not create closed loan.' });
  }
});

const CLOSED_FIELD_MAP = {
  name: 'name',
  category: 'category',
  originalAmount: 'original_amount',
  settledAmount: 'settled_amount',
  amountPaid: 'amount_paid',
  balanceRemaining: 'balance_remaining',
  datePaid: 'date_paid',
  source: 'source',
  remarks: 'remarks',
  order: '"order"',
};

app.patch('/api/closed-loans/:id', async (req, res) => {
  try {
    const { sets, values, next } = buildPatch(req.body || {}, CLOSED_FIELD_MAP);
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM closed_loans WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      return res.json(mapClosedLoan(rows[0]));
    }
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE closed_loans SET ${sets.join(', ')}, updated_at = now() WHERE id = $${next} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapClosedLoan(rows[0]));
  } catch (err) {
    console.error('PATCH /api/closed-loans/:id failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update closed loan.' });
  }
});

app.delete('/api/closed-loans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM closed_loans WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/closed-loans/:id failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not delete closed loan.' });
  }
});

app.patch('/api/closed-loans/:id/document', async (req, res) => {
  try {
    const { kind, doc } = req.body || {};
    if (kind !== 'settlementLetter' && kind !== 'nocCopy') {
      return res.status(400).json({ error: 'bad_request', message: 'kind must be settlementLetter or nocCopy' });
    }
    const col = kind === 'settlementLetter' ? 'settlement_letter' : 'noc_copy';
    const { rows } = await pool.query(
      `UPDATE closed_loans SET ${col} = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [JSON.stringify(doc), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapClosedLoan(rows[0]));
  } catch (err) {
    console.error('PATCH /api/closed-loans/:id/document failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not attach document.' });
  }
});

// ============================================================
// Spend months / incomes / entries
// ============================================================

async function ensureMonth(client, monthId, label) {
  await client.query(
    `INSERT INTO spend_months (id, label) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    [monthId, label || monthId]
  );
}

app.put('/api/spend-months/:monthId', async (req, res) => {
  try {
    const label = (req.body || {}).label || req.params.monthId;
    const { rows } = await pool.query(
      `INSERT INTO spend_months (id, label) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
       RETURNING *`,
      [req.params.monthId, label]
    );
    res.json({ id: rows[0].id, label: rows[0].label });
  } catch (err) {
    console.error('PUT /api/spend-months/:monthId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not save month.' });
  }
});

app.post('/api/spend-months/:monthId/incomes', async (req, res) => {
  try {
    const b = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureMonth(client, req.params.monthId, b.monthLabel);
      const { rows: countRows } = await client.query('SELECT count(*)::int AS c FROM incomes WHERE month_id = $1', [req.params.monthId]);
      const id = uid();
      const { rows } = await client.query(
        `INSERT INTO incomes (id, month_id, label, amount, "order") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, req.params.monthId, b.label || 'Income', b.amount || 0, countRows[0].c]
      );
      await client.query('COMMIT');
      res.status(201).json(mapIncome(rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/spend-months/:monthId/incomes failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not add income.' });
  }
});

app.patch('/api/spend-months/:monthId/incomes/:incomeId', async (req, res) => {
  try {
    const { sets, values, next } = buildPatch(req.body || {}, { label: 'label', amount: 'amount', order: '"order"' });
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM incomes WHERE id = $1 AND month_id = $2', [req.params.incomeId, req.params.monthId]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      return res.json(mapIncome(rows[0]));
    }
    values.push(req.params.incomeId, req.params.monthId);
    const { rows } = await pool.query(
      `UPDATE incomes SET ${sets.join(', ')} WHERE id = $${next} AND month_id = $${next + 1} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapIncome(rows[0]));
  } catch (err) {
    console.error('PATCH /api/spend-months/:monthId/incomes/:incomeId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update income.' });
  }
});

app.delete('/api/spend-months/:monthId/incomes/:incomeId', async (req, res) => {
  try {
    await pool.query('DELETE FROM incomes WHERE id = $1 AND month_id = $2', [req.params.incomeId, req.params.monthId]);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/spend-months/:monthId/incomes/:incomeId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not delete income.' });
  }
});

app.post('/api/spend-months/:monthId/entries', async (req, res) => {
  try {
    const b = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureMonth(client, req.params.monthId, b.monthLabel);
      const { rows: countRows } = await client.query('SELECT count(*)::int AS c FROM spend_entries WHERE month_id = $1', [req.params.monthId]);
      const id = uid();
      const { rows } = await client.query(
        `INSERT INTO spend_entries (id, month_id, name, date, amount, paid_amount, type, remarks, applied, "order")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, req.params.monthId, b.name || '', b.date || '', b.amount || 0, b.paidAmount ?? null, b.type || 'expense', b.remarks || '', !!b.applied, countRows[0].c]
      );
      await client.query('COMMIT');
      res.status(201).json(mapEntry(rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/spend-months/:monthId/entries failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not add entry.' });
  }
});

const ENTRY_FIELD_MAP = {
  name: 'name',
  date: 'date',
  amount: 'amount',
  paidAmount: 'paid_amount',
  type: 'type',
  remarks: 'remarks',
  applied: 'applied',
  order: '"order"',
};

app.patch('/api/spend-months/:monthId/entries/:entryId', async (req, res) => {
  try {
    const { sets, values, next } = buildPatch(req.body || {}, ENTRY_FIELD_MAP);
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM spend_entries WHERE id = $1 AND month_id = $2', [req.params.entryId, req.params.monthId]);
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      return res.json(mapEntry(rows[0]));
    }
    values.push(req.params.entryId, req.params.monthId);
    const { rows } = await pool.query(
      `UPDATE spend_entries SET ${sets.join(', ')} WHERE id = $${next} AND month_id = $${next + 1} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(mapEntry(rows[0]));
  } catch (err) {
    console.error('PATCH /api/spend-months/:monthId/entries/:entryId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update entry.' });
  }
});

app.delete('/api/spend-months/:monthId/entries/:entryId', async (req, res) => {
  try {
    await pool.query('DELETE FROM spend_entries WHERE id = $1 AND month_id = $2', [req.params.entryId, req.params.monthId]);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/spend-months/:monthId/entries/:entryId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not delete entry.' });
  }
});

// Clone every recurring (type === 'expense') entry from one month into a
// brand-new month, plus the income rows as-is. Settlement entries are
// one-off and are NOT copied. Fails with 409 if the target month already
// has entries, rather than duplicating data.
app.post('/api/spend-months/:fromMonthId/clone-to/:toMonthId', async (req, res) => {
  const { fromMonthId, toMonthId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingEntries } = await client.query('SELECT count(*)::int AS c FROM spend_entries WHERE month_id = $1', [toMonthId]);
    if (existingEntries[0].c > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'month_not_empty', message: `${toMonthId} already has spend entries — clone would duplicate data.` });
    }

    let label = toMonthId;
    const m = /^(\d{4})-(\d{2})$/.exec(toMonthId);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
      label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    }
    await ensureMonth(client, toMonthId, label);

    const { rows: srcIncomes } = await client.query('SELECT * FROM incomes WHERE month_id = $1 ORDER BY "order" ASC', [fromMonthId]);
    for (const inc of srcIncomes) {
      await client.query(
        `INSERT INTO incomes (id, month_id, label, amount, "order") VALUES ($1,$2,$3,$4,$5)`,
        [uid(), toMonthId, inc.label, inc.amount, inc.order]
      );
    }

    const { rows: srcEntries } = await client.query(
      `SELECT * FROM spend_entries WHERE month_id = $1 AND type = 'expense' ORDER BY "order" ASC`,
      [fromMonthId]
    );
    for (const e of srcEntries) {
      await client.query(
        `INSERT INTO spend_entries (id, month_id, name, date, amount, paid_amount, type, remarks, applied, "order")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uid(), toMonthId, e.name, e.date, e.amount, null, e.type, e.remarks, false, e.order]
      );
    }

    await client.query('COMMIT');

    const { rows: incomeRows } = await pool.query('SELECT * FROM incomes WHERE month_id = $1 ORDER BY "order" ASC', [toMonthId]);
    const { rows: entryRows } = await pool.query('SELECT * FROM spend_entries WHERE month_id = $1 ORDER BY "order" ASC', [toMonthId]);
    res.status(201).json({
      monthId: toMonthId,
      label,
      incomes: incomeRows.map(mapIncome),
      entries: entryRows.map(mapEntry),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/spend-months/:fromMonthId/clone-to/:toMonthId failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not clone month.' });
  } finally {
    client.release();
  }
});

// ============================================================
// Meta
// ============================================================

const META_FIELD_MAP = {
  familyLabel: 'family_label',
  currency: 'currency',
  seededFrom: 'seeded_from',
  seededAt: 'seeded_at',
  driveFolderId: 'drive_folder_id',
};

app.patch('/api/meta', async (req, res) => {
  try {
    const { sets, values, next } = buildPatch(req.body || {}, META_FIELD_MAP);
    await pool.query(
      `INSERT INTO app_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
    );
    if (!sets.length) {
      const { rows } = await pool.query('SELECT * FROM app_meta WHERE id = 1');
      return res.json(mapMeta(rows[0]));
    }
    const { rows } = await pool.query(`UPDATE app_meta SET ${sets.join(', ')} WHERE id = 1 RETURNING *`, values);
    res.json(mapMeta(rows[0]));
  } catch (err) {
    console.error('PATCH /api/meta failed:', err);
    res.status(500).json({ error: 'server_error', message: 'Could not update settings.' });
  }
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`CrediTrack API listening on port ${PORT}`);
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then close the database pool cleanly, instead of dropping
// connections mid-request on a deploy/restart/Ctrl+C.
function shutdown(signal) {
  console.log(`\n[server] Received ${signal}, shutting down...`);
  server.close(() => {
    pool.end().then(() => {
      console.log('[server] Closed out remaining connections and database pool.');
      process.exit(0);
    });
  });
  // Force-exit if it hangs for some reason, rather than blocking forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
