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

// ---------------- UI STATE ----------------

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

// ------------- FİRMA / ŞUBE --------------

async function loadCompanies() {
  companies = await api("/companies");
  const sel = $("companySelect");
  sel.innerHTML = "";

  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (Bakiye: ${fmt(c.balance)})`;
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

  // admin panel firma bilgileri doldur
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
    const r = await api(`/balances/company/${companyId}`);
    $("companyTotal").textContent = fmt(r.balance);
  } else {
    $("companyTotal").textContent = fmt(0);
  }

  if (branchId) {
    const r2 = await api(`/balances/branch/${branchId}`);
    $("branchTotal").textContent = fmt(r2.balance);
  } else {
    $("branchTotal").textContent = fmt(0);
  }

  await reportToday();
}

// ------------- RAPORLAR -------------------

function renderReport(prefix, r) {
  const top = `${prefix} (${r.from} → ${r.to})
TOPLAM SATIŞ: ${fmt(r.totalSales)}
- Peşin Satış: ${fmt(r.cashSales)}
- Tahsilat: ${fmt(r.payments)}
- Veresiye Satış: ${fmt(r.debtSales)}
İADE (adet): ${Number(r.returnPacks || 0)}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${Number(r.productionPacks || 0)}
SATILAN PAKET (toplam): ${Number(r.soldPacks || 0)}

GÜNLÜK ÖZET (${r.from})
- Brüt Satış (Peşin + Tahsilat): ${fmt(r.totalSales)}
- Gider Düşülmüş Net Kasa:      ${fmt(r.netCash)}
- Veresiye Toplamı:             ${fmt(r.debtSales)}
`;

  $("reportOut").textContent = top;
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

// ------------- İŞLEM GİRİŞ ----------------

function toggleLedgerFields() {
  const t = $("ledgerType").value;

  const needPacks =
    t === "SALE" || t === "CASH_SALE" || t === "PAYMENT" || t === "RETURN";

  const needAmountManual = t === "DEBT_ADD";

  $("ledgerPacks").style.display = needPacks ? "inline-block" : "none";
  $("ledgerAmount").style.display = needAmountManual ? "inline-block" : "none";

  if (t === "CASH_SALE") {
    setMsg(
      $("opMsg"),
      "Peşin satış: Paket gir, tutar otomatik hesaplanır.",
      true
    );
  } else if (t === "PAYMENT") {
    setMsg(
      $("opMsg"),
      "Tahsilat: Paket gir (fiyat firma üzerinden otomatik), istersen TL olarak DEĞER GİRMEK için 'Alacak / Veresiye (Tutar)' kullan.",
      true
    );
  } else {
    setMsg($("opMsg"), "", true);
  }
}

async function saveLedger() {
  const type = $("ledgerType").value;
  const companyId = Number($("companySelect").value || 0);
  const branchId = Number($("branchSelect").value || 0);

  const packs = Number($("ledgerPacks").value || 0);
  let amount = Number($("ledgerAmount").value || 0);
  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId) return alert("Şube seç");
  if (!type) return alert("İşlem türü seç");

  if (type === "DEBT_ADD") {
    if (amount <= 0) return alert("Tutar (TL) gir");
  } else if (type === "PAYMENT") {
    // Tahsilat: paket gir, amount 0 kalabilir (server firmaya göre hesaplar)
    if (packs <= 0) return alert("Tahsilat için paket gir");
    amount = 0;
  } else {
    // SALE / CASH_SALE / RETURN
    if (packs <= 0) return alert("Paket gir");
    amount = 0;
  }

  await api("/ledger", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      branchId,
      type,
      packs,
      amount,
      note,
      entryDate
    })
  });

  // Formu sıfırla
  setMsg($("opMsg"), "İşlem kaydedildi ✅", true);
  $("ledgerPacks").value = "";
  $("ledgerAmount").value = "";
  $("ledgerNote").value = "";
  $("ledgerType").value = "";
  toggleLedgerFields();

  await refreshTotals();
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

// ------------- ADMIN ----------------------

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

// ------------- AUTH -----------------------

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
    initDates();
    await loadCompanies();
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

// ------------- ROL KISITLARI --------------

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

// ------------- INIT -----------------------

window.addEventListener("load", async () => {
  // login/logout
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  // raporlar
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

  // firma / şube seçimi
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

  // yenile
  $("btnReloadAll").addEventListener("click", async () => {
    try {
      await loadCompanies();
      setMsg($("opMsg"), "Yenilendi ✅", true);
    } catch (e) {
      alert(e.message);
    }
  });

  // işlem giriş
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

  // admin
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
    } catch {
      logout();
    }
  } else {
    showLoggedOut();
  }
});
