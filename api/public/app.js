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
  if (token) headers["Authorization"] = Bearer ${token};

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Hata");
  return data;
}

function fmt(n) {
  const x = Number(n || 0);
  return x.toFixed(2);
}

// Eski HTML'deki entryType değerlerini backend tipine çevir
function normalizeType(raw) {
  if (raw === "SALE_CREDIT") return "SALE";   // SATIŞ (Veresiye)
  if (raw === "DEBIT") return "DEBT_ADD";     // ALACAK / VERESİYE (Tutar)
  return raw;                                 // CASH_SALE, PAYMENT, RETURN
}

function showLoggedIn() {
  const login = $("loginCard");
  if (login) login.classList.add("hidden");

  const main = $("mainCard");
  if (main) main.classList.remove("hidden");

  const userPill = $("userPill");
  if (userPill) userPill.textContent = Giriş: ${me?.name || "-"} (${me?.role || "-"});

  const ops = $("opsCard");
  if (ops) ops.classList.remove("hidden");

  const reports = $("reportsCard");
  if (reports) {
    if (me?.role === "ADMIN") reports.classList.remove("hidden");
    else reports.classList.add("hidden"); // personel toplam raporu görmesin
  }

  const adminCard = $("adminCard");
  if (adminCard) {
    if (me?.role === "ADMIN") adminCard.classList.remove("hidden");
    else adminCard.classList.add("hidden");
  }

  const detailCard = $("detailCard");
  if (detailCard) {
    if (me?.role === "ADMIN") detailCard.classList.remove("hidden");
    else detailCard.classList.add("hidden");
  }
}

function showLoggedOut() {
  const login = $("loginCard");
  if (login) login.classList.remove("hidden");

  ["mainCard", "reportsCard", "opsCard", "adminCard", "detailCard"].forEach(
    id => {
      const el = $(id);
      if (el) el.classList.add("hidden");
    }
  );
}

function initDates() {
  const ymd = todayYMD();

  ["ledgerDate", "expDate", "prodDate", "detailFromDate", "detailToDate"].forEach(
    id => {
      const el = $(id);
      if (el) el.value = ymd;
    }
  );

  const from = $("fromDate");
  const to = $("toDate");
  if (from) from.value = ymd;
  if (to) to.value = ymd;

  const ym = $("ym");
  if (ym) ym.value = ymd.slice(0, 7);
}

let companies = [];
let branches = [];

// Firma listesi: sadece alacaklı olanlar "Alacak: XX" yazsın
async function loadCompanies() {
  companies = await api("/companies");

  // Her firma için bakiye çek
  companies = await Promise.all(
    companies.map(async c => {
      try {
        const bal = await api(/balances/company/${c.id});
        return { ...c, balance: Number(bal.balance || 0) };
      } catch {
        return { ...c, balance: 0 };
      }
    })
  );

  const sel = $("companySelect");
  if (!sel) return;
  sel.innerHTML = "";

  const isAdmin = me?.role === "ADMIN";

  for (const c of companies) {
    const opt = document.createElement("option");
    opt.value = c.id;

    let label = c.name;
    if (c.balance > 0) {
      // Sadece alacak varsa göster
      label += ` (Alacak: ${fmt(c.balance)})`;
    } else if (isAdmin && c.balance < 0) {
      // Admin'e avans / fazla ödeme de gösterilebilir
      label += ` (Avans: ${fmt(-c.balance)})`;
    }

    opt.textContent = label;
    sel.appendChild(opt);
  }

  if (companies.length) {
    sel.value = String(companies[0].id);
    await loadBranches();
  } else {
    const bsel = $("branchSelect");
    if (bsel) bsel.innerHTML = "";
  }
}

async function loadBranches() {
  const companyId = Number($("companySelect")?.value || 0);
  if (!companyId) return;

  branches = await api(/companies/${companyId}/branches);
  const sel = $("branchSelect");
  if (!sel) return;

  sel.innerHTML = "";
  for (const b of branches) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  }
  if (branches.length) sel.value = String(branches[0].id);

  // Admin formu
  const c = companies.find(x => x.id === companyId);
  if (c) {
    if ($("aCompanyId")) $("aCompanyId").value = c.id;
    if ($("aCompanyName")) $("aCompanyName").value = c.name;
    if ($("aCompanyPhone")) $("aCompanyPhone").value = c.phone || "";
    if ($("aCompanyPrice")) $("aCompanyPrice").value = c.price_per_pack || 0;
  }

  await refreshTotals();
}

