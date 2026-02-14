import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// ---- CORS (güvenlik) ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl vs.
      if (allowedOrigins.length === 0) return cb(null, true);
      return cb(null, allowedOrigins.includes(origin));
    },
  })
);

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok. Render env içine koymalısın.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL_DISABLE_VERIFY === "1"
      ? { rejectUnauthorized: false }
      : undefined,
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
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "Yetki yok" });
    next();
  };
}

// ---- DB init (sıfır kurulum) ----
async function initDb() {
  const fs = await import("fs");
  const sql = fs.readFileSync(new URL("./db.sql", import.meta.url), "utf8");
  await pool.query(sql);

  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  const adminHash = await bcrypt.hash(adminPin, 10);
  const cashHash = await bcrypt.hash(staffCashPin, 10);
  const staffHash = await bcrypt.hash(staffPin, 10);

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Admin', 'ADMIN', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN');`,
    [adminHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel-1', 'STAFF_CASH', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF_CASH');`,
    [cashHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel-2', 'STAFF', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF');`,
    [staffHash]
  );
}

initDb().catch((e) => console.error("DB init hata:", e));

// ---- Static UI ----
app.use(express.static(new URL("./public/", import.meta.url).pathname));

// ---- AUTH ----
app.post("/auth/login", async (req, res) => {
  const pin = String(req.body?.pin || "");
  if (!pin) return res.status(400).json({ error: "PIN gerekli" });

  const r = await pool.query(
    `SELECT id, name, role, pin_hash, is_active
     FROM users
     WHERE is_active=true
     ORDER BY id ASC`
  );

  const user = r.rows.find((u) => bcrypt.compareSync(pin, u.pin_hash));
  if (!user) return res.status(401).json({ error: "Hatalı PIN" });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// =====================================================
//  COMPANIES + BRANCHES (Firma / Şube)
// =====================================================

// Firmalar (liste)
app.get("/companies", authRequired, async (_req, res) => {
  const r = await pool.query(
    `SELECT id, name
     FROM companies
     WHERE is_active=true
     ORDER BY name`
  );
  res.json(r.rows);
});

// Firma ekle (ADMIN)
app.post("/companies", authRequired, requireRole("ADMIN"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `INSERT INTO companies(name) VALUES($1)
     ON CONFLICT (name) DO UPDATE SET is_active=true
     RETURNING *`,
    [name]
  );
  res.json(r.rows[0]);
});

// Firma sil (soft)
app.delete(
  "/companies/:id",
  authRequired,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = Number(req.params.id);
    const r = await pool.query(
      `UPDATE companies SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
      [id]
    );
    if (r.rowCount === 0)
      return res.status(404).json({ error: "Firma bulunamadı" });
    res.json({ ok: true });
  }
);

// Şubeler: firmaya göre liste (dropdown için)
app.get("/branches", authRequired, async (req, res) => {
  const companyId = Number(req.query.companyId || 0);
  if (!companyId) return res.status(400).json({ error: "companyId gerekli" });

  const r = await pool.query(
    `SELECT id, company_id, name, full_name, phone, price_per_pack
     FROM branches
     WHERE is_active=true AND company_id=$1
     ORDER BY name`,
    [companyId]
  );
  res.json(r.rows);
});

// Tüm şubeler (admin ekranı için)
app.get("/branches/all", authRequired, requireRole("ADMIN"), async (_req, res) => {
  const r = await pool.query(
    `SELECT b.id, b.company_id, c.name AS company_name,
            b.name, b.full_name, b.phone, b.price_per_pack,
            COALESCE(bb.balance,0) AS balance
     FROM branches b
     JOIN companies c ON c.id=b.company_id
     LEFT JOIN branch_balances bb ON bb.branch_id=b.id
     WHERE b.is_active=true AND c.is_active=true
     ORDER BY c.name, b.name`
  );
  res.json(r.rows);
});

