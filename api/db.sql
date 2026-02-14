BEGIN;

-- Önce view'ları kaldır
DROP VIEW IF EXISTS company_balances CASCADE;
DROP VIEW IF EXISTS branch_balances CASCADE;

-- Tabloları kaldır (temiz kurulum)
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS expense_entries CASCADE;
DROP TABLE IF EXISTS production_entries CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Kullanıcılar
CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('ADMIN','STAFF_CASH','STAFF')),
  pin_hash     text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Ana firmalar
CREATE TABLE companies (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Şubeler
CREATE TABLE branches (
  id             bigserial PRIMARY KEY,
  company_id     bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,                       -- "Kesikbaş"
  full_name      text NOT NULL,                       -- "İyaş / Kesikbaş"
  phone          text,
  price_per_pack numeric(12,2) NOT NULL DEFAULT 0,    -- şube bazlı fiyat
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);

-- İşlemler artık customer_id değil branch_id ile
CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  branch_id    bigint NOT NULL REFERENCES branches(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('SALE','PAYMENT','RETURN')),
  packs        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_entries (
  id           bigserial PRIMARY KEY,
  amount       numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE production_entries (
  id           bigserial PRIMARY KEY,
  packs        numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Performans için index
CREATE INDEX idx_ledger_branch_date ON ledger_entries(branch_id, entry_date);
CREATE INDEX idx_ledger_date ON ledger_entries(entry_date);
CREATE INDEX idx_branch_company ON branches(company_id);

-- Şube bakiye görünümü
CREATE OR REPLACE VIEW branch_balances AS
SELECT
  b.id AS branch_id,
  COALESCE(SUM(le.amount), 0) AS balance
FROM branches b
LEFT JOIN ledger_entries le ON le.branch_id = b.id
WHERE b.is_active = true
GROUP BY b.id;

-- Firma toplam bakiye görünümü (şubelerin toplamı)
CREATE OR REPLACE VIEW company_balances AS
SELECT
  c.id AS company_id,
  COALESCE(SUM(le.amount), 0) AS balance
FROM companies c
LEFT JOIN branches b ON b.company_id = c.id AND b.is_active = true
LEFT JOIN ledger_entries le ON le.branch_id = b.id
WHERE c.is_active = true
GROUP BY c.id;

COMMIT;
