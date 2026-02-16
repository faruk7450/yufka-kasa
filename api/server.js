import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

// ---- Paths (ESM) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- CORS ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    return cb(null, allowedOrigins.includes(origin));
  }
}));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok. Render env içine koymalısın.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE_VERIFY === "1"
    ? { rejectUnauthorized: false }
    : undefined
});

// ---- JWT ----
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TOKEN_TTL = "30d";

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Auth gerekli" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token geçersiz" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Auth gerekli" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Yetki yok" });
    next();
  };
}

// ---- DB init (veri silmez) ----
async function initDb() {
  const sqlPath = path.join(__dirname, "db.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);

  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  const adminHash = await bcrypt.hash(adminPin, 10);
  const cashHash = await bcrypt.hash(staffCashPin, 10);
  const staffHash = await bcrypt.hash(staffPin, 10);

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Yönetici', 'ADMIN', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN');`,
    [adminHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Kasa', 'STAFF_CASH', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF_CASH');`,
    [cashHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel', 'STAFF', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF');`,
    [staffHash]
  );
}

initDb().catch((e) => console.error("DB init hata:", e));

// ---- Static UI ----
app.use(express.static(path.join(__dirname, "public")));

// ---- AUTH ----
app.post("/auth/login", async (req, res) => {
  const pin = String(req.body?.pin || "");
  if (!pin) return res.status(400).json({ error: "PIN gerekli" });

  const r = await pool.query(
    `SELECT id, name, role, pin_hash
     FROM users
     WHERE is_active=true
     ORDER BY id ASC`
  );

  const user = r.rows.find(u => bcrypt.compareSync(pin, u.pin_hash));
  if (!user) return res.status(401).json({ error: "Hatalı PIN" });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// ---- COMPANIES ----
app.get("/companies", authRequired, async (_req, res) => {
  const r = await pool.query(`
    SELECT
      c.id, c.name, c.phone, c.price_per_pack,
      COALESCE(SUM(le.amount), 0) AS balance
    FROM companies c
    LEFT JOIN ledger_entries le ON le.company_id = c.id
    WHERE c.is_active=true
    GROUP BY c.id
    ORDER BY c.name
  `);
  res.json(r.rows.map(x => ({
    ...x,
    price_per_pack: Number(x.price_per_pack || 0),
    balance: Number(x.balance || 0)
  })));
});

app.post("/companies", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `INSERT INTO companies(name, phone, price_per_pack)
     VALUES($1,$2,$3)
     ON CONFLICT (name) DO UPDATE
       SET phone=EXCLUDED.phone,
           price_per_pack=EXCLUDED.price_per_pack,
           is_active=true
     RETURNING *`,
    [nm, phone || null, Number(pricePerPack || 0)]
  );
  res.json(r.rows[0]);
});

app.put("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `UPDATE companies
     SET name=$1, phone=$2, price_per_pack=$3
     WHERE id=$4 AND is_active=true
     RETURNING *`,
    [nm, phone || null, Number(pricePerPack || 0), id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Firma bulunamadı" });
  res.json(r.rows[0]);
});

app.delete("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE companies SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Firma bulunamadı" });
  res.json({ ok: true });
});

// ---- BRANCHES ----
app.get("/companies/:companyId/branches", authRequired, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const r = await pool.query(
    `SELECT
       b.id, b.company_id, b.name,
       COALESCE(SUM(le.amount),0) AS balance
     FROM branches b
     LEFT JOIN ledger_entries le ON le.branch_id = b.id
     WHERE b.company_id=$1 AND b.is_active=true
     GROUP BY b.id
     ORDER BY b.name`,
    [companyId]
  );
  res.json(r.rows.map(x => ({ ...x, balance: Number(x.balance || 0) })));
});

app.post("/companies/:companyId/branches", authRequired, requireRole("ADMIN"), async (req, res) => {
  const companyId = Number(req.params.companyId);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const c = await pool.query(`SELECT id FROM companies WHERE id=$1 AND is_active=true`, [companyId]);
  if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });

  const r = await pool.query(
    `INSERT INTO branches(company_id, name)
     VALUES($1,$2)
     ON CONFLICT (company_id, name) DO UPDATE SET is_active=true
     RETURNING *`,
    [companyId, name]
  );
  res.json(r.rows[0]);
});

app.delete("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE branches SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json({ ok: true });
});

// ---- LEDGER ----
// type: SALE, CASH_SALE, PAYMENT, RETURN, DEBT_ADD
// PAYMENT artık paket ile girilir -> -(packs*unitPrice)
app.post("/ledger", authRequired, async (req, res) => {
  try {
    const { companyId, branchId, type, packs, amount, note, entryDate } = req.body;

    if (!["SALE","CASH_SALE","PAYMENT","RETURN","DEBT_ADD"].includes(type)) {
      return res.status(400).json({ error: "Geçersiz type" });
    }

    const cid = Number(companyId || 0);
    const bid = branchId ? Number(branchId) : null;
    if (!cid) return res.status(400).json({ error: "Firma seç" });

    const c = await pool.query(
      `SELECT price_per_pack FROM companies WHERE id=$1 AND is_active=true`,
      [cid]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });
    const unitPrice = Number(c.rows[0].price_per_pack || 0);

    if (bid) {
      const b = await pool.query(
        `SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active=true`,
        [bid, cid]
      );
      if (b.rowCount === 0) return res.status(400).json({ error: "Şube bu firmaya ait değil" });
    }

    const p = Number(packs || 0);
    const a = Number(amount || 0);

    let packsFinal = 0;
    let unitPriceFinal = 0;
    let amountSigned = 0;

    if (type === "PAYMENT") {
      if (p <= 0) return res.status(400).json({ error: "Tahsilat için paket gir" });
      packsFinal = p;
      unitPriceFinal = unitPrice;
      amountSigned = -Math.abs(p * unitPrice);
    } else if (type === "DEBT_ADD") {
      if (a <= 0) return res.status(400).json({ error: "Alacak/Veresiye tutarı gir" });
      amountSigned = Math.abs(a);
    } else {
      if (p <= 0) return res.status(400).json({ error: "Paket gir" });
      packsFinal = p;
      unitPriceFinal = unitPrice;
      const base = Math.abs(p * unitPrice);

      if (type === "SALE" || type === "CASH_SALE") amountSigned = base;
      if (type === "RETURN") amountSigned = -base;
    }

    const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

    const r = await pool.query(
      `INSERT INTO ledger_entries(company_id, branch_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, CURRENT_DATE))
       RETURNING *`,
      [cid, bid, type, packsFinal, unitPriceFinal, amountSigned, note || null, Number(req.user.uid), finalDate]
    );

    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Sunucu hatası (ledger)", detail: String(e?.message || e) });
  }
});

// ---- EXPENSES ----
app.post("/expenses", authRequired, async (req, res) => {
  try {
    const { amount, note, entryDate } = req.body;
    const a = Math.abs(Number(amount || 0));
    if (a <= 0) return res.status(400).json({ error: "Gider tutarı gir" });

    const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

    const r = await pool.query(
      `INSERT INTO expense_entries(amount, note, created_by, entry_date)
       VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
       RETURNING *`,
      [a, String(note || ""), Number(req.user.uid), finalDate]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Sunucu hatası (expenses)", detail: String(e?.message || e) });
  }
});

// ---- PRODUCTION ----
app.post("/production", authRequired, async (req, res) => {
  try {
    const { packs, note, entryDate } = req.body;
    const p = Number(packs || 0);
    if (p <= 0) return res.status(400).json({ error: "Üretim paket gir" });

    const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

    const r = await pool.query(
      `INSERT INTO production_entries(packs, note, created_by, entry_date)
       VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
       RETURNING *`,
      [p, note || null, Number(req.user.uid), finalDate]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Sunucu hatası (production)", detail: String(e?.message || e) });
  }
});

// ---- REPORTS (Özet) ----
async function summaryBetween(from, to) {
  const q = async (sql, params) => Number((await pool.query(sql, params)).rows[0].v);

  const cashSales = await q(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='CASH_SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const creditSales = await q(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const debtAdds = await q(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='DEBT_ADD' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  // PAYMENT negatif tutuluyor, raporda pozitif gösteriyoruz
  const payments = await q(
    `SELECT COALESCE(ABS(SUM(amount)),0) v FROM ledger_entries
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const returns = await q(
    `SELECT COALESCE(ABS(SUM(amount)),0) v FROM ledger_entries
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const expenses = await q(
    `SELECT COALESCE(SUM(amount),0) v FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const productionPacks = await q(
    `SELECT COALESCE(SUM(packs),0) v FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const salesTotal = cashSales + creditSales + debtAdds;

  return {
    from, to,
    salesTotal,
    cashSales,
    creditSales,
    debtAdds,
    payments,
    returns,
    expenses,
    productionPacks
  };
}

app.get("/reports/today", authRequired, async (_req, res) => {
  const d = new Date().toISOString().slice(0,10);
  const r = await summaryBetween(d, d);
  res.json(r);
});

app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to formatı YYYY-MM-DD olmalı" });
  }

  const data = await summaryBetween(from, to);
  res.json(data);
});

app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym formatı YYYY-MM olmalı" });

  const from = `${ym}-01`;
  const toQ = await pool.query(
    `SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`,
    [from]
  );
  const to = toQ.rows[0].d.toISOString().slice(0,10);

  const data = await summaryBetween(from, to);
  res.json(data);
});

// ---- REPORTS (Günlük Detay - mağaza/şube) ----
// /reports/day-detail?date=YYYY-MM-DD
app.get("/reports/day-detail", authRequired, async (req, res) => {
  try {
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date formatı YYYY-MM-DD olmalı" });
    }

    const rowsQ = await pool.query(
      `
      SELECT
        c.name AS company_name,
        b.name AS branch_name,

        COALESCE(SUM(CASE WHEN le.entry_type='CASH_SALE' THEN le.amount ELSE 0 END),0) AS cash_sales_amount,
        COALESCE(SUM(CASE WHEN le.entry_type='CASH_SALE' THEN le.packs ELSE 0 END),0) AS cash_sales_packs,

        COALESCE(SUM(CASE WHEN le.entry_type='SALE' THEN le.amount ELSE 0 END),0) AS credit_sales_amount,
        COALESCE(SUM(CASE WHEN le.entry_type='SALE' THEN le.packs ELSE 0 END),0) AS credit_sales_packs,

        COALESCE(ABS(SUM(CASE WHEN le.entry_type='PAYMENT' THEN le.amount ELSE 0 END)),0) AS payments_amount,
        COALESCE(SUM(CASE WHEN le.entry_type='PAYMENT' THEN le.packs ELSE 0 END),0) AS payments_packs,

        COALESCE(ABS(SUM(CASE WHEN le.entry_type='RETURN' THEN le.amount ELSE 0 END)),0) AS returns_amount,
        COALESCE(SUM(CASE WHEN le.entry_type='RETURN' THEN le.packs ELSE 0 END),0) AS returns_packs,

        COALESCE(SUM(CASE WHEN le.entry_type='DEBT_ADD' THEN le.amount ELSE 0 END),0) AS debt_adds_amount

      FROM branches b
      JOIN companies c ON c.id=b.company_id
      LEFT JOIN ledger_entries le
        ON le.branch_id=b.id
       AND le.entry_date=$1::date

      WHERE b.is_active=true AND c.is_active=true
      GROUP BY c.name, b.name
      ORDER BY c.name, b.name
      `,
      [date]
    );

    const totalsQ = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN entry_type='CASH_SALE' THEN amount ELSE 0 END),0) AS cash_sales_amount,
        COALESCE(SUM(CASE WHEN entry_type='CASH_SALE' THEN packs ELSE 0 END),0) AS cash_sales_packs,

        COALESCE(SUM(CASE WHEN entry_type='SALE' THEN amount ELSE 0 END),0) AS credit_sales_amount,
        COALESCE(SUM(CASE WHEN entry_type='SALE' THEN packs ELSE 0 END),0) AS credit_sales_packs,

        COALESCE(ABS(SUM(CASE WHEN entry_type='PAYMENT' THEN amount ELSE 0 END)),0) AS payments_amount,
        COALESCE(SUM(CASE WHEN entry_type='PAYMENT' THEN packs ELSE 0 END),0) AS payments_packs,

        COALESCE(ABS(SUM(CASE WHEN entry_type='RETURN' THEN amount ELSE 0 END)),0) AS returns_amount,
        COALESCE(SUM(CASE WHEN entry_type='RETURN' THEN packs ELSE 0 END),0) AS returns_packs,

        COALESCE(SUM(CASE WHEN entry_type='DEBT_ADD' THEN amount ELSE 0 END),0) AS debt_adds_amount
      FROM ledger_entries
      WHERE entry_date=$1::date
      `,
      [date]
    );

    const t = totalsQ.rows[0];

    res.json({
      date,
      totals: {
        cashSalesAmount: Number(t.cash_sales_amount || 0),
        cashSalesPacks: Number(t.cash_sales_packs || 0),
        creditSalesAmount: Number(t.credit_sales_amount || 0),
        creditSalesPacks: Number(t.credit_sales_packs || 0),
        paymentsAmount: Number(t.payments_amount || 0),
        paymentsPacks: Number(t.payments_packs || 0),
        returnsAmount: Number(t.returns_amount || 0),
        returnsPacks: Number(t.returns_packs || 0),
        debtAddsAmount: Number(t.debt_adds_amount || 0),
      },
      rows: rowsQ.rows.map(r => ({
        company_name: r.company_name,
        branch_name: r.branch_name,
        cash_sales_amount: Number(r.cash_sales_amount || 0),
        cash_sales_packs: Number(r.cash_sales_packs || 0),
        credit_sales_amount: Number(r.credit_sales_amount || 0),
        credit_sales_packs: Number(r.credit_sales_packs || 0),
        payments_amount: Number(r.payments_amount || 0),
        payments_packs: Number(r.payments_packs || 0),
        returns_amount: Number(r.returns_amount || 0),
        returns_packs: Number(r.returns_packs || 0),
        debt_adds_amount: Number(r.debt_adds_amount || 0),
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "Sunucu hatası (day-detail)", detail: String(e?.message || e) });
  }
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// root -> UI
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(process.env.PORT || 3000, () => console.log("API up"));
