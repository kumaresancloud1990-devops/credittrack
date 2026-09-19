// One-time importer: loads public/data/seed-data.json (the same file the
// old localStorage-based frontend used to seed itself from) into Postgres.
//
// Safe to run multiple times — it checks whether `loans` already has rows
// and does nothing if so, so re-running after the first successful seed is
// a harmless no-op.
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function seed() {
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM loans');
  if (rows[0].c > 0) {
    console.log('[seed] `loans` table already has data — skipping seed (safe to re-run, nothing to do).');
    return;
  }

  const seedPath = path.join(__dirname, '..', '..', 'public', 'data', 'seed-data.json');
  if (!fs.existsSync(seedPath)) {
    console.log(`[seed] No seed file found at ${seedPath} — nothing to import.`);
    return;
  }
  const raw = fs.readFileSync(seedPath, 'utf8');
  const seedFile = JSON.parse(raw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- Loans ---
    const loans = seedFile.loans || {};
    for (const [id, l] of Object.entries(loans)) {
      await client.query(
        `INSERT INTO loans
           (id, name, category, total_amount, total_outstanding, settled_amount, balance, emi, planned_emi_start_date, emi_tenure_months, status, progress, remarks, "order", settlement_letter, noc_copy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          l.name,
          l.category,
          l.totalAmount || 0,
          l.totalOutstanding ?? null,
          l.settledAmount ?? null,
          l.balance || 0,
          l.emi ?? null,
          l.plannedEmiStartDate || null,
          l.emiTenureMonths ?? null,
          l.status || 'active',
          l.progress || '',
          l.remarks || '',
          l.order ?? 0,
          l.settlementLetter ? JSON.stringify(l.settlementLetter) : null,
          l.nocCopy ? JSON.stringify(l.nocCopy) : null,
        ]
      );
    }
    console.log(`[seed] Inserted ${Object.keys(loans).length} loans.`);

    // --- Closed loans ---
    const closed = seedFile.closed || {};
    for (const [id, c] of Object.entries(closed)) {
      await client.query(
        `INSERT INTO closed_loans
           (id, name, category, original_amount, settled_amount, amount_paid, balance_remaining, date_paid, source, remarks, "order", settlement_letter, noc_copy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          c.name,
          c.category,
          c.originalAmount || 0,
          c.settledAmount || 0,
          c.amountPaid || 0,
          c.balanceRemaining || 0,
          c.datePaid ?? null,
          c.source || '',
          c.remarks || '',
          c.order ?? 0,
          c.settlementLetter ? JSON.stringify(c.settlementLetter) : null,
          c.nocCopy ? JSON.stringify(c.nocCopy) : null,
        ]
      );
    }
    console.log(`[seed] Inserted ${Object.keys(closed).length} closed loans.`);

    // --- Spend months, incomes (old single `income` number -> one "Salary" row), entries ---
    const spends = seedFile.spends || {};
    let monthCount = 0;
    let entryCount = 0;
    for (const [monthId, m] of Object.entries(spends)) {
      await client.query(
        `INSERT INTO spend_months (id, label) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
        [monthId, m.label || monthId]
      );
      monthCount++;

      const incomeAmount = Number(m.income) || 0;
      await client.query(
        `INSERT INTO incomes (id, month_id, label, amount, "order") VALUES ($1,$2,$3,$4,$5)`,
        [uid(), monthId, 'Salary', incomeAmount, 0]
      );

      const entries = m.entries || [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        await client.query(
          `INSERT INTO spend_entries (id, month_id, name, date, amount, paid_amount, type, remarks, applied, "order")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            uid(),
            monthId,
            e.name,
            e.date || '',
            e.amount || 0,
            e.paidAmount ?? null,
            e.type || 'expense',
            e.remarks || '',
            !!e.applied,
            i,
          ]
        );
        entryCount++;
      }
    }
    console.log(`[seed] Inserted ${monthCount} months, ${entryCount} spend entries (one 'Salary' income row per month).`);

    // --- Meta ---
    const meta = seedFile.meta || {};
    await client.query(
      `INSERT INTO app_meta (id, family_label, currency, seeded_from, seeded_at, drive_folder_id)
       VALUES (1,$1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET
         family_label = EXCLUDED.family_label,
         currency = EXCLUDED.currency,
         seeded_from = EXCLUDED.seeded_from,
         seeded_at = EXCLUDED.seeded_at,
         drive_folder_id = EXCLUDED.drive_folder_id`,
      [meta.familyLabel || 'Family', meta.currency || 'INR', meta.seededFrom ?? null, meta.seededAt ?? null, meta.driveFolderId ?? null]
    );

    await client.query('COMMIT');
    console.log('[seed] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .catch((err) => {
    console.error('[seed] Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
