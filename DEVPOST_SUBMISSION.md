# Devpost Submission Copy

## Project name
TrimGate

## Category
Taskmaster

## Tagline
An autonomous print-production gatekeeper that turns messy customer requests and PDFs into safe, routed work orders.

## Inspiration
Commercial print production still has a deceptively expensive human choke point: a production manager reads informal instructions, translates them into manufacturing specs, opens the artwork, checks whether the file actually matches the order, and decides whether it is safe to release. A bad chatbot answer is annoying; a bad production decision can waste an entire run. TrimGate automates that exact friction while keeping objective production checks outside the LLM.

## What it does
TrimGate receives a job event containing unstructured instructions and an optional PDF. Gemini 3.5 Flash extracts a typed print specification without filling in missing facts. A deterministic preflight engine measures the PDF and checks page geometry, trim size, bleed and basic file resources. A second Gemini pass acts as a production gatekeeper, synthesizing the evidence into a READY/HOLD decision. Hard-coded policy prevents the model from overriding deterministic blockers. Finally, TrimGate writes the work order to Firestore and routes it to a production or exceptions queue. Repeated webhook deliveries are idempotent and every stage emits an audit event.

## How we built it
- Gemini 3.5 Flash (`gemini-3.5-flash`)
- Google GenAI SDK for typed structured outputs
- FastAPI/Python for the event-driven orchestration layer
- pypdf for deterministic artwork geometry inspection
- Cloud Run for deployment
- Firestore for durable state, idempotency and queue routing
- Cloud Logging-compatible structured JSON traces

## Challenges
The core design challenge was deciding where AI should *not* have authority. Customer intent is fuzzy and benefits from Gemini; PDF dimensions are objective and should never be negotiated by a language model. TrimGate therefore uses an explicit safety boundary: deterministic preflight findings become hard constraints on the final routing decision.

## Accomplishments
- End-to-end autonomous workflow rather than a chat interface
- Typed Gemini outputs validated with Pydantic
- Deterministic PDF/production safety gate
- Idempotent event processing
- Atomic Firestore persistence of work order + queue action
- Reproducible local demo and Cloud Run deployment path
- A live failure demo that proves the system prevents a real production mistake

## What we learned
Agentic reliability improves when the model is used for interpretation and planning while domain invariants remain deterministic. The strongest architecture was not “let the model decide everything,” but “let the model resolve the messy human layer and prove its actions against machine-checkable constraints.”

## What's next
Add deeper PDF/X checks, font embedding verification, color-space and ink-coverage analysis, machine capability profiles, automated imposition and direct MIS/ERP connectors.
