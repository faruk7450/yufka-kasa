let token = localStorage.getItem("token") || "";
let me = JSON.parse(localStorage.getItem("me") || "null");

function $(id){ return document.getElementById(id); }

function setMsg(el, text, ok=true){
  el.className = ok ? "muted ok" : "muted err";
  el.textContent = text;
}

async function api(path, opts={}){
  const headers = opts.headers || {};
  headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Hata");
  return data;
}

function showLoggedIn(){
  $("loginCard").classList.add("hidden");
  $("mainCard").classList.remove("hidden");
  $("reportsCard").classList.remove("hidden");
  $("customersCard").classList.remove("hidden");
  $("opsCard").classList.remove("hidden");

  $("userPill").textContent = `Giriş: ${me?.name || "-"} (${me?.role || "-"})`;

  // Admin değilse admin müşteri kutusunu gizle
  if (me?.role !== "ADMIN") {
    $("adminCustomerBox").style.display = "none";
  } else {
    $("adminCustomerBox").style.display = "block";
  }
}

function showLoggedOut(){
  $("loginCard").classList.remove("hidden");
  $("mainCard").classList.add("hidden");
  $("reportsCard").classList.add("hidden");
  $("customersCard").classList.add("hidden");
  $("opsCard").classList.add("hidden");
}

function fmt(n){
  const x = Number(n || 0);
  return x.toFixed(2);
}

function initDates(){
  const now = new Date();
  const today = now.toISOString().slice(0,10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);

  $("fromDate").value = first;
  $("toDate").value = today;
  $("ym").value = today.slice(0,7);

  $("ledgerDate").value = today;
  $("expDate").value = today;
  $("prodDate").value = today;
}

