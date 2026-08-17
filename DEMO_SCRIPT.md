# 4-minute demo script

**0:00–0:25 — Problem**
“Every print shop gets jobs as messy instructions plus artwork. A production manager manually translates the request, opens the PDF, checks it, and decides whether it is safe to release. If that judgment is wrong, the cost is physical waste, not just a bad answer.”

**0:25–0:50 — Architecture**
Show `architecture.svg` in the repo. “PressPilot is an event-driven Taskmaster agent. Gemini 3.5 Flash extracts typed intent. Deterministic Python preflight measures the PDF. Gemini synthesizes the evidence, but cannot override hard blockers. Firestore persists and routes the job.”

**0:50–1:15 — Google Cloud proof**
Show Cloud Run service dashboard, revision, `.run.app` URL, then Cloud Logging entries for a request. Show Firestore collections: `presspilot_jobs`, `production_queue`, `exceptions_queue`.

**1:15–2:35 — Live unedited failure demo**
Open the hosted UI. Explain that the request is for 500 A5 flyers but the bundled artwork is A4. Click **Run autonomous demo** once. Do not cut. Show the returned `SIZE_MISMATCH`, decision `HOLD`, and route `exceptions_queue`. Point out the trace sequence: received → extracted → preflight → decision → persisted.

**2:35–3:15 — Proof of action**
Refresh Firestore and show the new work order plus the corresponding exceptions queue document. Re-run the same demo and show the same job id / idempotency behavior instead of a duplicate order.

**3:15–3:45 — Safety / architecture**
Open the post-model enforcement in `policy.py`. “The LLM interprets messy intent, but deterministic blockers are sovereign. This is how we make autonomous execution safe enough for physical production.”

**3:45–4:00 — Close**
“PressPilot turns a production manager’s repetitive gatekeeping chore into a safe autonomous workflow: interpret, verify, decide, act, and leave an audit trail.”
