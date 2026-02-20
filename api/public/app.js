// public/app.js

let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id) {
  return document.getElementById(id);
}

function todayYMD() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10); // yyyy-mm-dd
}

function setMsg(el, text, ok = true) {
  if (!el) return;
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

async function api(path, opts = {}) {
  const headers = opts.headers || {};
  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Hata");
  return data;
}

function fmt(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

// HTML'deki eski tipleri backend tiplerine çevir
function normalizeType(raw) {
  if (raw === "SALE_CREDIT") return "SALE"; // SATIŞ (Veresiye)
  if (raw === "DEBIT") return "DEBT_ADD";   // ALACAK / VERESİYE (Tutar)
  return raw;                               // CASH_SALE, PAYMENT, RETURN
}

function showLoggedIn() {
  $("loginCard").classList.add("hidden");
  $("mainCard").classList.remove("hidden");
  $("reportsCard").classList.remove("hidden");
  $("opsCard").classList.remove("hidden");

  $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;

  if (me?.role === "ADMIN") $("adminCard").classList.remove("hidden");
  else $("adminCard").classList.add("hidden");
}

function showLoggedOut() {
  $("loginCard").classList.remove("hidden");
  $("mainCard").classList.add("hidden");
  $("reportsCard").classList.add("hidden");
  $("opsCard").classList.add("hidden");
  $("adminCard").classList.add("hidden");
}

function initDates() {
  const ymd = todayYMD();

  ["ledgerDate", "expDate", "prodDate"].forEach(id => {
    const el = $(id);
    if (el) el.value = ymd;
  });

  const from = $("fromDate");
  const to = $("toDate");
  if (from) from.value = ymd;
  if (to) to.value = ymd;

  const ym = $("ym");
  if (ym) ym.value = ymd.slice(0, 7);
}

let companies = [];
let branches = [];

async function loadCompanies() {
  companies = await api("/companies");
  const sel = $("companySelect");
  sel.innerHTML = "";

  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }

  if (companies.length) {
    sel.value = String(companies[0].id);
    await loadBranches();
  } else {
    $("branchSelect").innerHTML = "";
  }
}

async function loadBranches() {
  const companyId = Number($("companySelect").value || 0);
  if (!companyId) return;

  branches = await api(`/companies/${companyId}/branches`);
  const sel = $("branchSelect");
  sel.innerHTML = "";

  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  }

  if (branches.length) sel.value = String(branches[0].id);

  // Admin formunu doldur (fiyat vs)
  const c = companies.find(x => x.id === companyId);
  if (c) {
    $("aCompanyId").value = c.id;
    $("aCompanyName").value = c.name;
    $("aCompanyPhone").value = c.phone || "";
    $("aCompanyPrice").value = c.price_per_pack || 0;
  }

  await refreshTotals();
}

async function refreshTotals() {
  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);

  if (companyId) {
    try {
      const cb = await api(`/balances/company/${companyId}`);
      $("companyTotal").textContent = fmt(cb.balance);
    } catch {
      $("companyTotal").textContent = fmt(0);
    }
  } else {
    $("companyTotal").textContent = fmt(0);
  }

  if (branchId) {
    try {
      const bb = await api(`/balances/branch/${branchId}`);
      $("branchTotal").textContent = fmt(bb.balance);
    } catch {
      $("branchTotal").textContent = fmt(0);
    }
  } else {
    $("branchTotal").textContent = fmt(0);
  }
}

// ---------- RAPORLAR ----------

function renderReport(title, r) {
  const lines = [];
  lines.push(`${title} (${r.from} → ${r.to})`);
  lines.push(`TOPLAM SATIŞ: ${fmt(r.totalSales)} TL`);
  lines.push(`- Peşin Satış: ${fmt(r.cashSales)} TL`);
  lines.push(`- Tahsilat: ${fmt(r.payments)} TL`);
  lines.push(`- Veresiye: ${fmt(r.creditSales)} TL`);
  lines.push(`İADE: ${fmt(r.returns)} TL`);
  lines.push(`GİDER: ${fmt(r.expenses)} TL`);
  lines.push(`ÜRETİM (paket): ${fmt(r.productionPacks)}`);
  lines.push(`SATILAN PAKET (toplam): ${fmt(r.soldPacks)}`);

  $("reportOut").textContent = lines.join("\n");
}

