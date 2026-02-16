/* =========================
   Yufka Kasa - app.js
   Paket gir -> tutarı otomatik hesapla (satışlarda)
   await sadece async fonksiyonlarda (syntax error yok)
========================= */

let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id) { return document.getElementById(id); }

function setMsg(el, text, ok = true) {
  if (!el) return;
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

function todayYMD() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10); // yyyy-mm-dd
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "Hata");
  return data;
}

function fmt(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

/* ========= DB enum mapping (check constraint için) =========
   UI text -> DB entry_type
   NOT: DB’de izinli değerler bunlar olmalı:
   SALE_CREDIT, SALE_CASH, RECEIVABLE, COLLECTION, RETURN
*/
const ENTRY_TYPE_MAP = {
  "SATIŞ (Veresiye)": "SALE_CREDIT",
  "PEŞİN SATIŞ": "SALE_CASH",
  "ALACAK / VERESİYE (Tutar)": "RECEIVABLE",
  "TAHSİLAT (Tutar)": "COLLECTION",
  "İADE": "RETURN",
};

/* ========= UI show/hide ========= */

function showLoggedOut() {
  $("loginCard")?.classList.remove("hidden");
  $("mainCard")?.classList.add("hidden");
  $("reportsCard")?.classList.add("hidden");
  $("opsCard")?.classList.add("hidden");
  $("adminCard")?.classList.add("hidden");
}

function showLoggedIn() {
  $("loginCard")?.classList.add("hidden");
  $("mainCard")?.classList.remove("hidden");
  $("reportsCard")?.classList.remove("hidden");
  $("opsCard")?.classList.remove("hidden");

  const isAdmin = me?.role === "ADMIN";
  if (isAdmin) $("adminCard")?.classList.remove("hidden");
  else $("adminCard")?.classList.add("hidden");

  if ($("userPin")) {
    $("userPin").textContent = `Giriş: ${me?.name || ""} (${me?.role || ""})`;
  }
}

function initDates() {
  const ymd = todayYMD();

  // işlem tarihleri (her girişte bugüne gelsin)
  ["ledgerDate", "expDate", "prodDate"].forEach((id) => {
    const el = $(id);
    if (el) el.value = ymd;
  });

  // rapor tarihleri
  if ($("fromDate")) $("fromDate").value = ymd;
  if ($("toDate")) $("toDate").value = ymd;
  if ($("ym")) $("ym").value = ymd.slice(0, 7);
}

/* ========= Companies / Branches ========= */

let companies = [];
let branches = [];

function getSelectedCompany() {
  const id = Number($("companySelect")?.value || 0);
  return companies.find(c => Number(c.id) === id) || null;
}

async function loadCompanies() {
  companies = await api("/companies");
  const sel = $("companySelect");
  if (!sel) return;

  sel.innerHTML = "";
  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    const balance = (c.balance != null) ? fmt(c.balance) : "0.00";
    opt.textContent = `${c.name} (Bakiye: ${balance})`;
    sel.appendChild(opt);
  }

  if (companies.length) {
    sel.value = String(companies[0].id);
    await loadBranches();
  }
}

async function loadBranches() {
  const companyId = Number($("companySelect")?.value || 0);
  const sel = $("branchSelect");
  if (!sel) return;

  sel.innerHTML = "";
  branches = [];
  if (!companyId) return;

  branches = await api(`/companies/${companyId}/branches`);
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = String(b.id);
    opt.textContent = b.full_name || b.name;
    sel.appendChild(opt);
  }

  if (branches.length) sel.value = String(branches[0].id);
}

/* ========= Paket -> Tutar otomatik =========
   Satışlarda: amount = packs * company.price
*/
function updateAutoAmountFromPacks() {
  const selectedText = $("ledgerType")?.value || "";
  const entryType = ENTRY_TYPE_MAP[selectedText] || selectedText;

  // sadece satış/iade (paket bazlı) otomatik hesap
  const packBased = (entryType === "SALE_CREDIT" || entryType === "SALE_CASH" || entryType === "RETURN");

  const packsEl = $("ledgerPacks");
  const amountEl = $("ledgerAmount");
  if (!packsEl || !amountEl) return;

  if (!packBased) return;

  const packs = Number(packsEl.value || 0);
  const company = getSelectedCompany();
  const price = Number(company?.price || company?.unit_price || 0);

  const amount = packs * price;
  amountEl.value = amount ? String(amount) : "0";
}

/* ========= Ledger fields visibility =========
   Senin isteğin: satışlarda paket girilsin, tutar otomatik.
   Alacak/Tahsilat: tutar girilsin.
*/
function toggleLedgerFields() {
  const selectedText = $("ledgerType")?.value || "";
  const entryType = ENTRY_TYPE_MAP[selectedText] || selectedText;

  const packBased = (entryType === "SALE_CREDIT" || entryType === "SALE_CASH" || entryType === "RETURN");
  const moneyBased = (entryType === "RECEIVABLE" || entryType === "COLLECTION");

  const packsWrap = $("ledgerPacksWrap") || $("ledgerPacks")?.parentElement;
  const amountWrap = $("ledgerAmountWrap") || $("ledgerAmount")?.parentElement;

  if (packsWrap) packsWrap.style.display = packBased ? "inline-block" : "none";
  if (amountWrap) amountWrap.style.display = moneyBased ? "inline-block" : "none";

  // paket bazlıda tutar otomatik hesaplanacağı için amount input’u gizliysek bile value güncellensin
  if (packBased) updateAutoAmountFromPacks();
}

/* ========= Save ledger ========= */