async function refreshTotals() {
  const isAdmin = me?.role === "ADMIN";
  const companyTotalEl = $("companyTotal");
  const branchTotalEl = $("branchTotal");

  if (!companyTotalEl || !branchTotalEl) return;

  if (!isAdmin) {
    // personel için bakiyeleri gizle
    companyTotalEl.textContent = "-";
    branchTotalEl.textContent = "-";
    return;
  }

  const companyId = Number($("companySelect")?.value || 0);
  const branchId = Number($("branchSelect")?.value || 0);

  if (companyId) {
    try {
      const cb = await api(/balances/company/${companyId});
      companyTotalEl.textContent = fmt(cb.balance);
    } catch {
      companyTotalEl.textContent = fmt(0);
    }
  } else {
    companyTotalEl.textContent = fmt(0);
  }

  if (branchId) {
    try {
      const bb = await api(/balances/branch/${branchId});
      branchTotalEl.textContent = fmt(bb.balance);
    } catch {
      branchTotalEl.textContent = fmt(0);
    }
  } else {
    branchTotalEl.textContent = fmt(0);
  }
}

// ---------- RAPORLAR (ADMIN) ----------
function renderReport(title, r) {
  const out = $("reportOut");
  if (!out) return;

  const lines = [];
  lines.push(${title} (${r.from} → ${r.to}));
  lines.push(TOPLAM SATIŞ: ${fmt(r.totalSales)} TL);
  lines.push(- Peşin Satış: ${fmt(r.cashSales)} TL);
  lines.push(- Tahsilat: ${fmt(r.payments)} TL);
  lines.push(- Veresiye: ${fmt(r.creditSales)} TL);
  lines.push(İADE: ${fmt(r.returns)} TL);
  lines.push(GİDER: ${fmt(r.expenses)} TL);
  lines.push(ÜRETİM (paket): ${fmt(r.productionPacks)});
  lines.push(SATILAN PAKET (toplam): ${fmt(r.soldPacks)});

  out.textContent = lines.join("\n");
}

async function reportToday() {
  const r = await api("/reports/today");
  renderReport("BUGÜN RAPORU", r);
}

async function reportRange() {
  const from = $("fromDate")?.value;
  const to = $("toDate")?.value;
  const r = await api(
    `/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to
    )}`
  );
  renderReport("RAPOR", r);
}

async function reportMonth() {
  const ym = $("ym")?.value;
  const r = await api(/reports/month?ym=${encodeURIComponent(ym)});
  renderReport("AY RAPORU", r);
}

// ---------- ŞUBE DETAY (Detay Gör butonu) ----------
function getDetailDates() {
  const fromEl = $("detailFromDate") || $("fromDate");
  const toEl = $("detailToDate") || $("toDate");
  const today = todayYMD();
  return {
    from: fromEl?.value || today,
    to: toEl?.value || today
  };
}

async function reportBranchDetail() {
  const branchId = Number($("branchSelect")?.value || 0);
  if (!branchId) return alert("Şube seç");

  const { from, to } = getDetailDates();

  const data = await api(
    `/reports/branch-range?branchId=${branchId}&from=${encodeURIComponent(
      from
    )}&to=${encodeURIComponent(to)}`
  );

  const out = $("detailOut") || $("reportOut");
  if (!out) return;

  const lines = [];
  lines.push(ŞUBE DETAY (${from} → ${to}));
  lines.push(Firma : ${data.companyName || "-"});
  lines.push(Şube  : ${data.branchName || "-"});
  lines.push(Toplam Paket: ${fmt(data.totalPacks)});
  lines.push(Peşin Satış (TL): ${fmt(data.cashSales)});
  lines.push(Veresiye Satış (TL): ${fmt(data.creditSales)});
  lines.push(Tahsilat (TL): ${fmt(data.payments)});
  lines.push(İade (TL): ${fmt(data.returns)});

  out.textContent = lines.join("\n");
}

