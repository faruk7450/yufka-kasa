BEGIN;

-- 1) USERS
CREATE TABLE IF NOT EXISTS users (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('ADMIN','STAFF_CASH','STAFF')),
  pin_hash     text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 2) COMPANIES (Firma)
CREATE TABLE IF NOT EXISTS companies (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  phone          text,
  price_per_pack numeric(12,2) NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 3) BRANCHES (Şube)
CREATE TABLE IF NOT EXISTS branches (
  id           bigserial PRIMARY KEY,
  company_id   bigint NOT NULL REFERENCES companies(id),
  name         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);

-- 4) LEDGER
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           bigserial PRIMARY KEY,
  branch_id    bigint REFERENCES branches(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('SALE','PAYMENT','RETURN','DEBT_ADJ')),
  packs        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Eğer eski sistemden gelen customer_id kolonu varsa, dursun; biz branch_id kullanıyoruz.
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS customer_id bigint;

-- 5) EXPENSES
CREATE TABLE IF NOT EXISTS expense_entries (
  id           bigserial PRIMARY KEY,
  amount       numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 6) PRODUCTION
CREATE TABLE IF NOT EXISTS production_entries (
  id           bigserial PRIMARY KEY,
  packs        numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 7) VIEWS: Branch balances
CREATE OR REPLACE VIEW branch_balances AS
SELECT
  b.id AS branch_id,
  COALESCE(SUM(le.amount), 0) AS balance
FROM branches b
LEFT JOIN ledger_entries le ON le.branch_id = b.id
WHERE b.is_active = true
GROUP BY b.id;

-- 8) VIEWS: Company balances (tüm şubeler toplamı)
CREATE OR REPLACE VIEW company_balances AS
SELECT
  co.id AS company_id,
  COALESCE(SUM(le.amount), 0) AS balance
FROM companies co
LEFT JOIN branches b ON b.company_id = co.id AND b.is_active=true
LEFT JOIN ledger_entries le ON le.branch_id = b.id
WHERE co.is_active = true
GROUP BY co.id;

COMMIT;
