const itemsEl = document.getElementById("items");
const totalsEl = document.getElementById("totals");
const payAllEl = document.getElementById("payAll");
const clearEl = document.getElementById("clear");
const sessionEl = document.getElementById("session");

let state = { cart: [], session: null };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("ar", {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "XGuard extension error");
  return response.result;
}

function totalsByCurrency(cart) {
  const totals = new Map();
  for (const item of cart) {
    totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.amount));
  }
  return [...totals.entries()];
}

function render() {
  if (!state.cart.length) {
    itemsEl.innerHTML = '<div class="empty">اذهب إلى أي صفحة دفع. ستظهر طبقة XGuard العائمة ويمكنك حجز الدفعة.</div>';
    totalsEl.hidden = true;
    payAllEl.disabled = true;
    clearEl.hidden = true;
  } else {
    itemsEl.innerHTML = state.cart
      .map(
        (item) => `<div class="item">
          <div>
            <div class="title">${escapeHtml(item.title || item.merchant)}</div>
            <div class="merchant">${escapeHtml(item.merchant)}</div>
            <button class="remove" data-remove="${escapeHtml(item.id)}">إزالة</button>
          </div>
          <div class="price">${escapeHtml(money(item.amount, item.currency))}</div>
        </div>`,
      )
      .join("");

    totalsEl.innerHTML = totalsByCurrency(state.cart)
      .map(
        ([currency, amount]) => `<div class="total"><span>${escapeHtml(currency)}</span><span>${escapeHtml(money(amount, currency))}</span></div>`,
      )
      .join("");
    totalsEl.hidden = false;
    payAllEl.disabled = false;
    clearEl.hidden = false;
  }

  if (state.session?.status === "ACTIVE") {
    sessionEl.style.display = "block";
    sessionEl.textContent = `جلسة Pay All نشطة · ${state.session.index + 1} من ${state.session.itemIds.length}`;
  } else if (state.session?.status === "COMPLETED") {
    sessionEl.style.display = "block";
    sessionEl.textContent = "اكتملت آخر جلسة Pay All";
  } else {
    sessionEl.style.display = "none";
  }

  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await send("XG_REMOVE_PAYMENT", { id: button.dataset.remove });
      state = result;
      render();
    });
  });
}

payAllEl.addEventListener("click", async () => {
  payAllEl.disabled = true;
  try {
    await send("XG_START_PAY_ALL");
    window.close();
  } catch (error) {
    payAllEl.disabled = false;
    payAllEl.textContent = error.message;
  }
});

clearEl.addEventListener("click", async () => {
  state = await send("XG_CLEAR_CART");
  render();
});

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  state = await send("XG_GET_STATE");
  render();
});

state = await send("XG_GET_STATE");
render();
