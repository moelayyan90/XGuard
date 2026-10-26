export function setText(element, value) {
  element.textContent = value === undefined || value === null ? '—' : String(value);
  return element;
}

const STATES = {
  queued: ['في الانتظار', 'queued'], pending: ['في الانتظار', 'queued'],
  running: ['قيد التنفيذ', 'running'], active: ['قيد التنفيذ', 'running'],
  completed: ['مكتملة', 'completed'], succeeded: ['مكتملة', 'completed'], done: ['مكتملة', 'completed'],
  failed: ['تعذّرت', 'failed'], error: ['تعذّرت', 'failed'], blocked: ['محجوبة', 'failed'],
  paused: ['متوقفة', 'neutral'], idle: ['متاح', 'neutral'], registered: ['مسجّل', 'neutral'], ready: ['متاح', 'neutral'],
};
const ROLE_NAMES = {
  researcher: 'البحث والتحقق', research: 'البحث والتحقق', scout: 'رصد الفرص',
  analyst: 'التحليل', writer: 'الكتابة', reviewer: 'مراجعة الجودة',
  developer: 'التطوير', builder: 'التنفيذ', planner: 'التخطيط',
  designer: 'التصميم', verifier: 'التحقق', compliance: 'مراجعة الالتزام',
  market_researcher: 'بحث السوق', demand_validator: 'التحقق من الطلب', competitor_researcher: 'بحث المنافسين',
  pricing_researcher: 'بحث الأسعار', documentation_researcher: 'بحث التوثيق', customer_problem_analyst: 'تحليل احتياج العميل',
  product_planner: 'تخطيط المنتج', software_builder: 'البرمجة', data_processor: 'معالجة البيانات', workflow_builder: 'بناء الأتمتة',
  api_integrator: 'تكامل الواجهات', test_engineer: 'الاختبارات', security_reviewer: 'مراجعة الأمان', quality_reviewer: 'مراجعة الجودة',
  documentation_writer: 'كتابة التوثيق', localization_editor: 'الترجمة والتحرير', cost_analyst: 'تحليل التكلفة', licensing_researcher: 'بحث التراخيص',
  delivery_packager: 'تجهيز التسليم', evidence_auditor: 'تدقيق الأدلة',
};
const number = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? new Intl.NumberFormat('en-US').format(Number(value)) : '—';
const date = value => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('ar-JO-u-nu-latn', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
};
const statusOf = item => String(item?.status ?? item?.state ?? 'registered').toLowerCase();
const roleName = role => ROLE_NAMES[role] ?? role ?? 'دور غير محدد';

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const state = { view: 'overview', agentOffset: 0, jobOffset: 0, limit: 25, role: '', agents: [], jobs: [], stats: {}, runner: {}, busy: false, refreshing: false };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) setText(node, text);
    return node;
  };
  function notice(id, message) {
    setText($(id), message || '');
    $(id).classList.toggle('hidden', !message);
  }
  function message(text) {
    notice('global-error', ''); notice('global-message', text);
  }
  async function request(path, input) {
    const response = await fetch(path, {
      method: input === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
      headers: input === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `تعذّر الطلب (${response.status}).`);
    return data;
  }
  function badge(status) {
    const [label, className] = STATES[String(status).toLowerCase()] ?? [String(status), 'neutral'];
    return el('span', `badge ${className}`, label);
  }
  function firstNumber(...values) { return values.find(value => typeof value === 'number' && Number.isFinite(value)); }
  function renderStatus(data) {
    state.stats = data.stats ?? {}; state.runner = data.runner ?? {};
    const stats = state.stats;
    setText($('metric-registered'), number(firstNumber(stats.registeredAgents, stats.agentCount, stats.agentsTotal, stats.agents?.registered, stats.agents?.total, typeof stats.agents === 'number' ? stats.agents : undefined)));
    setText($('metric-active'), number(firstNumber(stats.runningAgents, stats.activeAgents, stats.activeLeases, stats.running, stats.agents?.running, stats.agents?.working)));
    setText($('metric-completed'), number(firstNumber(stats.completedJobs, stats.jobs?.completed, stats.jobs?.succeeded, stats.completed)));
    setText($('queued-count'), number(firstNumber(stats.queuedJobs, stats.jobs?.queued, stats.jobs?.pending, stats.queued)));
    const runner = state.runner;
    const label = runner.running ? (runner.paused ? 'إيقاف الجدولة مطلوب' : 'دفعة قيد التنفيذ') : runner.paused ? 'الجدولة متوقفة' : data.model?.reachable === false ? 'النموذج المحلي غير متصل' : runner.lastError ? 'تعذّرت الدفعة الأخيرة' : 'جاهز لتشغيل دفعة';
    setText($('runner-state'), label);
    $('runner-state').className = `badge ${runner.lastError ? 'failed' : runner.running ? 'running' : 'neutral'}`;
    $('run-button').disabled = Boolean(runner.running);
    setText($('runner-time'), runner.finishedAt ? date(runner.finishedAt) : runner.startedAt ? date(runner.startedAt) : 'لم تبدأ دفعة بعد');
    notice('runner-error', runner.lastError);
    $('connection-dot').className = 'connection-dot connected'; setText($('connection-text'), 'الخادم المحلي متصل');
    setText($('last-updated'), `آخر قراءة: ${date(new Date().toISOString())}`);
    const roles = stats.roles ?? stats.agents?.roles;
    if (roles && typeof roles === 'object') updateRoles(Array.isArray(roles) ? roles.map(item => typeof item === 'string' ? item : item.role) : Object.keys(roles));
  }
  function updateRoles(roles) {
    const selected = $('role-filter').value;
    const known = new Set([...$('role-filter').options].map(option => option.value));
    for (const role of roles) {
      if (!role || known.has(role)) continue;
      const option = el('option', '', roleName(role)); option.value = role; $('role-filter').append(option); known.add(role);
    }
    $('role-filter').value = selected;
  }
  function assign(agent) {
    showView('overview'); $('job-agent').value = agent.id ?? agent.agentId;
    $('create-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('job-instruction').focus();
  }
  function renderAgents(data) {
    state.agents = data.items ?? data.agents ?? [];
    updateRoles(state.agents.map(agent => agent.role));
    $('agent-options').replaceChildren(...state.agents.map(agent => {
      const option = el('option', '', `${agent.name ?? agent.id} · ${roleName(agent.role)}`); option.value = agent.id ?? agent.agentId; return option;
    }));
    $('agents-table').replaceChildren(...state.agents.map(agent => {
      const tr = el('tr'); const name = el('td');
      name.append(el('strong', '', agent.name ?? agent.id ?? agent.agentId), el('span', 'agent-id', agent.id ?? agent.agentId));
      const status = el('td'); status.append(badge(statusOf(agent)));
      const action = el('td'); const button = el('button', 'button secondary small', 'إسناد مهمة'); button.type = 'button'; button.addEventListener('click', () => assign(agent)); action.append(button);
      tr.append(name, el('td', '', roleName(agent.role)), status, action); return tr;
    }));
    if (!state.agents.length) { const tr = el('tr'); const td = el('td', 'empty-state', 'لا يوجد وكلاء بهذا الدور.'); td.colSpan = 4; tr.append(td); $('agents-table').append(tr); }
    if (typeof data.total === 'number') setText($('agents-total'), `${number(data.total)} وكيل`);
    setText($('agents-range'), range(state.agentOffset, state.agents.length, data.total));
    $('agents-prev').disabled = state.agentOffset === 0;
    $('agents-next').disabled = typeof data.total === 'number' ? state.agentOffset + state.limit >= data.total : state.agents.length < state.limit;
  }
  function range(offset, count, total) { return count ? `${number(offset + 1)}–${number(offset + count)}${typeof total === 'number' ? ` من ${number(total)}` : ''}` : 'لا توجد نتائج'; }
  function jobRow(job) {
    const row = el('div', 'job-row'); const main = el('div', 'job-main');
    const title = el('button', 'job-title', job.instruction ?? job.title ?? job.id); title.type = 'button'; title.addEventListener('click', () => showJob(job.id ?? job.jobId));
    main.append(title, el('div', 'job-meta', `${job.agentId ?? job.agent_id ?? '—'} · ${job.id ?? job.jobId ?? '—'}`));
    row.append(main, badge(statusOf(job)), el('span', 'job-date', date(job.updatedAt ?? job.createdAt ?? job.created_at))); return row;
  }
  function renderJobs(data) {
    state.jobs = data.items ?? data.jobs ?? [];
    $('all-jobs').replaceChildren(...(state.jobs.length ? state.jobs.map(jobRow) : [el('p', 'empty-state', 'لا توجد مهام في هذه الصفحة. ابدأ بإسناد مهمة واضحة.')])) ;
    setText($('jobs-range'), range(state.jobOffset, state.jobs.length, data.total));
    $('jobs-prev').disabled = state.jobOffset === 0;
    $('jobs-next').disabled = typeof data.total === 'number' ? state.jobOffset + 20 >= data.total : state.jobs.length < 20;
    if (state.jobOffset === 0) $('recent-jobs').replaceChildren(...(state.jobs.length ? state.jobs.slice(0, 5).map(jobRow) : [el('p', 'empty-state', 'لا توجد مهام بعد. أسند المهمة الأولى للبدء.')])) ;
  }
  async function showJob(id) {
    try {
      const data = await request(`/api/jobs/${encodeURIComponent(id)}`); const job = data.job ?? data;
      const container = $('job-detail'); container.replaceChildren(); container.append(badge(statusOf(job)));
      for (const [label, value, isOutput] of [
        ['المهمة', job.instruction ?? job.title, false], ['الوكيل', job.agentId ?? job.agent_id, false],
        ['النتيجة', job.output ?? job.result?.text ?? job.result?.output ?? job.result ?? job.error ?? 'لم تتوفر نتيجة بعد.', true],
      ]) {
        container.append(el('p', 'detail-label', label), el(isOutput ? 'pre' : 'div', `detail-value${isOutput ? ' code' : ''}`, typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value));
      }
      if (['failed', 'error', 'blocked'].includes(statusOf(job))) {
        const actions = el('div', 'detail-actions'); const retry = el('button', 'button secondary', 'إعادة إدراج المهمة'); retry.type = 'button';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { await request(`/api/jobs/${encodeURIComponent(id)}/retry`, {}); $('job-dialog').close(); message('أُعيد إدراج المهمة. راجعها قبل تشغيل دفعة أخرى.'); await refresh(); }
          catch (error) { notice('global-error', error.message); } finally { retry.disabled = false; }
        }); actions.append(retry); container.append(actions);
      }
      if (!$('job-dialog').open) $('job-dialog').showModal();
    } catch (error) { notice('global-error', error.message); }
  }
  async function loadAgents() {
    const params = new URLSearchParams({ limit: String(state.limit), offset: String(state.agentOffset) });
    if (state.role) params.set('role', state.role);
    renderAgents(await request(`/api/agents?${params}`));
  }
  async function loadJobs() { renderJobs(await request(`/api/jobs?limit=20&offset=${state.jobOffset}`)); }
  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      const [status] = await Promise.all([request('/api/status'), loadJobs(), state.view === 'agents' ? loadAgents() : Promise.resolve()]);
      renderStatus(status);
    } catch (error) {
      $('connection-dot').className = 'connection-dot failed'; setText($('connection-text'), 'تعذّر تحديث الحالة');
      notice('global-error', error.message || 'تعذّر الاتصال بالخادم المحلي.');
    } finally { state.refreshing = false; }
  }
  function showView(view) {
    if (!['overview', 'agents', 'jobs'].includes(view)) view = 'overview';
    state.view = view;
    for (const name of ['overview', 'agents', 'jobs']) $(`view-${name}`).classList.toggle('hidden', name !== view);
    for (const button of document.querySelectorAll('.nav-item')) { const active = button.dataset.view === view; button.classList.toggle('selected', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    const titles = { overview: ['نظرة عامة', 'غرفة الوكلاء', 'أسند العمل، تابع التنفيذ، وراجع النتيجة في مكان واحد.'], agents: ['الوكلاء', 'دليل الوكلاء', 'أدوار واضحة وإسناد مباشر، مع عرض حالة التنفيذ الفعلية.'], jobs: ['المهام والنتائج', 'سجل العمل', 'راجع ما نُفّذ، وما تعذّر، وما ينتظر بدء العمل.'] };
    setText($('page-label'), titles[view][0]); setText($('page-title'), titles[view][1]); setText($('page-description'), titles[view][2]);
    if (view === 'agents') loadAgents().catch(error => notice('global-error', error.message));
    if (view === 'jobs') loadJobs().catch(error => notice('global-error', error.message));
  }
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => showView(button.dataset.view));
  $('new-job-shortcut').addEventListener('click', () => { showView('overview'); $('create-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('job-instruction').focus(); });
  $('close-dialog').addEventListener('click', () => $('job-dialog').close());
  $('job-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('create-button'); button.disabled = true;
    try {
      const result = await request('/api/jobs', { agentId: $('job-agent').value.trim(), instruction: $('job-instruction').value.trim(), idempotencyKey: crypto.randomUUID(), maxSteps: Number($('job-max-steps').value), maxOutputTokens: Number($('job-max-tokens').value) });
      $('job-instruction').value = ''; state.jobOffset = 0; message(`أُسندت المهمة ${result.job?.id ?? ''} وأُضيفت إلى الانتظار.`); await refresh();
    } catch (error) { notice('global-error', error.message); } finally { button.disabled = false; }
  });
  $('run-form').addEventListener('submit', async event => {
    event.preventDefault(); $('run-button').disabled = true;
    try { await request('/api/run', { limit: Number($('batch-limit').value), concurrency: Number($('batch-concurrency').value) }); message('بدأت الدفعة. يمكنك متابعة حالة كل مهمة أثناء التنفيذ.'); await refresh(); }
    catch (error) { notice('global-error', error.message); $('run-button').disabled = false; }
  });
  $('pause-button').addEventListener('click', async () => {
    $('pause-button').disabled = true;
    try { await request('/api/pause', {}); message('أُوقف بدء مهام أخرى. قد تستمر المهام التي بدأت بالفعل حتى تنتهي.'); await refresh(); }
    catch (error) { notice('global-error', error.message); } finally { $('pause-button').disabled = false; }
  });
  $('agent-filter').addEventListener('submit', event => { event.preventDefault(); state.role = $('role-filter').value; state.agentOffset = 0; loadAgents().catch(error => notice('global-error', error.message)); });
  for (const [id, kind, delta] of [['agents-prev', 'agents', -25], ['agents-next', 'agents', 25], ['jobs-prev', 'jobs', -20], ['jobs-next', 'jobs', 20]]) {
    $(id).addEventListener('click', () => { if (kind === 'agents') state.agentOffset = Math.max(0, state.agentOffset + delta); else state.jobOffset = Math.max(0, state.jobOffset + delta); (kind === 'agents' ? loadAgents() : loadJobs()).catch(error => notice('global-error', error.message)); });
  }
  $('refresh-jobs').addEventListener('click', () => loadJobs().catch(error => notice('global-error', error.message)));
  loadAgents().catch(error => notice('global-error', error.message)); refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