async function reportToday() {
  const r = await api("/reports/today");
  renderReport("BUGÜN RAPORU", r);
}

async function reportRange() {
  const from = $("fromDate").value;
  const to = $("toDate").value;
  const r = await api(
    `/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to
    )}`
  );
  renderReport("RAPOR", r);
}

async function reportMonth() {
  const ym = $("ym").value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
  renderReport("AY RAPORU", r);
}

// ---------- İŞLEM GİRİŞ ----------

// Not: Fiyat için her firma db'deki price_per_pack kullanılıyor.
// Frontend'de sabit fiyat tutmuyoruz.

function toggleLedgerFields() {
  const raw = $("ledgerType").value;
  const t = normalizeType(raw);

  const needPacks = t === "SALE" || t === "CASH_SALE" || t === "RETURN";
  const needAmountManual = t === "PAYMENT" || t === "DEBT_ADD";

  $("ledgerPacks").style.display = needPacks ? "inline-block" : "none";
  $("ledgerAmount").style.display = needAmountManual ? "inline-block" : "none";
}

async function saveLedger() {
  const rawType = $("ledgerType").value;
  const type = normalizeType(rawType);

  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);

  const packs = Number($("ledgerPacks").value || 0);
  let amount = Number($("ledgerAmount").value || 0);

  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId) return alert("Şube seç");

  // Kurallar
  if (type === "CASH_SALE" || type === "SALE" || type === "RETURN") {
    if (packs <= 0) return alert("Paket gir");
    // Tutarı backend firma fiyatına göre hesaplayacak,
    // biz amount = 0 gönderirsek kendisi hesaplıyor.
    amount = 0;
  }

  if (type === "PAYMENT" || type === "DEBT_ADD") {
    if (amount <= 0) return alert("Tutar gir");
  }

  await api("/ledger", {
    method: "POST",
    body: JSON.stringify({
      type,
      companyId,
      branchId,
      packs,
      amount,
      note,
      entryDate
    })
  });

  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);
  $("ledgerPacks").value = "";
  $("ledgerAmount").value = "";
  $("ledgerNote").value = "";

  await refreshTotals();
  await reportToday();
}

async function saveExpense() {
  const amount = Number($("expAmount").value || 0);
  const note = $("expNote").value || "";
  const entryDate = $("expDate").value || null;

  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method: "POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setMsg($("opMsg"), "Gider kaydedildi ✅", true);
  $("expAmount").value = "";
  $("expNote").value = "";
  await reportToday();
}

async function saveProd() {
  const packs = Number($("prodPacks").value || 0);
  const note = $("prodNote").value || null;
  const entryDate = $("prodDate").value || null;

  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method: "POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setMsg($("opMsg"), "Üretim kaydedildi ✅", true);
  $("prodPacks").value = "";
  $("prodNote").value = "";
  await reportToday();
}

// ---------- ADMIN ----------

