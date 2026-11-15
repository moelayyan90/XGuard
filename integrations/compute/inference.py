"""Base USDC x402 v2 client. Requires eth-account; never prints a private key.

Set XGUARD_BUYER_MAX_ATOMIC, XGUARD_COMPUTE_MODEL and
XGUARD_BUYER_PRIVATE_KEY. A saved recovery file is reused without a new payment.
"""
import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.xguardgate.com"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
maximum = int(os.environ["XGUARD_BUYER_MAX_ATOMIC"])
if maximum <= 0:
    raise ValueError("An explicit positive buyer budget is required")
recovery = Path(os.environ.get("XGUARD_COMPUTE_RECOVERY_FILE", "xguard-compute-recovery.json"))


def request(path, body=None, headers=None):
    headers = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, json.loads(response.read())


if recovery.exists():
    saved = json.loads(recovery.read_text())
    status, result = request("/v1/compute/executions/" + saved["quote_id"], headers={"X-XGuard-Quote": saved["quote"]})
else:
    from eth_account import Account

    key = secrets.token_hex(16)
    body = {"model": os.environ["XGUARD_COMPUTE_MODEL"], "messages": [{"role": "user", "content": "Explain gravity in one sentence."}], "max_tokens": 64, "max_amount_atomic": str(maximum), "accept_provider_terms": True}
    status, quote = request("/v1/inference/quote", body, {"Idempotency-Key": key})
    if status != 200:
        raise RuntimeError(json.dumps(quote))
    offer = quote["payment"]
    requirement = offer["accepts"][0]
    if offer["x402Version"] != 2 or offer["resource"]["url"] != API + "/v1/inference/execute" or requirement["scheme"] != "exact" or requirement["network"] != "eip155:8453" or requirement["asset"].lower() != USDC.lower() or not 0 < int(requirement["amount"]) <= maximum:
        raise ValueError("Offer differs from the expected network, asset, route or budget")
    account = Account.from_key(os.environ["XGUARD_BUYER_PRIVATE_KEY"])
    now = int(time.time())
    authorization = {"from": account.address, "to": requirement["payTo"], "value": requirement["amount"], "validAfter": str(now - 10), "validBefore": str(now + 100), "nonce": "0x" + secrets.token_hex(32)}
    types = {"TransferWithAuthorization": [{"name": name, "type": kind} for name, kind in [("from", "address"), ("to", "address"), ("value", "uint256"), ("validAfter", "uint256"), ("validBefore", "uint256"), ("nonce", "bytes32")]]}
    message = {**authorization, "value": int(authorization["value"]), "validAfter": int(authorization["validAfter"]), "validBefore": int(authorization["validBefore"])}
    signed = account.sign_typed_data({"name": "USD Coin", "version": "2", "chainId": 8453, "verifyingContract": USDC}, types, message)
    signature = "0x" + bytes(signed.signature).hex()
    payload = {"x402Version": 2, "resource": offer["resource"], "accepted": requirement, "payload": {"signature": signature, "authorization": authorization}, "extensions": offer["extensions"]}
    proof = base64.b64encode(json.dumps(payload).encode()).decode()
    saved = {"quote_id": quote["quote_id"], "quote": quote["quote"], "body": body, "idempotency_key": key, "payment_signature": proof}
    descriptor = os.open(recovery, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(saved, stream)
    status, result = request("/v1/inference/execute", body, {"Idempotency-Key": key, "X-XGuard-Quote": quote["quote"], "Payment-Signature": proof})
print(json.dumps({"http_status": status, "delivery": result}, indent=2))