async function loadCustomers(){
  const rows = await api("/customers");
  const tb = $("custBody");
  tb.innerHTML = "";
  for (const c of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.phone || ""}</td>
      <td>${fmt(c.price_per_pack)}</td>
      <td>${fmt(c.balance)}</td>
      <td class="muted">ID seç → kutuya yaz</td>
    `;
    tr.addEventListener("click", () => {
      $("cId").value = c.id;
      $("cName").value = c.name;
      $("cPhone").value = c.phone || "";
      $("cPrice").value = c.price_per_pack;
      setMsg($("custMsg"), `Seçildi: ${c.name} (ID ${c.id})`, true);
      $("ledgerCustomerId").value = c.id;
    });
    tb.appendChild(tr);
  }
  setMsg($("custMsg"), `Müşteriler yüklendi (${rows.length}).`, true);
}

async function reportToday(){
  const r = await api("/reports/today");
  $("reportOut").textContent =
`BUGÜN RAPORU
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

async function reportRange(){
  const from = $("fromDate").value;
  const to = $("toDate").value;
  const r = await api(`/reports/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  $("reportOut").textContent =
`RAPOR (${r.from} → ${r.to})
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

async function reportMonth(){
  const ym = $("ym").value;
  const r = await api(`/reports/month?ym=${encodeURIComponent(ym)}`);
  $("reportOut").textContent =
`AY RAPORU (${r.from} → ${r.to})
SATIŞ: ${fmt(r.sales)}
TAHSİLAT: ${fmt(Math.abs(r.payments))}
İADE: ${fmt(Math.abs(r.returns))}
GİDER: ${fmt(r.expenses)}
ÜRETİM (paket): ${fmt(r.productionPacks)}
`;
}

async function addCustomer(){
  const name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const pricePerPack = Number($("cPrice").value || 0);
  if (!name) return alert("Firma adı yaz");
  await api("/customers", {
    method: "POST",
    body: JSON.stringify({ name, phone: phone || null, pricePerPack })
  });
  await loadCustomers();
}

async function updateCustomer(){
  const id = Number($("cId").value || 0);
  if (!id) return alert("Güncellemek için ID gir");
  const name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const pricePerPack = Number($("cPrice").value || 0);
  await api(`/customers/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, phone: phone || null, pricePerPack })
  });
  await loadCustomers();
}

async function deleteCustomer(){
  const id = Number($("cId").value || 0);
  if (!id) return alert("Silmek için ID gir");
  if (!confirm("Müşteri pasife alınacak (kaldır). Emin misin?")) return;
  await api(`/customers/${id}`, { method: "DELETE" });
  $("cId").value = ""; $("cName").value = ""; $("cPhone").value = ""; $("cPrice").value = "";
  await loadCustomers();
}

async function saveLedger(){
  const type = $("ledgerType").value;
  const customerId = Number($("ledgerCustomerId").value || 0);
  const packs = Number($("ledgerPacks").value || 0);
  const amount = Number($("ledgerAmount").value || 0);
  const note = $("ledgerNote").value || null;
  const entryDate = $("ledgerDate").value || null;

  if (!customerId) return alert("Müşteri ID gir");
  if (type === "PAYMENT" && amount <= 0) return alert("Tahsilat tutarı gir");
  if (type !== "PAYMENT" && packs <= 0) return alert("Paket gir");

  await api("/ledger", {
    method:"POST",
    body: JSON.stringify({ type, customerId, packs, amount, note, entryDate })
  });

  setMsg($("opMsg"), "Ledger kaydedildi ✅", true);
  await reportToday();
  await loadCustomers();
}

async function saveExpense(){
  const amount = Number($("expAmount").value || 0);
  const note = $("expNote").value || "";
  const entryDate = $("expDate").value || null;
  if (amount <= 0) return alert("Gider tutarı gir");

  await api("/expenses", {
    method:"POST",
    body: JSON.stringify({ amount, note, entryDate })
  });

  setMsg($("opMsg"), "Gider kaydedildi ✅", true);
  await reportToday();
}

async function saveProd(){
  const packs = Number($("prodPacks").value || 0);
  const note = $("prodNote").value || null;
  const entryDate = $("prodDate").value || null;
  if (packs <= 0) return alert("Üretim paket gir");

  await api("/production", {
    method:"POST",
    body: JSON.stringify({ packs, note, entryDate })
  });

  setMsg($("opMsg"), "Üretim kaydedildi ✅", true);
  await reportToday();
}

async function login(){
  try{
    const pin = $("pin").value;
    const r = await api("/auth/login", {
      method:"POST",
      body: JSON.stringify({ pin })
    });
    token = r.token;
    me = r.user;
    localStorage.setItem("token", token);
    localStorage.setItem("me", JSON.stringify(me));
    setMsg($("loginMsg"), "Giriş başarılı ✅", true);
    showLoggedIn();
    initDates();
    await loadCustomers();
    await reportToday();
  }catch(e){
    setMsg($("loginMsg"), e.message, false);
  }
}

function logout(){
  token = "";
  me = null;
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  showLoggedOut();
}

window.addEventListener("load", async () => {
  $("btnLogin").addEventListener("click", login);
  $("btnLogout").addEventListener("click", logout);

  $("btnReloadCustomers").addEventListener("click", async () => {
    try { await loadCustomers(); } catch(e){ setMsg($("custMsg"), e.message, false); }
  });

  $("btnToday").addEventListener("click", async () => {
    try { await reportToday(); } catch(e){ alert(e.message); }
  });
  $("btnRange").addEventListener("click", async () => {
    try { await reportRange(); } catch(e){ alert(e.message); }
  });
  $("btnMonth").addEventListener("click", async () => {
    try { await reportMonth(); } catch(e){ alert(e.message); }
  });

  $("btnAdd").addEventListener("click", async () => { try{ await addCustomer(); }catch(e){ alert(e.message);} });
  $("btnUpdate").addEventListener("click", async () => { try{ await updateCustomer(); }catch(e){ alert(e.message);} });
  $("btnDelete").addEventListener("click", async () => { try{ await deleteCustomer(); }catch(e){ alert(e.message);} });

  $("btnLedger").addEventListener("click", async () => { try{ await saveLedger(); }catch(e){ alert(e.message);} });
  $("btnExpense").addEventListener("click", async () => { try{ await saveExpense(); }catch(e){ alert(e.message);} });
  $("btnProd").addEventListener("click", async () => { try{ await saveProd(); }catch(e){ alert(e.message);} });

  if (token && me) {
    // token var: direkt aç
    showLoggedIn();
    initDates();
    try {
      await loadCustomers();
      await reportToday();
    } catch (e) {
      // token bozulduysa
      logout();
    }
  } else {
    showLoggedOut();
  }
});