async function adminSaveCompany() {
  const id = Number($("aCompanyId").value || 0);
  const name = $("aCompanyName").value.trim();
  const phone = $("aCompanyPhone").value.trim();
  const pricePerPack = Number($("aCompanyPrice").value || 0);

  if (!name) return alert("Firma adı yaz");

  if (!id) {
    await api("/companies", {
      method: "POST",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  } else {
    await api(`/companies/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  }

  setMsg($("adminMsg"), "Firma kaydedildi ✅", true);
  await loadCompanies();
}

async function adminDeleteCompany() {
  const id = Number($("aCompanyId").value || 0);
  if (!id) return alert("Firma ID gerekli");
  if (!confirm("Firma pasife alınacak. Emin misin?")) return;

  await api(`/companies/${id}`, { method: "DELETE" });
  setMsg($("adminMsg"), "Firma kaldırıldı ✅", true);
  $("aCompanyId").value = "";
  $("aCompanyName").value = "";
  $("aCompanyPhone").value = "";
  $("aCompanyPrice").value = "";
  await loadCompanies();
}

async function adminAddBranch() {
  const companyId = Number($("companySelect").value || 0);
  const name = $("aBranchName").value.trim();
  if (!companyId) return alert("Firma seç");
  if (!name) return alert("Şube adı yaz");

  await api(`/companies/${companyId}/branches`, {
    method: "POST",
    body: JSON.stringify({ name })
  });

  $("aBranchName").value = "";
  setMsg($("adminMsg"), "Şube eklendi ✅", true);
  await loadBranches();
}

async function adminDeleteBranch() {
  const id = Number($("aBranchId").value || 0);
  if (!id) return alert("Şube ID yaz");
  if (!confirm("Şube pasife alınacak. Emin misin?")) return;

  await api(`/branches/${id}`, { method: "DELETE" });
  $("aBranchId").value = "";
  setMsg($("adminMsg"), "Şube kaldırıldı ✅", true);
  await loadBranches();
}

// ---------- AUTH ----------

async function login() {
  try {
    const pin = $("pin").value;
    const r = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin })
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("token", token);
    localStorage.setItem("me", JSON.stringify(me));
    setMsg($("loginMsg"), "Giriş başarılı ✅", true);

    showLoggedIn();
    applyRoleRestrictions();
    initDates();
    await loadCompanies();
    await reportToday();
  } catch (e) {
    setMsg($("loginMsg"), e.message, false);
  }
}

function logout() {
  token = "";
  me = null;
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  showLoggedOut();
}

// ---------- ROLE KISITLARI ----------

function applyRoleRestrictions() {
  const isAdmin = me?.role === "ADMIN";

  const dateIds = ["ledgerDate", "expDate", "prodDate", "fromDate", "toDate", "ym"];
  dateIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = !isAdmin;
    if (!isAdmin) el.style.opacity = "0.7";
  });

  if (!isAdmin) {
    const btnRange = $("btnRange");
    const btnMonth = $("btnMonth");
    const from = $("fromDate");
    const to = $("toDate");
    const ym = $("ym");

    if (btnRange) btnRange.style.display = "none";
    if (btnMonth) btnMonth.style.display = "none";
    if (from) from.style.display = "none";
    if (to) to.style.display = "none";
    if (ym) ym.style.display = "none";
  }
}

// ---------- SAYFA YÜKLENİNCE ----------

window.addEventListener("load", async () => {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  $("btnToday").addEventListener("click", async () => {
    try {
      await reportToday();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnRange").addEventListener("click", async () => {
    try {
      await reportRange();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnMonth").addEventListener("click", async () => {
    try {
      await reportMonth();
    } catch (e) {
      alert(e.message);
    }
  });

  $("companySelect").addEventListener("change", async () => {
    try {
      await loadBranches();
    } catch (e) {
      alert(e.message);
    }
  });

  $("branchSelect").addEventListener("change", async () => {
    try {
      await refreshTotals();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnReloadAll").addEventListener("click", async () => {
    try {
      await loadCompanies();
      await reportToday();
      setMsg($("opMsg"), "Yenilendi ✅", true);
    } catch (e) {
      alert(e.message);
    }
  });

  $("ledgerType").addEventListener("change", toggleLedgerFields);
  $("btnLedger").addEventListener("click", async () => {
    try {
      await saveLedger();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnExpense").addEventListener("click", async () => {
    try {
      await saveExpense();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnProd").addEventListener("click", async () => {
    try {
      await saveProd();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnCompanySave").addEventListener("click", async () => {
    try {
      await adminSaveCompany();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnCompanyDelete").addEventListener("click", async () => {
    try {
      await adminDeleteCompany();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnBranchAdd").addEventListener("click", async () => {
    try {
      await adminAddBranch();
    } catch (e) {
      alert(e.message);
    }
  });

  $("btnBranchDelete").addEventListener("click", async () => {
    try {
      await adminDeleteBranch();
    } catch (e) {
      alert(e.message);
    }
  });

  toggleLedgerFields();

  if (token && me) {
    showLoggedIn();
    applyRoleRestrictions();
    initDates();
    try {
      await loadCompanies();
      await reportToday();
    } catch {
      logout();
    }
  } else {
    showLoggedOut();
  }
});
