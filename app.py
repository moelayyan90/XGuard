from __future__ import annotations

import logging
import os
from io import BytesIO

from pypdf import PdfWriter

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

from agent import decide, extract_spec
from models import JobRecord
from storage import get, get_by_idempotency, save
from workflow import run_workflow as orchestrate

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(message)s")
log = logging.getLogger("presspilot")

app = FastAPI(title="PressPilot", version="1.0.0")



async def run_workflow(customer_name: str, request_text: str, artwork_name: str | None, artwork_bytes: bytes | None) -> JobRecord:
    return await orchestrate(
        customer_name,
        request_text,
        artwork_name,
        artwork_bytes,
        extract_spec_fn=extract_spec,
        decide_fn=decide,
        get_by_idempotency_fn=get_by_idempotency,
        save_fn=save,
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "presspilot", "model": os.getenv("GEMINI_MODEL", "gemini-3.5-flash")}


@app.post("/api/jobs", response_model=JobRecord)
async def create_job(
    customer_name: str = Form(...),
    request_text: str = Form(...),
    artwork: UploadFile | None = File(default=None),
):
    if len(request_text.strip()) < 8:
        raise HTTPException(status_code=400, detail="request_text is too short")
    artwork_bytes = await artwork.read() if artwork else None
    if artwork_bytes and len(artwork_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Artwork exceeds 15 MB demo limit")
    return await run_workflow(customer_name, request_text, artwork.filename if artwork else None, artwork_bytes)


@app.post("/api/demo", response_model=JobRecord)
async def demo_job():
    buf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595.28, height=841.89)  # A4, intentionally wrong for A5.
    writer.write(buf)
    return await run_workflow(
        "Demo Customer",
        "Please print 500 A5 flyers, finished size 148 x 210 mm, on 150 gsm gloss, full colour both sides, deliver Friday.",
        "intentional-a4-demo.pdf",
        buf.getvalue(),
    )


@app.get("/api/jobs/{job_id}", response_model=JobRecord)
def read_job(job_id: str):
    record = get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="job not found")
    return record


@app.get("/", response_class=HTMLResponse)
def index():
    return """<!doctype html>
<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<title>PressPilot — Autonomous Print Production Gatekeeper</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#101114;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1100px;margin:auto;padding:44px 20px}.eyebrow{font-weight:800;letter-spacing:.16em;font-size:12px}.hero{display:grid;grid-template-columns:1.3fr .7fr;gap:28px;align-items:center}.card{background:white;border:1px solid #dde2ea;border-radius:18px;padding:24px;box-shadow:0 8px 30px #14213d10}h1{font-size:56px;line-height:.95;margin:12px 0 18px}p{color:#596170;line-height:1.6}.pill{display:inline-block;padding:7px 10px;border:1px solid #d5dae3;border-radius:999px;margin:4px 4px 0 0;font-size:12px}.flow{font-family:ui-monospace,monospace;font-size:13px;line-height:2}.arrow{color:#8d95a5}.button{background:#111827;color:#fff;border:0;border-radius:10px;padding:13px 18px;font-weight:750;cursor:pointer}.button:disabled{opacity:.5}.result{white-space:pre-wrap;background:#0c111b;color:#d9e1ee;border-radius:14px;padding:18px;min-height:190px;overflow:auto;font:12px/1.5 ui-monospace,monospace;margin-top:16px}.status{font-size:32px;font-weight:900}.ready{color:#087a55}.hold{color:#b42318}@media(max-width:800px){.hero{grid-template-columns:1fr}h1{font-size:42px}}
</style></head><body><div class='wrap'><div class='hero'><section><div class='eyebrow'>ALL THINGS AGENTIC HACKATHON · TASKMASTER</div><h1>PressPilot</h1><p>Turns messy print requests and artwork into production-safe work orders. Gemini interprets the request; deterministic preflight verifies the PDF; the agent routes the job to production or exceptions without a production manager babysitting every step.</p><div><span class='pill'>Gemini 3.5 Flash</span><span class='pill'>Google GenAI SDK</span><span class='pill'>Cloud Run</span><span class='pill'>Firestore</span></div></section><aside class='card'><strong>Autonomous workflow</strong><div class='flow'>Webhook / upload<br><span class='arrow'>↓</span> Gemini spec extraction<br><span class='arrow'>↓</span> deterministic PDF preflight<br><span class='arrow'>↓</span> Gemini risk gate<br><span class='arrow'>↓</span> Firestore work order + queue</div></aside></div><section class='card' style='margin-top:28px'><h2>Live failure demo</h2><p>The demo-generated A4 artwork conflicts with an A5 order. PressPilot should catch the size mismatch and HOLD it before production.</p><button id='run' class='button'>Run autonomous demo</button><div id='headline'></div><div id='out' class='result'>Ready.</div></section></div><script>
const b=document.getElementById('run'),o=document.getElementById('out'),h=document.getElementById('headline');b.onclick=async()=>{b.disabled=true;o.textContent='Running intake → preflight → decision → persistence…';h.innerHTML='';try{const r=await fetch('/api/demo',{method:'POST'});const j=await r.json();h.innerHTML=`<p class='status ${j.decision.status==='READY'?'ready':'hold'}'>${j.decision.status} → ${j.decision.route}</p>`;o.textContent=JSON.stringify(j,null,2)}catch(e){o.textContent=String(e)}finally{b.disabled=false}};
</script></body></html>"""