// ---------- İŞLEM GİRİŞ ----------
function toggleLedgerFields() {
  const raw = $("ledgerType")?.value || "";
  const t = normalizeType(raw);

  const needPacks = t === "SALE" || t === "CASH_SALE" || t === "RETURN";
  const needAmountManual = t === "PAYMENT" || t === "DEBT_ADD";

  const lp = $("ledgerPacks");
  const la = $("ledgerAmount");
  if (lp) lp.style.display = needPacks ? "inline-block" : "none";
  if (la) la.style.display = needAmountManual ? "inline-block" : "none";
}

async function saveLedger() {
  const rawType = $("ledgerType")?.value || "";
  const type = normalizeType(rawType);

  const companyId = Number($("companySelect")?.value || 0);
  const branchId = Number($("branchSelect")?.value || 0);
  const packs = Number($("ledgerPacks")?.value || 0);
  let amount = Number($("ledgerAmount")?.value || 0);

  const note = $("ledgerNote")?.value || null;
  const entryDate = $("ledgerDate")?.value || null;

  if (!companyId) return alert("Firma seç");
  if (!branchId) return alert("Şube seç");

  if (type === "CASH_SALE" || type === "SALE" || type === "RETURN") {
    if (packs <= 0) return alert("Paket gir");
    amount = 0; // tutarı backend fiyatla hesaplayacak
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

  if ($("ledgerPacks")) $("ledgerPacks").value = "";
  if ($("ledgerAmount")) $("ledgerAmount").value = "";
  if ($("ledgerNote")) $("ledgerNote").value = "";

  await refreshTotals();
  if (me?.role === "ADMIN") {
    await reportToday();
  }
}

async function saveExpense() {
  const amount = Number($("expAmount")?.value || 0);
  const note = $("expNote")?.value || "";
  const entryDate = $("expDate")?.value || null;

  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method: "POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setMsg($("opMsg"), "Gider kaydedildi ✅", true);
  if ($("expAmount")) $("expAmount").value = "";
  if ($("expNote")) $("expNote").value = "";

  if (me?.role === "ADMIN") {
    await reportToday();
  }
}

async function saveProd() {
  const packs = Number($("prodPacks")?.value || 0);
  const note = $("prodNote")?.value || null;
  const entryDate = $("prodDate")?.value || null;

  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method: "POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setMsg($("opMsg"), "Üretim kaydedildi ✅", true);
  if ($("prodPacks")) $("prodPacks").value = "";
  if ($("prodNote")) $("prodNote").value = "";

  if (me?.role === "ADMIN") {
    await reportToday();
  }
}

// ---------- ADMIN ----------
async function adminSaveCompany() {
  const id = Number($("aCompanyId")?.value || 0);
  const name = $("aCompanyName")?.value.trim();
  const phone = $("aCompanyPhone")?.value.trim();
  const pricePerPack = Number($("aCompanyPrice")?.value || 0);

  if (!name) return alert("Firma adı yaz");

  if (!id) {
    await api("/companies", {
      method: "POST",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  } else {
    await api(/companies/${id}, {
      method: "PUT",
      body: JSON.stringify({ name, phone: phone || null, pricePerPack })
    });
  }

  setMsg($("adminMsg"), "Firma kaydedildi ✅", true);
  await loadCompanies();
}

async function adminDeleteCompany() {
  const id = Number($("aCompanyId")?.value || 0);
  if (!id) return alert("Firma ID gerekli");
  if (!confirm("Firma pasife alınacak. Emin misin?")) return;

  await api(/companies/${id}, { method: "DELETE" });
  setMsg($("adminMsg"), "Firma kaldırıldı ✅", true);
  if ($("aCompanyId")) $("aCompanyId").value = "";
  if ($("aCompanyName")) $("aCompanyName").value = "";
  if ($("aCompanyPhone")) $("aCompanyPhone").value = "";
  if ($("aCompanyPrice")) $("aCompanyPrice").value = "";
  await loadCompanies();
}

async function adminAddBranch() {
  const companyId = Number($("companySelect")?.value || 0);
  const name = $("aBranchName")?.value.trim();
  if (!companyId) return alert("Firma seç");
  if (!name) return alert("Şube adı yaz");

  await api(/companies/${companyId}/branches, {
    method: "POST",
    body: JSON.stringify({ name })
  });

  if ($("aBranchName")) $("aBranchName").value = "";
  setMsg($("adminMsg"), "Şube eklendi ✅", true);
  await loadBranches();
}

async function adminDeleteBranch() {
  const id = Number($("aBranchId")?.value || 0);
  if (!id) return alert("Şube ID yaz");
  if (!confirm("Şube pasife alınacak. Emin misin?")) return;

  await api(/branches/${id}, { method: "DELETE" });
  if ($("aBranchId")) $("aBranchId").value = "";
  setMsg($("adminMsg"), "Şube kaldırıldı ✅", true);
  await loadBranches();
}

// ---------- AUTH ----------
async function login() {
  try {
    const pin = $("pin")?.value;
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
    if (me.role === "ADMIN") {
      await reportToday();
    }
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
    el.disabled = !isAdmin && (id === "fromDate" || id === "toDate" || id === "ym");
    if (!isAdmin && (id === "fromDate" || id === "toDate" || id === "ym")) {
      el.style.opacity = "0.7";
    }
  });

  if (!isAdmin) {
    const btnRange = $("btnRange");
    const btnMonth = $("btnMonth");
    if (btnRange) btnRange.style.display = "none";
    if (btnMonth) btnMonth.style.display = "none";
  }
}

// ---------- LOAD ----------
window.addEventListener("load", async () => {
  if ($("btnLogin")) $("btnLogin").addEventListener("click", login);
  if ($("btnLogout")) $("btnLogout").addEventListener("click", logout);

  if ($("btnToday"))
    $("btnToday").addEventListener("click", async () => {
      try {
        await reportToday();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnRange"))
    $("btnRange").addEventListener("click", async () => {
      try {
        await reportRange();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnMonth"))
    $("btnMonth").addEventListener("click", async () => {
      try {
        await reportMonth();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("companySelect"))
    $("companySelect").addEventListener("change", async () => {
      try {
        await loadBranches();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("branchSelect"))
    $("branchSelect").addEventListener("change", async () => {
      try {
        await refreshTotals();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnReloadAll"))
    $("btnReloadAll").addEventListener("click", async () => {
      try {
        await loadCompanies();
        if (me?.role === "ADMIN") await reportToday();
        setMsg($("opMsg"), "Yenilendi ✅", true);
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("ledgerType"))
    $("ledgerType").addEventListener("change", toggleLedgerFields);

  if ($("btnLedger"))
    $("btnLedger").addEventListener("click", async () => {
      try {
        await saveLedger();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnExpense"))
    $("btnExpense").addEventListener("click", async () => {
      try {
        await saveExpense();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnProd"))
    $("btnProd").addEventListener("click", async () => {
      try {
        await saveProd();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnCompanySave"))
    $("btnCompanySave").addEventListener("click", async () => {
      try {
        await adminSaveCompany();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnCompanyDelete"))
    $("btnCompanyDelete").addEventListener("click", async () => {
      try {
        await adminDeleteCompany();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnBranchAdd"))
    $("btnBranchAdd").addEventListener("click", async () => {
      try {
        await adminAddBranch();
      } catch (e) {
        alert(e.message);
      }
    });

  if ($("btnBranchDelete"))
    $("btnBranchDelete").addEventListener("click", async () => {
      try {
        await adminDeleteBranch();
      } catch (e) {
        alert(e.message);
      }
    });

  // Eski "Detay Gör" butonu
  const btnDetail = $("btnDetail");
  if (btnDetail) {
    btnDetail.addEventListener("click", async () => {
      try {
        await reportBranchDetail();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  toggleLedgerFields();

  if (token && me) {
    showLoggedIn();
    applyRoleRestrictions();
    initDates();
    try {
      await loadCompanies();
      if (me.role === "ADMIN") {
        await reportToday();
      }
    } catch {
      logout();
    }
  } else {
    showLoggedOut();
  }
});
