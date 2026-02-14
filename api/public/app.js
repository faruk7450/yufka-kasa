let session = null; // { id, name, role }

const $ = (id) => document.getElementById(id);
const msg = (el, text, ok=true) => { el.innerHTML = `<p class="${ok ? "ok":"err"}">${text}</p>`; };

function setAuthedUI(on) {
  $("mainCard").style.display = on ? "" : "none";
  $("customersCard").style.display = on ? "" : "none";
  $("ledgerCard").style.display = on ? "" : "none";
  $("expenseCard").style.display = on ? "" : "none";
  $("prodCard").style.display = on ? "" : "none";

  $("btnLogin").style.display = on ? "none" : "";
  $("btnLogout").style.display = on ? "" : "none";
}

async function api(path, method="GET", body=null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* ignore */ }
  if (!r.ok) throw new Error(j?.error || t || `HTTP ${r.status}`);
  return j;
}

async function login() {
  const pin = $("pin").value.trim();
  if (!pin) return msg($("loginMsg"), "PIN gir.", false);

  try {
    const u = await api("/auth/login", "POST", { pin });
    session = u;
    localStorage.setItem("session", JSON.stringify(session));
    $("who").textContent = `Giriş: ${u.name} (${u.role})`;
    msg($("loginMsg"), "Giriş başarılı ✅", true);
    setAuthedUI(true);
    await loadCustomers(true);
    await refreshReport();
  } catch (e) {
    msg($("loginMsg"), `Giriş başarısız: ${e.message}`, false);
  }
}

function logout() {
  session = null;
  localStorage.removeItem("session");
  $("who").textContent = "";
  setAuthedUI(false);
  msg($("loginMsg"), "Çıkış yapıldı.", true);
}

async function refreshReport() {
  try {
    const r = await api("/reports/today");
    $("reportBox").textContent =
      `SATIŞ: ${r.sales}\nTAHSİLAT: ${r.payments}\nİADE: ${r.returns}\nGİDER: ${r.expenses}\nÜRETİM (paket): ${r.productionPacks}`;
  } catch (e) {
    $("reportBox").textContent = `Rapor alınamadı: ${e.message}`;
  }
}

async function loadCustomers(fillSelect=false) {
  try {
    const cs = await api("/customers");
    const table = $("customersTable");
    table.innerHTML = `
      <tr>
        <th>ID</th><th>Firma</th><th>Telefon</th><th>Fiyat</th><th>Bakiye</th>
      </tr>
      ${cs.map(c => `
        <tr>
          <td>${c.id}</td>
          <td>${c.name}</td>
          <td>${c.phone ?? ""}</td>
          <td>${Number(c.price_per_pack).toFixed(2)}</td>
          <td>${Number(c.balance).toFixed(2)}</td>
        </tr>
      `).join("")}
    `;

    if (fillSelect) {
      const sel = $("customerSelect");
      sel.innerHTML = cs.map(c => `<option value="${c.id}">${c.name} (#${c.id})</option>`).join("");
    }

    msg($("customersMsg"), `Müşteriler yüklendi (${cs.length}).`, true);
  } catch (e) {
    msg($("customersMsg"), `Müşteriler alınamadı: ${e.message}`, false);
  }
}

async function addCustomer() {
  if (!session) return;
  if (session.role !== "ADMIN") return msg($("customersMsg"), "Sadece ADMIN müşteri ekleyebilir.", false);

  const name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const pricePerPack = Number($("cPrice").value || 0);

  if (!name) return msg($("customersMsg"), "Firma adı zorunlu.", false);

  try {
    await api("/customers", "POST", { userRole: session.role, name, phone, pricePerPack });
    msg($("customersMsg"), "Müşteri eklendi ✅", true);
    $("cName").value = ""; $("cPhone").value = ""; $("cPrice").value = "";
    await loadCustomers(true);
  } catch (e) {
    msg($("customersMsg"), `Müşteri eklenemedi: ${e.message}`, false);
  }
}

async function addLedger() {
  if (!session) return;

  const customerId = Number($("customerSelect").value);
  const type = $("type").value;
  const packs = Number($("packs").value || 0);
  const amount = Number($("amount").value || 0);
  const note = $("note").value.trim();

  try {
    await api("/ledger", "POST", {
      userId: session.id,
      userRole: session.role,
      customerId,
      type,
      packs,
      amount,
      note
    });
    msg($("ledgerMsg"), "Kayıt eklendi ✅", true);
    $("packs").value = ""; $("amount").value = ""; $("note").value = "";
    await loadCustomers(true);
    await refreshReport();
  } catch (e) {
    msg($("ledgerMsg"), `Hata: ${e.message}`, false);
  }
}

async function addExpense() {
  if (!session) return;
  const amount = Number($("expAmount").value || 0);
  const note = $("expNote").value.trim();

  try {
    await api("/expenses", "POST", { userId: session.id, userRole: session.role, amount, note });
    msg($("expenseMsg"), "Gider eklendi ✅", true);
    $("expAmount").value = ""; $("expNote").value = "";
    await refreshReport();
  } catch (e) {
    msg($("expenseMsg"), `Hata: ${e.message}`, false);
  }
}

async function addProduction() {
  if (!session) return;
  const packs = Number($("prodPacks").value || 0);
  const note = $("prodNote").value.trim();

  try {
    await api("/production", "POST", { userId: session.id, userRole: session.role, packs, note });
    msg($("prodMsg"), "Üretim eklendi ✅", true);
    $("prodPacks").value = ""; $("prodNote").value = "";
    await refreshReport();
  } catch (e) {
    msg($("prodMsg"), `Hata: ${e.message}`, false);
  }
}

// UI bindings
$("btnLogin").addEventListener("click", login);
$("btnLogout").addEventListener("click", logout);
$("btnRefresh").addEventListener("click", refreshReport);
$("btnLoadCustomers").addEventListener("click", () => loadCustomers(true));
$("btnAddCustomer").addEventListener("click", addCustomer);
$("btnAddLedger").addEventListener("click", addLedger);
$("btnAddExpense").addEventListener("click", addExpense);
$("btnAddProd").addEventListener("click", addProduction);

// Type helper
$("type").addEventListener("change", () => {
  const t = $("type").value;
  // satış/iade => packs aktif, tahsilat => amount aktif
  $("packs").disabled = (t === "PAYMENT");
  $("amount").disabled = (t !== "PAYMENT");
});
$("type").dispatchEvent(new Event("change"));

// Restore session
try {
  const s = localStorage.getItem("session");
  if (s) {
    session = JSON.parse(s);
    $("who").textContent = `Giriş: ${session.name} (${session.role})`;
    setAuthedUI(true);
    loadCustomers(true);
    refreshReport();
  }
} catch { /* ignore */ }