async function saveLedger() {
  try {
    const selectedText = $("ledgerType")?.value || "";
    const entryType = ENTRY_TYPE_MAP[selectedText] || selectedText;

    const companyId = Number($("companySelect")?.value || 0);
    const branchId = Number($("branchSelect")?.value || 0);

    const packs = Number($("ledgerPacks")?.value || 0);
    const manualAmount = Number($("ledgerAmount")?.value || 0);

    const note = $("ledgerNote")?.value || null;
    const entryDate = $("ledgerDate")?.value || null;

    if (!companyId) return alert("Firma seç");
    if (!branchId) return alert("Şube seç");
    if (!entryDate) return alert("Tarih seç");

    // Paket bazlı: SALE_CREDIT / SALE_CASH / RETURN
    if (entryType === "SALE_CREDIT" || entryType === "SALE_CASH" || entryType === "RETURN") {
      if (packs <= 0) return alert("Paket gir (0'dan büyük)");
      const company = getSelectedCompany();
      const price = Number(company?.price || company?.unit_price || 0);
      if (!price) return alert("Firma fiyatı (price) tanımlı değil. Admin'den fiyat gir.");

      // otomatik tutar
      const amount = packs * price;

      await api("/ledger", {
        method: "POST",
        body: JSON.stringify({
          type: entryType,
          companyId,
          branchId,
          packs,
          amount,
          note,
          entryDate,
        })
      });

      setMsg($("opMsg"), "İşlem kaydedildi ✅", true);
      if ($("ledgerPacks")) $("ledgerPacks").value = "";
      if ($("ledgerNote")) $("ledgerNote").value = "";

      await loadCompanies();   // bakiye güncellensin
      await reportToday();     // üst rapor güncellensin
      return;
    }

    // Tutar bazlı: RECEIVABLE / COLLECTION
    if (entryType === "RECEIVABLE" || entryType === "COLLECTION") {
      if (manualAmount <= 0) return alert("Tutar gir (0'dan büyük)");

      await api("/ledger", {
        method: "POST",
        body: JSON.stringify({
          type: entryType,
          companyId,
          branchId,
          packs: 0,
          amount: manualAmount,
          note,
          entryDate,
        })
      });

      setMsg($("opMsg"), "İşlem kaydedildi ✅", true);
      if ($("ledgerAmount")) $("ledgerAmount").value = "";
      if ($("ledgerNote")) $("ledgerNote").value = "";

      await loadCompanies();
      await reportToday();
      return;
    }

    // bilinmeyen type gelirse:
    alert("Bilinmeyen işlem tipi: " + entryType);
  } catch (e) {
    console.error(e);
    alert("Hata: " + (e.message || e));
  }
}

/* ========= Reports ========= */

function renderToday(r) {
  const box = $("todayBox") || $("reportBox");
  if (!box) return;

  box.textContent =
`BUGÜN RAPORU
TOPLAM SATIŞ: ${fmt(r.sales)}
- Veresiye Satış: ${fmt(r.creditSales)}
- Peşin Satış: ${fmt(r.cashSales)}
TAHSİLAT: ${fmt(r.payments)}
İADE: ${fmt(r.returns)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}`;
}

async function reportToday() {
  try {
    const companyId = Number($("companySelect")?.value || 0);
    const branchId = Number($("branchSelect")?.value || 0);
    const date = $("ledgerDate")?.value || todayYMD();

    const r = await api(`/reports/today?companyId=${companyId}&branchId=${branchId}&date=${date}`);
    renderToday(r);
  } catch (e) {
    console.error(e);
    // rapor gelmezse sessiz bırakma; yukarıda gözüksün
    setMsg($("opMsg"), "Rapor alınamadı: " + (e.message || e), false);
  }
}

/* ========= Login ========= */

async function login() {
  try {
    const pin = $("pin")?.value?.trim();
    if (!pin) return alert("PIN gir");

    const out = await api("/login", {
      method: "POST",
      body: JSON.stringify({ pin })
    });

    token = out.token;
    localStorage.setItem("token", token);

    me = await api("/me");
    localStorage.setItem("me", JSON.stringify(me));

    initDates();
    showLoggedIn();

    await loadCompanies();
    toggleLedgerFields();
    await reportToday();
  } catch (e) {
    console.error(e);
    alert("Giriş hatası: " + (e.message || e));
  }
}

function logout() {
  token = "";
  me = null;
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  showLoggedOut();
}

/* ========= Bind events ========= */

function bindUI() {
  $("btnLogin")?.addEventListener("click", login);

  $("companySelect")?.addEventListener("change", async () => {
    await loadBranches();
    toggleLedgerFields();
    await reportToday();
  });

  $("branchSelect")?.addEventListener("change", async () => {
    await reportToday();
  });

  $("ledgerType")?.addEventListener("change", () => {
    toggleLedgerFields();
  });

  $("ledgerPacks")?.addEventListener("input", () => {
    updateAutoAmountFromPacks();
  });

  $("btnSaveLedger")?.addEventListener("click", saveLedger);
  $("btnRefresh")?.addEventListener("click", async () => {
    await loadCompanies();
    await reportToday();
    setMsg($("opMsg"), "Yenilendi ✅", true);
  });

  $("btnLogout")?.addEventListener("click", logout);
}

/* ========= Boot ========= */

document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  initDates();

  // type dropdown defaultları
  if ($("ledgerType") && !$("ledgerType").value) {
    $("ledgerType").value = "PEŞİN SATIŞ";
  }

  try {
    // token varsa otomatik giriş
    if (token) {
      me = await api("/me");
      localStorage.setItem("me", JSON.stringify(me));
      showLoggedIn();
      await loadCompanies();
      toggleLedgerFields();
      await reportToday();
    } else {
      showLoggedOut();
    }
  } catch (e) {
    console.error(e);
    logout();
  }
});
