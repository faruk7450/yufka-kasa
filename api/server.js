import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

/** ---------------- CORS ---------------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      return cb(null, allowedOrigins.includes(origin));
    },
  })
);

/** -------------- Rate limit (basit) -------------- */
const hits = new Map(); // key -> {c, t}
app.use((req, res, next) => {
  const key = req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.ip;
  const now = Date.now();
  const row = hits.get(key) || { c: 0, t: now };
  if (now - row.t > 60_000) {
    row.c = 0;
    row.t = now;
  }
  row.c += 1;
  hits.set(key, row);
  if (row.c > 300) return res.status(429).json({ error: "Çok fazla istek" });
  next();
});

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE_VERIFY === "1" ? { rejectUnauthorized: false } : undefined,
});

/** ---------------- JWT ---------------- */
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TOKEN_TTL = "30d";

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
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

/** ---------------- Static UI ---------------- */
app.use(express.static(new URL("./public/", import.meta.url).pathname));

/** ---------------- AUTH ----------------
 * Kullanıcılar DB’de varsa devam.
 * Yoksa sadece ilk kurulum için env’den ekleyebiliriz.
 */
async function ensureUsersOnce() {
  const r = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (r.rows[0].n > 0) return;

  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  await pool.query(
    `INSERT INTO users(name, role, pin_hash) VALUES
     ('Admin','ADMIN',$1),
     ('Personel-1','STAFF_CASH',$2),
     ('Personel-2','STAFF',$3)`,
    [await bcrypt.hash(adminPin, 10), await bcrypt.hash(staffCashPin, 10), await bcrypt.hash(staffPin, 10)]
  );
}
ensureUsersOnce().catch(() => {});

/** Login */
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

  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role } });
});

/** ---------------- FİRMA (customers) ---------------- */
app.get("/companies", authRequired, async (_req, res) => {
  const r = await pool.query(`
    SELECT c.id, c.name, c.phone, c.price_per_pack,
           COALESCE(b.balance,0) AS balance
    FROM customers c
    LEFT JOIN customer_balances b ON b.customer_id=c.id
    WHERE c.is_active=true
    ORDER BY c.name
  `);
  res.json(r.rows);
});

app.post("/companies", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `INSERT INTO customers(name, phone, price_per_pack)
     VALUES($1,$2,$3) RETURNING *`,
    [nm, phone || null, Number(pricePerPack || 0)]
  );

  // default şube
  await pool.query(`INSERT INTO branches(customer_id, name) VALUES($1,'Merkez') ON CONFLICT DO NOTHING`, [
    r.rows[0].id,
  ]);

  res.json(r.rows[0]);
});

