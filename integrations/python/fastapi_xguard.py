"""FastAPI x402 seller using XGuard as the facilitator.

Install:
    pip install "x402[fastapi,evm]" fastapi uvicorn

Run:
    PAY_TO=0x... uvicorn integrations.python.fastapi_xguard:app --port 4021
"""

import os

from fastapi import FastAPI
from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
from x402.http.middleware.fastapi import PaymentMiddlewareASGI
from x402.http.types import RouteConfig
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.server import x402ResourceServer

XGUARD_FACILITATOR_URL = "https://api.xguardgate.com"
NETWORK = "eip155:8453"
PAY_TO = os.environ.get("PAY_TO")
if not PAY_TO:
    raise RuntimeError("PAY_TO is required")

facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=XGUARD_FACILITATOR_URL))
server = x402ResourceServer(facilitator)
server.register(NETWORK, ExactEvmServerScheme())

routes = {
    "GET /premium": RouteConfig(
        accepts=[
            PaymentOption(
                scheme="exact",
                pay_to=PAY_TO,
                price="$0.01",
                network=NETWORK,
            )
        ],
        mime_type="application/json",
        description="Premium FastAPI response settled through XGuard",
    )
}

app = FastAPI()
app.add_middleware(PaymentMiddlewareASGI, routes=routes, server=server)


@app.get("/premium")
async def premium():
    return {"ok": True, "facilitator": XGUARD_FACILITATOR_URL}
