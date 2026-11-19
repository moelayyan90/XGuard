// The owner loads small pages on demand. No customer input or account information
// is embedded in the page, exported to telemetry or written to browser storage.
function financeClient() {
  const get = id => document.getElementById(id);
  const money = cents => cents === null ? 'غير متاح' : (cents / 100).toFixed(2) + ' USD';
  const jordan = new Intl.DateTimeFormat('ar-JO-u-nu-latn', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Amman' });
  const labels = { NEW: 'جديد', CREATING: 'جارٍ إنشاء الطلب', AWAITING_PAYMENT: 'بانتظار المشتري', CAPTURING: 'جارٍ التحقق من التحصيل', PAYMENT_UNKNOWN: 'بانتظار التسوية', PAID: 'محصّل', EXECUTING: 'قيد التنفيذ', RUNNING: 'قيد التنفيذ', DELIVERY_PENDING: 'بانتظار التسليم', SUCCEEDED: 'سُلّم', REFUNDED: 'مسترد', REVERSED: 'عكس أو نزاع قيد المراجعة', REFUND_REQUIRED: 'يتطلب استردادًا', REVIEW_REQUIRED: 'قيد المراجعة', EXPIRED: 'انتهت المهلة' };
  const records = new Map();
  let cursor = null;
  function line(body, values) {
    const tr = document.createElement('tr');
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    body.append(tr);
  }
  function render() {
    const orders = [...records.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const captures = orders.filter(row => row.captured_cents !== null);
    const sum = (rows, key) => rows.some(row => row[key] === null) ? null : rows.reduce((total, row) => total + row[key], 0);
    const gross = sum(captures, 'captured_cents'), fee = sum(captures, 'fee_cents'), refund = sum(orders, 'refund_cents');
    get('gross').textContent = money(gross); get('fees').textContent = money(fee); get('refund').textContent = money(refund);
    get('collected').textContent = captures.length; get('pending').textContent = orders.filter(row => ['AWAITING_PAYMENT','CAPTURING','PAYMENT_UNKNOWN'].includes(row.status)).length;
    get('denied').textContent = orders.filter(row => row.denied).length; get('delivered').textContent = orders.filter(row => row.delivered).length;
    get('review').textContent = orders.filter(row => row.review).length;
    get('liability').textContent = money(sum(orders, 'liability_cents'));
    const tbody = get('rows'); tbody.replaceChildren();
    for (const row of orders) line(tbody, [jordan.format(new Date(row.created_at)), row.name, labels[row.status] || row.status, money(row.quoted_cents), row.captured_cents === null ? '—' : money(row.captured_cents), row.delivered ? 'صدر' : '—']);
    const services = new Map();
    for (const row of captures) services.set(row.name, (services.get(row.name) || 0) + 1);
    const top = [...services].sort((a, b) => b[1] - a[1]);
    get('services').textContent = top.length ? top.map(([name, count]) => name + ' (' + count + ')').join('، ') : 'لا توجد مشتريات محصّلة في السجلات المعروضة.';
    get('records').hidden = false;
  }
  async function load() {
    const button = get('more'), message = get('progress');
    button.disabled = true; message.textContent = 'جارٍ قراءة سجلات الطلبات…';
    try {
      const response = await fetch('/admin/paypal/ledger', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ after: cursor, csrf: document.querySelector('meta[name="csrf"]').content }) });
      if (!response.ok) throw Error('ledger_unavailable');
      const data = await response.json();
      for (const row of data.rows) records.set(row.id, row);
      cursor = data.next; render();
      message.textContent = (cursor ? 'تُعرض أرقام الدفعات المقروءة فقط. تتوفر سجلات إضافية.' : 'اكتملت قراءة فهرس طلبات XGuard المرتبطة بـ PayPal.') + ' آخر قراءة بتوقيت عمّان ' + jordan.format(new Date(data.as_of));
      button.hidden = !cursor; button.textContent = 'تحميل الدفعة التالية';
    } catch {
      message.textContent = records.size ? 'تعذرت قراءة بقية السجلات. الأرقام الظاهرة جزئية.' : 'تعذر الوصول إلى سجل الدفع. أعد المحاولة أو سجّل الدخول مجددًا.';
      button.hidden = false; button.textContent = 'إعادة المحاولة';
    } finally { button.disabled = false; }
  }
  get('more').addEventListener('click', load);
  load();
}