app.put("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `UPDATE customers
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
  const r = await pool.query(`UPDATE customers SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "Firma bulunamadı" });
  res.json({ ok: true });
});

/** ---------------- ŞUBE ---------------- */
app.get("/companies/:id/branches", authRequired, async (req, res) => {
  const companyId = Number(req.params.id);
  const r = await pool.query(
    `SELECT id, name
     FROM branches
     WHERE customer_id=$1 AND is_active=true
     ORDER BY name`,
    [companyId]
  );
  res.json(r.rows);
});

app.post("/companies/:id/branches", authRequired, requireRole("ADMIN"), async (req, res) => {
  const companyId = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const r = await pool.query(
    `INSERT INTO branches(customer_id, name)
     VALUES($1,$2)
     ON CONFLICT(customer_id, name) DO UPDATE SET is_active=true
     RETURNING *`,
    [companyId, name]
  );
  res.json(r.rows[0]);
});

app.put("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const r = await pool.query(
    `UPDATE branches SET name=$1 WHERE id=$2 AND is_active=true RETURNING *`,
    [name, id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json(r.rows[0]);
});

app.delete("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(`UPDATE branches SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`, [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json({ ok: true });
});

/** ---------------- LEDGER ----------------
 * type:
 * SALE        -> veresiye satış (packs * fiyat)   (+)
 * CASH_SALE   -> peşin satış (SALE + PAYMENT aynı anda)
 * DEBIT       -> alacak/veresiye tutar girişi    (+amount)
 * PAYMENT     -> tahsilat                         (-amount)
 * RETURN      -> iade                             (-(packs*fiyat))
 */
async function getCompany(companyId) {
  const r = await pool.query(
    `SELECT id, price_per_pack FROM customers WHERE id=$1 AND is_active=true`,
    [companyId]
  );
  return r.rowCount ? r.rows[0] : null;
}
async function getBranch(branchId, companyId) {
  const r = await pool.query(
    `SELECT id FROM branches WHERE id=$1 AND customer_id=$2 AND is_active=true`,
    [branchId, companyId]
  );
  return r.rowCount ? r.rows[0] : null;
}

app.post("/ledger", authRequired, async (req, res) => {
  const { companyId, branchId, type, packs, amount, note, entryDate } = req.body;

  if (!["SALE", "CASH_SALE", "DEBIT", "PAYMENT", "RETURN"].includes(type)) {
    return res.status(400).json({ error: "Geçersiz type" });
  }

  const cid = Number(companyId || 0);
  const bid = Number(branchId || 0);
  if (!cid) return res.status(400).json({ error: "Firma seç" });
  if (!bid) return res.status(400).json({ error: "Şube seç" });

  const company = await getCompany(cid);
  if (!company) return res.status(404).json({ error: "Firma yok" });

  const branch = await getBranch(bid, cid);
  if (!branch) return res.status(404).json({ error: "Şube yok" });

  const unitPrice = Number(company.price_per_pack || 0);
  const p = Number(packs || 0);
  const a = Number(amount || 0);

  // sadece ADMIN geçmiş tarih girebilir
  const finalDate = req.user.role === "ADMIN" && entryDate ? String(entryDate) : null;

  // Transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const createdBy = Number(req.user.uid);
    const nd = note || null;

    const insertOne = async (entryType, packsV, unitV, amountV) => {
      const r = await client.query(
        `INSERT INTO ledger_entries(customer_id, branch_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, CURRENT_DATE))
         RETURNING *`,
        [cid, bid, entryType, packsV, unitV, amountV, nd, createdBy, finalDate]
      );
      return r.rows[0];
    };

    let out = null;

    if (type === "PAYMENT") {
      if (a <= 0) return res.status(400).json({ error: "Tahsilat tutarı gir" });
      out = await insertOne("PAYMENT", 0, 0, -Math.abs(a));
    }

    if (type === "DEBIT") {
      if (a <= 0) return res.status(400).json({ error: "Alacak tutarı gir" });
      out = await insertOne("DEBIT", 0, 0, Math.abs(a));
    }

    if (type === "SALE") {
      if (p <= 0) return res.status(400).json({ error: "Paket gir" });
      out = await insertOne("SALE", p, unitPrice, Math.abs(p * unitPrice));
    }

    if (type === "RETURN") {
      if (p <= 0) return res.status(400).json({ error: "Paket gir" });
      out = await insertOne("RETURN", p, unitPrice, -Math.abs(p * unitPrice));
    }

    if (type === "CASH_SALE") {
      if (p <= 0) return res.status(400).json({ error: "Paket gir" });
      const sale = await insertOne("SALE", p, unitPrice, Math.abs(p * unitPrice));
      const pay = await insertOne("PAYMENT", 0, 0, -Math.abs(p * unitPrice));
      out = { cashSale: true, sale, payment: pay };
    }

    await client.query("COMMIT");
    res.json(out);
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Ledger kayıt hatası" });
  } finally {
    client.release();
  }
});

/** ---------------- EXPENSES ---------------- */
app.post("/expenses", authRequired, async (req, res) => {
  const { amount, note, entryDate } = req.body;
  const a = Math.abs(Number(amount || 0));
  if (a <= 0) return res.status(400).json({ error: "Gider tutarı gir" });

  const finalDate = req.user.role === "ADMIN" && entryDate ? String(entryDate) : null;

  const r = await pool.query(
    `INSERT INTO expense_entries(amount, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [a, String(note || ""), Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

/** ---------------- PRODUCTION ---------------- */
app.post("/production", authRequired, async (req, res) => {
  const { packs, note, entryDate } = req.body;
  const p = Number(packs || 0);
  if (p <= 0) return res.status(400).json({ error: "Üretim paket gir" });

  const finalDate = req.user.role === "ADMIN" && entryDate ? String(entryDate) : null;

  const r = await pool.query(
    `INSERT INTO production_entries(packs, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [p, note || null, Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

/** ---------------- REPORTS ---------------- */
async function summaryBetween(from, to) {
  // satış = SALE + DEBIT (ikisi de borç artırır)
  const sales = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM ledger_entries
     WHERE entry_type='SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const debit = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM ledger_entries
     WHERE entry_type='DEBIT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const payments = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM ledger_entries
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const returns = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM ledger_entries
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const expenses = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const production = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs
     FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  return {
    from,
    to,
    sales: Number(sales.rows[0].total),
    debit: Number(debit.rows[0].total),
    payments: Number(payments.rows[0].total), // negatif
    returns: Number(returns.rows[0].total),   // negatif
    expenses: Number(expenses.rows[0].total),
    productionPacks: Number(production.rows[0].packs),
  };
}

app.get("/reports/today", authRequired, async (_req, res) => {
  const r = await pool.query(
    `SELECT CURRENT_DATE::text AS d`
  );
  const d = r.rows[0].d;
  res.json(await summaryBetween(d, d));
});

app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to formatı YYYY-MM-DD olmalı" });
  }
  res.json(await summaryBetween(from, to));
});

app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym formatı YYYY-MM olmalı" });

  const from = `${ym}-01`;
  const toQ = await pool.query(
    `SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`,
    [from]
  );
  const to = toQ.rows[0].d.toISOString().slice(0, 10);

  res.json(await summaryBetween(from, to));
});

/** Firma toplamı + seçili şube bakiye */
app.get("/balances", authRequired, async (req, res) => {
  const companyId = Number(req.query.companyId || 0);
  const branchId = Number(req.query.branchId || 0);
  if (!companyId) return res.status(400).json({ error: "companyId gerekli" });

  const company = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS b
     FROM ledger_entries
     WHERE customer_id=$1`,
    [companyId]
  );

  let branch = { b: 0 };
  if (branchId) {
    const br = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS b
       FROM ledger_entries
       WHERE customer_id=$1 AND branch_id=$2`,
      [companyId, branchId]
    );
    branch = br.rows[0];
  }

  res.json({ companyBalance: Number(company.rows[0].b), branchBalance: Number(branch.b) });
});

/** health */
app.get("/health", (_req, res) => res.json({ ok: true }));

/** root -> UI */
app.get("/", (_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url)));

app.listen(process.env.PORT || 3000, () => console.log("API up"));