// Şube ekle (ADMIN)
app.post("/branches", authRequired, requireRole("ADMIN"), async (req, res) => {
  const companyId = Number(req.body?.companyId || 0);
  const name = String(req.body?.name || "").trim(); // "Kesikbaş"
  const phone = req.body?.phone ? String(req.body.phone).trim() : null;
  const pricePerPack = Number(req.body?.pricePerPack || 0);

  if (!companyId) return res.status(400).json({ error: "companyId gerekli" });
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const c = await pool.query(
    `SELECT id, name FROM companies WHERE id=$1 AND is_active=true`,
    [companyId]
  );
  if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });

  const companyName = c.rows[0].name;
  const fullName = `${companyName} / ${name}`;

  const r = await pool.query(
    `INSERT INTO branches(company_id, name, full_name, phone, price_per_pack)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (company_id, name) DO UPDATE
       SET is_active=true, full_name=EXCLUDED.full_name, phone=EXCLUDED.phone, price_per_pack=EXCLUDED.price_per_pack
     RETURNING *`,
    [companyId, name, fullName, phone, pricePerPack]
  );

  res.json(r.rows[0]);
});

// Şube güncelle (ADMIN)
app.put("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  const phone = req.body?.phone ? String(req.body.phone).trim() : null;
  const pricePerPack = Number(req.body?.pricePerPack || 0);

  const b = await pool.query(
    `SELECT b.id, b.company_id, c.name AS company_name
     FROM branches b JOIN companies c ON c.id=b.company_id
     WHERE b.id=$1 AND b.is_active=true`,
    [id]
  );
  if (b.rowCount === 0) return res.status(404).json({ error: "Şube yok" });

  const companyName = b.rows[0].company_name;
  const fullName = `${companyName} / ${name}`;

  const r = await pool.query(
    `UPDATE branches
     SET name=$1, full_name=$2, phone=$3, price_per_pack=$4
     WHERE id=$5 AND is_active=true
     RETURNING *`,
    [name, fullName, phone, pricePerPack, id]
  );
  res.json(r.rows[0]);
});

// Şube sil (soft) (ADMIN)
app.delete("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE branches SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json({ ok: true });
});

// =====================================================
//  LEDGER (satış/tahsilat/iade) artık branch_id ile
// =====================================================
app.post("/ledger", authRequired, async (req, res) => {
  const { branchId, type, packs, note, entryDate, amount } = req.body;

  if (!["SALE", "PAYMENT", "RETURN"].includes(type)) {
    return res.status(400).json({ error: "Geçersiz type" });
  }

  const b = await pool.query(
    `SELECT price_per_pack FROM branches WHERE id=$1 AND is_active=true`,
    [Number(branchId)]
  );
  if (b.rowCount === 0) return res.status(404).json({ error: "Şube yok" });

  const unitPrice = Number(b.rows[0].price_per_pack);
  const p = Number(packs || 0);
  const rawAmount = Number(amount || 0);

  let amountSigned = 0;
  let packsFinal = 0;
  let unitPriceFinal = 0;

  if (type === "PAYMENT") {
    amountSigned = -Math.abs(rawAmount);
  } else if (type === "SALE") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = Math.abs(p * unitPrice);
  } else if (type === "RETURN") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = -Math.abs(p * unitPrice);
  }

  const finalDate = req.user.role === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO ledger_entries(branch_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
     VALUES($1,$2,$3,$4,$5,$6,$7, COALESCE($8, CURRENT_DATE))
     RETURNING *`,
    [
      Number(branchId),
      type,
      packsFinal,
      unitPriceFinal,
      amountSigned,
      note || null,
      Number(req.user.uid),
      finalDate,
    ]
  );

  res.json(r.rows[0]);
});

// ---- EXPENSES ----
app.post("/expenses", authRequired, async (req, res) => {
  const { amount, note, entryDate } = req.body;
  const finalDate = req.user.role === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO expense_entries(amount, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Math.abs(Number(amount || 0)), String(note || ""), Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// ---- PRODUCTION ----
app.post("/production", authRequired, async (req, res) => {
  const { packs, note, entryDate } = req.body;
  const finalDate = req.user.role === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO production_entries(packs, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Number(packs || 0), note || null, Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// =====================================================
// REPORTS (Bugün / Ay / Tarih Arası) + firma/şube kırılım
// =====================================================

async function summaryBetween(from, to) {
  const sales = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const payments = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const returns = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const expenses = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const production = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  return {
    from,
    to,
    sales: Number(sales.rows[0].total),
    payments: Number(payments.rows[0].total),
    returns: Number(returns.rows[0].total),
    expenses: Number(expenses.rows[0].total),
    productionPacks: Number(production.rows[0].packs),
  };
}

// Tarih arası firma/şube kırılımı
async function breakdownBetween(from, to) {
  const byBranch = await pool.query(
    `
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      b.id AS branch_id,
      b.name AS branch_name,
      b.full_name,
      COALESCE(SUM(CASE WHEN le.entry_type='SALE'   THEN le.amount ELSE 0 END),0) AS sales,
      COALESCE(SUM(CASE WHEN le.entry_type='PAYMENT' THEN le.amount ELSE 0 END),0) AS payments,
      COALESCE(SUM(CASE WHEN le.entry_type='RETURN' THEN le.amount ELSE 0 END),0) AS returns,
      COALESCE(SUM(le.amount),0) AS net
    FROM ledger_entries le
    JOIN branches b ON b.id=le.branch_id
    JOIN companies c ON c.id=b.company_id
    WHERE le.entry_date BETWEEN $1 AND $2
      AND b.is_active=true AND c.is_active=true
    GROUP BY c.id, c.name, b.id, b.name, b.full_name
    ORDER BY c.name, b.name
    `,
    [from, to]
  );

  const byCompany = await pool.query(
    `
    SELECT
      c.id AS company_id,
      c.name AS company_name,
      COALESCE(SUM(CASE WHEN le.entry_type='SALE'   THEN le.amount ELSE 0 END),0) AS sales,
      COALESCE(SUM(CASE WHEN le.entry_type='PAYMENT' THEN le.amount ELSE 0 END),0) AS payments,
      COALESCE(SUM(CASE WHEN le.entry_type='RETURN' THEN le.amount ELSE 0 END),0) AS returns,
      COALESCE(SUM(le.amount),0) AS net
    FROM ledger_entries le
    JOIN branches b ON b.id=le.branch_id
    JOIN companies c ON c.id=b.company_id
    WHERE le.entry_date BETWEEN $1 AND $2
      AND b.is_active=true AND c.is_active=true
    GROUP BY c.id, c.name
    ORDER BY c.name
    `,
    [from, to]
  );

  return { byCompany: byCompany.rows, byBranch: byBranch.rows };
}

app.get("/reports/today", authRequired, async (_req, res) => {
  const s = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='SALE' AND entry_date=CURRENT_DATE`
  );
  const p = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='PAYMENT' AND entry_date=CURRENT_DATE`
  );
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='RETURN' AND entry_date=CURRENT_DATE`
  );
  const e = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expense_entries WHERE entry_date=CURRENT_DATE`
  );
  const pr = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs FROM production_entries WHERE entry_date=CURRENT_DATE`
  );

  const br = await breakdownBetween(
    new Date().toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10)
  );

  res.json({
    sales: Number(s.rows[0].total),
    payments: Number(p.rows[0].total),
    returns: Number(r.rows[0].total),
    expenses: Number(e.rows[0].total),
    productionPacks: Number(pr.rows[0].packs),
    breakdown: br,
  });
});

