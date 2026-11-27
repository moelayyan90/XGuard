"""Independent x402 merchant. The keys and transaction below are public test data."""
import argparse
import base64
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils


def encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def wire(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def merchant(instant, key_number=1):
    # Predictable keys and RFC6979 signatures make the published vectors byte-reproducible.
    private = ec.derive_private_key(key_number, ec.SECP256R1())
    point = private.public_key().public_numbers()
    kid = f"did:web:maps.example#test-{key_number}"
    public = {"kty": "EC", "crv": "P-256", "kid": kid,
              "x": encode(point.x.to_bytes(32, "big")), "y": encode(point.y.to_bytes(32, "big"))}

    def signed(payload):
        protected = encode(wire({"alg": "ES256", "kid": kid}))
        message = protected + "." + encode(wire(payload))
        der = private.sign(message.encode("ascii"), ec.ECDSA(hashes.SHA256(), deterministic_signing=True))
        r, s = utils.decode_dss_signature(der)
        return {"format": "jws", "signature": message + "." + encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}

    url = "https://maps.example/map"
    network = "eip155:84532"
    payer = "0x" + "55" * 20
    tx = "0x" + "aa" * 32
    terms = {"scheme": "exact", "network": network, "asset": "0x" + "33" * 20,
             "payTo": "0x" + "22" * 20, "amount": "125"}
    offer = signed({"version": 1, "resourceUrl": url, **terms, "validUntil": instant + 60})
    receipt = signed({"version": 1, "resourceUrl": url, "network": network,
                      "payer": payer, "transaction": tx, "issuedAt": instant})
    option = {**terms, "maxTimeoutSeconds": 45, "extra": {"name": "Fixture USD", "version": "2"}}
    return {
        "policy": {"version": 1, "network": network, "asset": terms["asset"], "maxPerCallAtomic": "125",
                   "maxPer24hAtomic": "250", "resources": [{"resourceUrl": url, "payTo": terms["payTo"],
                                                           "publicKey": public}]},
        "offerInput": {"request": {"method": "GET", "resourceUrl": url, "body": ""},
                      "challenge": {"x402Version": 2, "resource": {"url": url}, "accepts": [option],
                                    "extensions": {"offer-receipt": {"info": {"offers": [offer]}}}}},
        "receiptInput": {"expected": {"resourceUrl": url, "payer": payer, "transaction": tx, "notBefore": instant - 10},
                         "settlement": {"success": True, "network": network, "payer": payer, "transaction": tx,
                                        "extensions": {"offer-receipt": {"info": {"receipt": receipt}}}}},
    }


def vectors(instant):
    original = merchant(instant)
    current = merchant(instant, 2)
    current["policy"]["resources"][0]["retiredReceiptKeys"] = [
        {"publicKey": original["policy"]["resources"][0]["publicKey"], "lastIssuedAt": instant}
    ]
    cases = [
        {"name": "current offer", "action": "offer", "want": "reviewed"},
        {"name": "current receipt", "action": "receipt", "want": "merchant_receipt_verified"},
        {"name": "exclusive expiry", "action": "offer", "clockOffset": 60, "want": "expired_or_undated_offer"},
        {"name": "unsupported wire price", "action": "offer",
         "set": [["challenge", "accepts", 0, "amount"], "124"], "want": "terms_do_not_match_signature"},
        {"name": "payer differs", "action": "receipt", "set": [["expected", "payer"], "0x" + "01"*20],
         "want": "settlement_mismatch"},
        {"name": "unsigned URL differs", "action": "offer", "set": [["challenge", "resource", "url"], "https://maps.example/other"],
         "want": "unsupported_challenge"},
        {"name": "retired offer", "action": "offer", "old": True, "want": "untrusted_signer_or_header"},
        {"name": "retired receipt at cutoff", "action": "receipt", "old": True, "want": "merchant_receipt_verified"},
        {"name": "retired receipt after cutoff", "action": "receipt", "old": True,
         "cutoffOffset": -1, "want": "retired_key_cutoff"},
    ]
    return {"profile": "xguard-open-verifier/1", "clock": instant, "current": current,
            "prior": {"offerInput": original["offerInput"], "receiptInput": original["receiptInput"]}, "cases": cases}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/map":
            self.send_error(404)
            return
        # Serve the signed public fixture origin from loopback for protocol tests.
        body = wire(merchant(int(time.time()))["offerInput"]["challenge"])
        self.send_response(402)
        self.send_header("Content-Type", "application/json")
        self.send_header("PAYMENT-REQUIRED", base64.b64encode(body).decode("ascii"))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--vectors", action="store_true")
    parser.add_argument("--serve", type=int, metavar="LOOPBACK_PORT")
    options = parser.parse_args()
    if options.serve is not None:
        HTTPServer(("127.0.0.1", options.serve), Handler).serve_forever()
    else:
        print(json.dumps(vectors(1800000000) if options.vectors else merchant(int(time.time())), indent=2))