export function financeDashboard(csrf) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const metrics = [
    ['gross','إجمالي التحصيل المؤكد'],['fees','رسوم التحصيل الموثّقة'],['refund','الاستردادات المؤكدة'],
    ['collected','طلبات محصّلة'],['pending','طلبات معلقة'],['denied','مدفوعات مرفوضة مؤكدة'],
    ['delivered','طلبات صدر لها إيصال تسليم'],['review','طلبات تحتاج مراجعة'],['liability','التزامات استرداد مفتوحة'],
  ];
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf" content="${csrf}"><title>مدفوعات XGuard</title><style nonce="${nonce}">
  *{box-sizing:border-box}body{margin:0;color:#1a2927;background:#f4f5f2;font:16px/1.7 system-ui,sans-serif}main{max-width:1060px;margin:0 auto;padding:2rem 1rem 4rem}a{color:#1c594c}h1{font-size:clamp(1.9rem,5vw,3.2rem);margin:.4rem 0}h2{font-size:1.2rem}p{margin:.6rem 0}section,details{background:#fff;border:1px solid #d2d9d2;border-radius:8px;padding:1rem 1.25rem;margin:1rem 0}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:1rem}dt{font-size:.9rem;color:#40534b}dd{margin:0;font-size:1.45rem;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse;text-align:start;white-space:nowrap}th,td{text-align:start;padding:.5rem;border-bottom:1px solid #e7ebe7}.scroll{overflow:auto}button{background:#23574b;color:white;border:0;border-radius:5px;padding:.5rem 1rem;font:inherit}button:disabled{opacity:.6}[hidden]{display:none}small{color:#486156}
  </style></head><body><main><a href="/admin">لوحة المالك</a><h1>مدفوعات XGuard</h1><p>طلبات PayPal Live المسجلة في XGuard، بالدولار الأمريكي وبتوقيت الأردن.</p><p id="progress" role="status">جارٍ قراءة سجل الدفع…</p><button id="more" hidden>تحميل الدفعة التالية</button><div id="records" hidden><section><h2>التحصيل والتسليم</h2><dl>${metrics.map(([id, label]) => `<div><dt>${label}</dt><dd id="${id}">—</dd></div>`).join('')}</dl></section><section><h2>الطلبات</h2><div class="scroll"><table><thead><tr><th>وقت الإنشاء</th><th>الخدمة</th><th>الحالة</th><th>السعر</th><th>المحصّل</th><th>إيصال التسليم</th></tr></thead><tbody id="rows"></tbody></table></div></section><section><h2>الخدمات الأكثر شراءً</h2><p id="services"></p></section></div><details open><summary>التكاليف والاشتراكات ومصادر المبيعات</summary><p>تظهر رسوم التحصيل حين يوردها PayPal. تكلفة تشغيل الطلب وصافي الإيراد التقديري غير متاحين إلى أن تُطابق التكاليف والرسوم مع فواتيرها. لا توجد توقعات إيراد معتمدة.</p><p>الفوترة الحالية لكل عملية. الاشتراكات والتجديد والإلغاء الدوري غير مفعلة. عدد المشترين الفريدين ومصادر المبيعات غير مقاسين في السجلات الحالية.</p></details><small>يعرض الفهرس الطلبات التي ربطها XGuard بمعرّف PayPal. يمكن مراجعة حركة حساب التاجر الكاملة في PayPal.</small><noscript><p>فعّل JavaScript لقراءة السجلات.</p></noscript></main><script nonce="${nonce}">(${financeClient.toString()})()</script></body></html>`;
  return new Response(html, { headers: { 'content-type':'text/html; charset=utf-8', 'cache-control':'private, no-store', 'x-robots-tag':'noindex, nofollow', 'referrer-policy':'no-referrer', 'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } });
}