app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to formatı YYYY-MM-DD olmalı" });
  }

  const data = await summaryBetween(from, to);
  const br = await breakdownBetween(from, to);

  res.json({ ...data, breakdown: br });
});

app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym))
    return res.status(400).json({ error: "ym formatı YYYY-MM olmalı" });

  const from = `${ym}-01`;
  const toQ = await pool.query(
    `SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`,
    [from]
  );
  const to = toQ.rows[0].d.toISOString().slice(0, 10);

  const data = await summaryBetween(from, to);
  const br = await breakdownBetween(from, to);

  res.json({ ...data, breakdown: br });
});

// ---- BALANCES (güncel bakiyeler) ----
app.get("/balances/companies", authRequired, async (_req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.name, COALESCE(cb.balance,0) AS balance
     FROM companies c
     LEFT JOIN company_balances cb ON cb.company_id=c.id
     WHERE c.is_active=true
     ORDER BY c.name`
  );
  res.json(r.rows);
});

app.get("/balances/branches", authRequired, async (req, res) => {
  const companyId = Number(req.query.companyId || 0);
  if (!companyId) return res.status(400).json({ error: "companyId gerekli" });

  const r = await pool.query(
    `SELECT b.id, b.name, b.full_name, COALESCE(bb.balance,0) AS balance
     FROM branches b
     LEFT JOIN branch_balances bb ON bb.branch_id=b.id
     WHERE b.is_active=true AND b.company_id=$1
     ORDER BY b.name`,
    [companyId]
  );
  res.json(r.rows);
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// root -> UI
app.get("/", (_req, res) =>
  res.sendFile(new URL("./public/index.html", import.meta.url))
);

app.listen(process.env.PORT || 3000, () => console.log("API up"));
