/* global chrome, document, location, MutationObserver, setTimeout, clearTimeout */
(() => {
  const STORAGE_KEY = "xguardTaskRecoveryState";
  const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_CHECKPOINTS = 40;
  const TASK_PATTERNS = [
    [
      "authentication",
      /\b(log ?in|sign ?in|sign ?up|register|account|verify|verification|password|otp|two[- ]?factor|2fa|mfa)\b|تسجيل الدخول|إنشاء حساب|انشاء حساب|تحقق|رمز التحقق|كلمة المرور/i,
    ],
    [
      "booking",
      /\b(book|booking|reserve|reservation|appointment|flight|hotel|ticket|schedule)\b|حجز|موعد|رحلة|فندق|تذكرة/i,
    ],
    [
      "application",
      /\b(apply|application|submit application|request|enroll|registration form|claim)\b|تقديم طلب|طلب جديد|تسجيل|مطالبة/i,
    ],
    [
      "upload",
      /\b(upload|attach|attachment|document|file|photo|image|resume|cv)\b|رفع ملف|إرفاق|ارفاق|مستند|وثيقة|صورة/i,
    ],
    [
      "commerce",
      /\b(checkout|buy|purchase|order|cart|payment|pay|subscribe|invoice|billing)\b|شراء|طلب|سلة|دفع|فاتورة|اشتراك/i,
    ],
    [
      "transfer",
      /\b(transfer|beneficiary|recipient|send money|remit|withdraw|deposit)\b|تحويل|مستفيد|إرسال المال|ارسال المال|سحب|إيداع/i,
    ],
    [
      "settings",
      /\b(settings|preferences|profile|configure|configuration|update|save changes|security settings)\b|إعدادات|اعدادات|تفضيلات|الملف الشخصي|حفظ التغييرات/i,
    ],
    [
      "support",
      /\b(support|help request|ticket|refund|return|dispute|complaint|contact us)\b|دعم|تذكرة دعم|استرداد|إرجاع|نزاع|شكوى|اتصل بنا/i,
    ],
  ];
  const FAILURE_WORDS =
    /\b(error|failed|failure|invalid|required|missing|declined|rejected|denied|unable|cannot|couldn't|expired|blocked|unavailable|not available|try again|something went wrong|timeout|timed out|too many requests|rate limit)\b|خطأ|فشل|غير صالح|مطلوب|مفقود|مرفوض|تم الرفض|غير متاح|حاول مرة أخرى|انتهت الصلاحية|محظور/i;
  const HUMAN_WORDS =
    /\b(captcha|prove you are human|human verification|verification code|one[- ]?time code|otp|mfa|2fa|two[- ]?factor|security key|approve on your phone|scan qr|login required|sign in required)\b|كابتشا|تحقق أنك إنسان|رمز التحقق|المصادقة الثنائية|سجّل الدخول|سجل الدخول/i;
  const RETRY_WORDS =
    /\b(try again|retry|reload|temporary|temporarily|timeout|timed out|too many requests|rate limit|network error)\b|حاول مرة أخرى|أعد المحاولة|اعادة المحاولة|مؤقت|انتهت المهلة/i;
  const UNAVAILABLE_WORDS =
    /\b(sold out|fully booked|out of stock|unavailable|not available|no availability|no slots)\b|نفد|ممتلئ|لا يوجد حجز|غير متاح|لا توجد مواعيد/i;

  let host = null;
  let shadow = null;
  let panelOpen = false;
  let scanTimer = null;
  let model = null;
  let lastUrl = location.href;

  function scheduleScan(delay = 180) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  async function scan() {
    if (document.visibilityState !== "visible") return;
    const task = detectTaskSurface();
    const diagnosis = diagnosePage(task);
    const stored = await loadState();
    pruneState(stored);
    const active = getActiveCheckpoint(stored);
    model = { task, diagnosis, stored, active };

    if (!task && diagnosis.status === "IDLE" && !active) {
      removeHost();
      return;
    }

    if (
      diagnosis.status === "ATTENTION" ||
      diagnosis.status === "HUMAN_REQUIRED"
    ) {
      panelOpen = true;
    }
    render();
  }

  function detectTaskSurface() {
    const pageText =
      `${location.pathname} ${document.title || ""} ${visibleHeadings()} ${visibleActions()}`.slice(
        0,
        12000,
      );
    const forms = Array.from(document.forms).slice(0, 60);
    const actionable = Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='submit'],input[type='button'],a[href]",
      ),
    )
      .filter(isVisible)
      .slice(0, 240);
    const requiredFields = Array.from(
      document.querySelectorAll(
        "input[required],select[required],textarea[required]",
      ),
    ).filter(isVisible);
    const fileInputs = Array.from(
      document.querySelectorAll('input[type="file"]'),
    ).filter(isVisible);

    const scores = new Map();
    for (const [category, pattern] of TASK_PATTERNS) {
      let score = pattern.test(pageText) ? 3 : 0;
      for (const form of forms.slice(0, 15)) {
        const text =
          `${form.getAttribute("action") || ""} ${form.textContent || ""}`.slice(
            0,
            1800,
          );
        if (pattern.test(text)) score += 2;
      }
      scores.set(category, score);
    }
    if (fileInputs.length)
      scores.set("upload", (scores.get("upload") || 0) + 4);
    if (forms.length) scores.set("generic", 2 + Math.min(forms.length, 2));
    if (requiredFields.length >= 2)
      scores.set("generic", (scores.get("generic") || 0) + 2);

    const primaryAction = findPrimaryAction(actionable);
    if (primaryAction) scores.set("generic", (scores.get("generic") || 0) + 1);

    const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    const [category, confidence] = ranked[0] || ["generic", 0];
    if (confidence < 3) return null;

    return {
      category,
      label: categoryLabel(category),
      confidence,
      actionLabel: primaryAction ? labelOf(primaryAction).slice(0, 120) : "",
      title: (document.title || location.hostname).slice(0, 180),
      url: location.href,
      origin: location.origin,
      formCount: forms.length,
      requiredCount: requiredFields.length,
      fileCount: fileInputs.length,
      incompleteRequired: requiredFields.filter(isIncomplete).length,
    };
  }

  function diagnosePage(task) {
    const alerts = collectProblemNodes();
    const invalid = Array.from(
      document.querySelectorAll(
        '[aria-invalid="true"],input:invalid,select:invalid,textarea:invalid',
      ),
    ).filter(isVisible);
    const required = Array.from(
      document.querySelectorAll(
        "input[required],select[required],textarea[required]",
      ),
    ).filter(isVisible);
    const incomplete = required.filter(isIncomplete);
    const text = alerts
      .map((node) => compactText(node.textContent || ""))
      .filter(Boolean)
      .join(" | ")
      .slice(0, 5000);
    const bodySample = compactText(
      (document.body?.innerText || "").slice(0, 18000),
    );
    const evidence = `${text} ${bodySample}`;
    const humanRequired = HUMAN_WORDS.test(evidence);
    const retryable = RETRY_WORDS.test(evidence);
    const unavailable = UNAVAILABLE_WORDS.test(evidence);
    const hasFailure = alerts.length > 0 && FAILURE_WORDS.test(evidence);
    const issues = [];

    if (humanRequired)
      issues.push("تحتاج هذه الخطوة تدخلاً بشريًا أو تحقق هوية.");
    if (invalid.length) issues.push(`يوجد ${invalid.length} حقل غير صالح.`);
    else if (incomplete.length && hasFailure)
      issues.push(`يوجد ${incomplete.length} حقل مطلوب غير مكتمل.`);
    if (unavailable)
      issues.push(
        "الخيار الحالي غير متاح ويحتاج تغيير اختيار أو موعد أو مخزون.",
      );
    if (retryable)
      issues.push("العطل يبدو مؤقتًا ويمكن إعادة المحاولة بعد مراجعة الحالة.");
    if (hasFailure && !issues.length)
      issues.push(
        text
          ? truncate(text, 180)
          : "اكتشف XGuard رسالة فشل في العملية الحالية.",
      );

    let status = task ? "READY" : "IDLE";
    if (
      hasFailure ||
      invalid.length ||
      (task && incomplete.length && actionLooksBlocked())
    )
      status = "ATTENTION";
    if (humanRequired) status = "HUMAN_REQUIRED";

    let nextAction = "راقب العملية واحفظ نقطة رجوع قبل الخطوات الحساسة.";
    if (invalid[0])
      nextAction = "انتقل إلى أول حقل غير صالح وصححه قبل المتابعة.";
    else if (incomplete[0]) nextAction = "أكمل أول حقل مطلوب غير مكتمل.";
    else if (humanRequired)
      nextAction = "أكمل التحقق البشري ثم استأنف من نفس الصفحة.";
    else if (unavailable)
      nextAction = "غيّر الاختيار الحالي بدل تكرار نفس الطلب.";
    else if (retryable)
      nextAction = "راجع الرسالة ثم أعد المحاولة من نفس الخطوة.";
    else if (hasFailure)
      nextAction = "افتح موضع الخطأ واقرأ الرسالة قبل إعادة التنفيذ.";

    return {
      status,
      issues: issues.slice(0, 4),
      nextAction,
      humanRequired,
      retryable,
      invalidCount: invalid.length,
      incompleteCount: incomplete.length,
      alertCount: alerts.length,
    };
  }

  function collectProblemNodes() {
    const selectors = [
      '[role="alert"]',
      '[aria-live="assertive"]',
      '[aria-invalid="true"]',
      '[class*="error" i]',
      '[class*="invalid" i]',
      '[class*="warning" i]',
      '[id*="error" i]',
      '[data-testid*="error" i]',
      '[data-test*="error" i]',
    ];
    const found = new Set();
    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          if (isVisible(node) && compactText(node.textContent || "").length)
            found.add(node);
        });
      } catch {
        // Ignore unsupported selectors.
      }
    }
    return Array.from(found).slice(0, 30);
  }

  function visibleHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3,[role='heading']"))
      .filter(isVisible)
      .slice(0, 25)
      .map((node) => compactText(node.textContent || ""))
      .join(" ");
  }

  function visibleActions() {
    return Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='submit'],a[href]",
      ),
    )
      .filter(isVisible)
      .slice(0, 100)
      .map(labelOf)
      .filter(Boolean)
      .join(" ");
  }

  function findPrimaryAction(candidates) {
    const strong =
      /\b(submit|continue|next|save|confirm|apply|book|reserve|upload|send|pay|purchase|checkout|login|sign in|register|create|update|finish)\b|إرسال|ارسال|متابعة|التالي|حفظ|تأكيد|تقديم|حجز|رفع|دفع|شراء|تسجيل|إنشاء|انشاء|تحديث|إنهاء|انهاء/i;
    return (
      candidates.find((node) => strong.test(labelOf(node))) ||
      candidates.find(
        (node) =>
          node.tagName === "BUTTON" || node.getAttribute("role") === "button",
      ) ||
      null
    );
  }

  function actionLooksBlocked() {
    const action = findPrimaryAction(
      Array.from(
        document.querySelectorAll(
          "button,[role='button'],input[type='submit']",
        ),
      ).filter(isVisible),
    );
    return Boolean(
      action &&
      (action.disabled || action.getAttribute("aria-disabled") === "true"),
    );
  }

  function isIncomplete(node) {
    if (node.disabled) return false;
    if (node.type === "checkbox" || node.type === "radio") return !node.checked;
    return !String(node.value || "").trim();
  }

  function isVisible(node) {
    if (!node || !node.isConnected) return false;
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    )
      return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function labelOf(node) {
    return compactText(
      `${node.value || ""} ${node.textContent || ""} ${node.getAttribute?.("aria-label") || ""}`,
    );
  }

  function compactText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncate(value, max) {
    const text = compactText(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function categoryLabel(category) {
    return (
      {
        authentication: "تسجيل وهوية",
        booking: "حجز وموعد",
        application: "تقديم طلب",
        upload: "رفع مستندات",
        commerce: "شراء ودفع",
        transfer: "تحويل واستلام",
        settings: "إعدادات وحساب",
        support: "دعم واسترداد",
        generic: "مهمة رقمية",
      }[category] || "مهمة رقمية"
    );
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const value = data?.[STORAGE_KEY];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return {
          checkpoints: Array.isArray(value.checkpoints)
            ? value.checkpoints
            : [],
          activeByOrigin:
            value.activeByOrigin && typeof value.activeByOrigin === "object"
              ? value.activeByOrigin
              : {},
        };
      }
    } catch {
      // Local-only recovery must fail closed without blocking the page.
    }
    return { checkpoints: [], activeByOrigin: {} };
  }

  async function saveState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function pruneState(state) {
    const cutoff = Date.now() - TASK_TTL_MS;
    state.checkpoints = state.checkpoints
      .filter((item) => Date.parse(item.savedAt || "") >= cutoff)
      .slice(0, MAX_CHECKPOINTS);
    const ids = new Set(state.checkpoints.map((item) => item.id));
    for (const [origin, id] of Object.entries(state.activeByOrigin)) {
      if (!ids.has(id)) delete state.activeByOrigin[origin];
    }
  }

  function getActiveCheckpoint(state) {
    const id = state.activeByOrigin[location.origin];
    return state.checkpoints.find((item) => item.id === id) || null;
  }

  async function saveCheckpoint() {
    if (!model?.task) return;
    const now = new Date().toISOString();
    const checkpoint = {
      id: crypto.randomUUID(),
      origin: location.origin,
      url: location.href,
      title: model.task.title,
      category: model.task.category,
      label: model.task.label,
      actionLabel: model.task.actionLabel,
      requiredCount: model.task.requiredCount,
      incompleteRequired: model.task.incompleteRequired,
      fileCount: model.task.fileCount,
      savedAt: now,
      status: "ACTIVE",
    };
    model.stored.checkpoints.unshift(checkpoint);
    model.stored.checkpoints = model.stored.checkpoints.slice(
      0,
      MAX_CHECKPOINTS,
    );
    model.stored.activeByOrigin[location.origin] = checkpoint.id;
    await saveState(model.stored);
    model.active = checkpoint;
    panelOpen = true;
    render();
  }

  async function markComplete() {
    const active = model?.active;
    if (!active) return;
    const item = model.stored.checkpoints.find(
      (entry) => entry.id === active.id,
    );
    if (item) {
      item.status = "COMPLETED";
      item.completedAt = new Date().toISOString();
    }
    delete model.stored.activeByOrigin[location.origin];
    await saveState(model.stored);
    model.active = null;
    render();
  }

  function focusRecoveryTarget() {
    const invalid = Array.from(
      document.querySelectorAll(
        '[aria-invalid="true"],input:invalid,select:invalid,textarea:invalid',
      ),
    ).filter(isVisible);
    const incomplete = Array.from(
      document.querySelectorAll(
        "input[required],select[required],textarea[required]",
      ),
    ).filter((node) => isVisible(node) && isIncomplete(node));
    const problems = collectProblemNodes();
    const target =
      invalid[0] ||
      incomplete[0] ||
      problems[0] ||
      findPrimaryAction(
        Array.from(
          document.querySelectorAll(
            "button,[role='button'],input[type='submit']",
          ),
        ).filter(isVisible),
      );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof target.focus === "function")
      target.focus({ preventScroll: true });
  }

  function resumeCheckpoint() {
    const active = model?.active;
    if (!active) {
      focusRecoveryTarget();
      return;
    }
    if (active.url !== location.href) {
      location.href = active.url;
      return;
    }
    focusRecoveryTarget();
  }

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "xguard-task-recovery-layer";
    host.style.cssText =
      "all:initial;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(620px,calc(100vw - 24px));pointer-events:none";
    shadow = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  function removeHost() {
    host?.remove();
    host = null;
    shadow = null;
  }

  function render() {
    ensureHost();
    const task = model?.task;
    const diagnosis = model?.diagnosis || {
      status: "IDLE",
      issues: [],
      nextAction: "",
    };
    const active = model?.active;
    const statusText =
      diagnosis.status === "HUMAN_REQUIRED"
        ? "تدخل مطلوب"
        : diagnosis.status === "ATTENTION"
          ? "تعطل مكتشف"
          : active
            ? "نقطة رجوع محفوظة"
            : "المهمة تحت المراقبة";
    const statusClass =
      diagnosis.status === "HUMAN_REQUIRED"
        ? "human"
        : diagnosis.status === "ATTENTION"
          ? "attention"
          : "ready";
    const issueHtml = diagnosis.issues.length
      ? diagnosis.issues
          .map((issue) => `<li>${escapeHtml(issue)}</li>`)
          .join("")
      : `<li>لم يكتشف XGuard عطلًا حاليًا.</li>`;
    const taskName = task?.label || active?.label || "مهمة رقمية";
    const action = task?.actionLabel || active?.actionLabel || "";

    shadow.innerHTML = `<style>
      *{box-sizing:border-box}.wrap{direction:rtl;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#12282d;pointer-events:auto}.bar{display:flex;align-items:center;gap:9px;background:#0d292f;color:#fff;border:1px solid #ffffff1f;border-radius:16px;padding:8px 9px 8px 12px;box-shadow:0 14px 42px #00191f3b;backdrop-filter:blur(12px)}.logo{width:31px;height:31px;border-radius:10px;background:#2fbcb3;display:grid;place-items:center;font-weight:950;font-size:14px}.meta{min-width:0;flex:1}.meta b{font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta span{font-size:9px;color:#b8cdcf;display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.status{border-radius:999px;padding:5px 8px;font-size:8px;font-weight:900;white-space:nowrap}.ready{background:#dff8f4;color:#0b716b}.attention{background:#fff1cd;color:#815a00}.human{background:#ffe4e4;color:#8d3131}.toggle{border:0;background:#ffffff16;color:#fff;border-radius:10px;padding:7px 9px;font:800 9px inherit;cursor:pointer}.panel{margin-top:7px;background:#fff;border:1px solid #d9e5e4;border-radius:18px;box-shadow:0 22px 62px #00191f33;overflow:hidden}.head{padding:12px 13px;border-bottom:1px solid #edf2f1;display:flex;gap:9px;align-items:center}.head h3{font-size:12px;margin:0}.head p{font-size:9px;color:#6d8387;margin:3px 0 0}.body{padding:12px}.card{background:#f4fbfa;border:1px solid #d8eeeb;border-radius:13px;padding:10px;margin-bottom:9px}.eyebrow{font-size:8px;color:#0b8982;font-weight:900}.action{font-size:11px;font-weight:850;margin-top:4px}.next{font-size:9px;line-height:1.55;color:#496267;margin-top:5px}.issues{margin:7px 0 0;padding:0 17px 0 0;font-size:9px;line-height:1.7;color:#51686c}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.btn{border:0;border-radius:10px;padding:9px 8px;font:850 9px inherit;cursor:pointer}.primary{background:#0d918c;color:#fff}.secondary{background:#eef6f5;color:#274b50;border:1px solid #d5e5e3}.success{background:#eaf7ef;color:#27643b}.note{font-size:8px;color:#7b9094;line-height:1.55;margin-top:8px}
    </style><div class="wrap"><div class="bar"><span class="logo">X</span><div class="meta"><b>XGuard · ${escapeHtml(taskName)}</b><span>${escapeHtml(action || "حماية استمرارية المهمة واستعادتها عند التعطل")}</span></div><span class="status ${statusClass}">${escapeHtml(statusText)}</span><button class="toggle" id="toggle">${panelOpen ? "إغلاق" : "فتح"}</button></div>${panelOpen ? `<section class="panel"><header class="head"><span class="logo">X</span><div><h3>Task Control & Recovery</h3><p>يحفظ موضع المهمة ويكشف الانحراف ويعيدك إلى أقرب نقطة قابلة للاستكمال.</p></div></header><div class="body"><div class="card"><div class="eyebrow">الحالة الحالية</div><div class="action">${escapeHtml(action || task?.title || active?.title || taskName)}</div><div class="next">${escapeHtml(diagnosis.nextAction)}</div><ul class="issues">${issueHtml}</ul></div><div class="grid"><button class="btn primary" id="recover">افحص موضع التعطل</button><button class="btn secondary" id="checkpoint">${active ? "تحديث نقطة الرجوع" : "احفظ نقطة رجوع"}</button><button class="btn secondary" id="resume">استئناف المهمة</button><button class="btn success" id="complete" ${active ? "" : "disabled"}>تمت المهمة</button></div><div class="note">لا يحفظ XGuard كلمات المرور، رموز التحقق، أرقام البطاقات أو قيم الحقول. نقطة الرجوع تحفظ فقط نوع المهمة، الصفحة، موضعها العام وإحصاءات غير حساسة.</div></div></section>` : ""}</div>`;

    bind("toggle", () => {
      panelOpen = !panelOpen;
      render();
    });
    bind("recover", focusRecoveryTarget);
    bind("checkpoint", saveCheckpoint);
    bind("resume", resumeCheckpoint);
    bind("complete", markComplete);
  }

  function bind(id, handler) {
    shadow?.getElementById(id)?.addEventListener("click", handler);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-invalid", "aria-disabled", "disabled", "class"],
  });
  document.addEventListener("visibilitychange", scheduleScan, {
    passive: true,
  });
  document.addEventListener("input", () => scheduleScan(320), {
    capture: true,
    passive: true,
  });
  document.addEventListener("submit", () => scheduleScan(700), {
    capture: true,
    passive: true,
  });
  document.addEventListener("click", () => scheduleScan(520), {
    capture: true,
    passive: true,
  });
  setTimeout(() => scheduleScan(20), 0);
  setTimeout(() => scheduleScan(900), 900);

  setTimeout(function watchUrl() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan(80);
    }
    setTimeout(watchUrl, 600);
  }, 600);
})();
