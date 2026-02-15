BEGIN;

-- 1) Firmalar (Company)
CREATE TABLE IF NOT EXISTS companies (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  phone          text,
  price_per_pack numeric(12,2) NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2) Şubeler (Branch)
CREATE TABLE IF NOT EXISTS branches (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);

-- 3) Yeni ledger tablosu (eskiyi BOZMADAN)
-- entry_type:
-- SALE_CREDIT  : veresiye satış (borç artırır)
-- CASH_SALE    : peşin satış (borç artırmaz ama satış raporuna girer)
-- PAYMENT      : tahsilat (borcu düşürür)
-- RETURN       : iade (borcu düşürür)
-- DEBIT        : alacak/borç düzeltme (manuel borç artır/azalt)
CREATE TABLE IF NOT EXISTS ledger_entries_v2 (
  id           bigserial PRIMARY KEY,
  company_id   bigint NOT NULL REFERENCES companies(id),
  branch_id    bigint REFERENCES branches(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('SALE_CREDIT','CASH_SALE','PAYMENT','RETURN','DEBIT')),
  packs        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_v2_date ON ledger_entries_v2(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_v2_company ON ledger_entries_v2(company_id);
CREATE INDEX IF NOT EXISTS idx_ledger_v2_branch ON ledger_entries_v2(branch_id);

-- 4) Gider/Üretim tabloların varsa kullanıyoruz, yoksa oluşturuyoruz
CREATE TABLE IF NOT EXISTS expense_entries (
  id           bigserial PRIMARY KEY,
  amount       numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_entries (
  id           bigserial PRIMARY KEY,
  packs        numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 5) Firma bakiyesi (veresiye mantığı)
-- CASH_SALE borca yansımaz
CREATE OR REPLACE VIEW company_balances AS
SELECT
  c.id AS company_id,
  COALESCE(SUM(
    CASE le.entry_type
      WHEN 'SALE_CREDIT' THEN le.amount
      WHEN 'PAYMENT'     THEN le.amount
      WHEN 'RETURN'      THEN le.amount
      WHEN 'DEBIT'       THEN le.amount
      ELSE 0
    END
  ),0) AS balance
FROM companies c
LEFT JOIN ledger_entries_v2 le ON le.company_id=c.id
WHERE c.is_active=true
GROUP BY c.id;

COMMIT;
