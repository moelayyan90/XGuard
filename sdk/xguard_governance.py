"""Strict XGuard agent client. Requires Python 3.11+ and cryptography.

Provider keys and wallet signers exist only at the gateway. The one local token
is an expiring, operator-provisioned XGuard capability. OS/container egress
policy is required to constrain other Python code and subprocesses.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import re
import sqlite3
import ssl
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlsplit, urlunsplit

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature


class HardHalted(RuntimeError):
    """No new dispatch is allowed; operator reconciliation is required."""


class PolicyRejected(RuntimeError):
    """A candidate was declined before execution; this is not earned revenue."""


def _json(value):
    # JS and Python must hash identical bytes. Float/NaN and integers above the
    # JS exact range are rejected instead of silently changing the request hash.
    def check(item):
        if item is None or isinstance(item, (str, bool)):
            return
        if type(item) is int and abs(item) <= 2**53 - 1:
            return
        if isinstance(item, list):
            for element in item:
                check(element)
            return
        if isinstance(item, dict) and all(isinstance(k, str) for k in item):
            # JS enumerates integer-like keys first. Reject these to keep the
            # serialization contract explicit rather than depend on key ordering.
            if any(re.fullmatch(r"0|[1-9][0-9]*", k) for k in item):
                raise ValueError("Use named JSON object fields, not integer-like keys")
            for element in item.values():
                check(element)
            return
        raise ValueError("JSON supports strings, booleans, safe integers, arrays and objects")
    check(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _unb64(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid compact proof encoding")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True)
class Operation:
    """An explicit HTTPS API request; vector queries use the same remote path.

    idempotency_key identifies the business operation, not a transport attempt.
    Supply strings for decimal amounts. No financial adapter is implied by a URL.
    """
    target: str
    idempotency_key: str
    method: str = "GET"
    body_json: object = None

    def request(self) -> dict:
        url = urlsplit(self.target)
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.port or url.fragment or not self.target.isascii()
                or "\\" in self.target or any(c.isspace() for c in self.target)):
            raise ValueError("Use an explicit ASCII HTTPS target on default port 443")
        if not re.fullmatch(r"[A-Za-z0-9_:.-]{8,128}", self.idempotency_key):
            raise ValueError("A stable business idempotency key is required")
        if self.method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}:
            raise ValueError("Unsupported HTTP method")
        if self.method in {"GET", "HEAD"} and self.body_json is not None:
            raise ValueError("GET and HEAD cannot have bodies")
        result = {"target": urlunsplit(("https", url.netloc.lower(), url.path or "/", url.query, "")),
                  "method": self.method, "idempotency_key": self.idempotency_key}
        if self.body_json is not None:
            result["body_json"] = self.body_json
        # Snapshot nested caller objects before hashing and sending any bytes.
        return json.loads(_json(result))


def request_digest(request: dict) -> str:
    """Matches core/execution-contract.js for this client's bounded raw requests."""
    has_body = "body_json" in request
    body = _json(request["body_json"]).encode() if has_body else b""
    return _hash(_json({"target": request["target"], "method": request["method"],
                       "headers": [["content-type", "application/json"]] if has_body else [],
                       "body_sha256": _hash(body)}).encode())


@dataclass(frozen=True)
class ExecutionResult:
    status: int
    body: bytes
    evidence: dict
    replay: bool


class XGuardAuthorizationGateway:
    """One agent-side gateway per process; persistent latch survives restart.

    The server enforces signatures, one active call per capability, idempotency,
    and the operator's UTC daily exposure ledger. The Singleton is only a local
    coordination mechanism, not a security boundary against arbitrary code.
    """
    _instance = None
    _creation_lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._creation_lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
            return cls._instance

    def __init__(self, *, capability: str, pinned_jwk: dict, journal: str,
                 api: str = "https://api.xguardgate.com", timeout_seconds: float = 40):
        with self._creation_lock:
            config = (capability, _json(pinned_jwk), str(Path(journal).resolve()), api, timeout_seconds)
            if hasattr(self, "_config"):
                if self._config != config:
                    raise ValueError("The gateway singleton cannot be reconfigured")
                return
            if not re.fullmatch(r"xgc_[a-fA-F0-9]{32}\.[A-Za-z0-9_-]{20,}", capability):
                raise ValueError("Supply a scoped XGuard capability, never a provider key")
            origin = urlsplit(api)
            if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
                    or origin.path not in {"", "/"} or origin.query or origin.fragment):
                raise ValueError("The gateway must be a verified HTTPS origin")
            if not 1 <= timeout_seconds <= 60:
                raise ValueError("Timeout must be between 1 and 60 seconds")
            if pinned_jwk.get("kty") != "EC" or pinned_jwk.get("crv") != "P-256" or "d" in pinned_jwk:
                raise ValueError("Pin a public P-256 verification key supplied by the operator")
            public = ec.EllipticCurvePublicNumbers(int.from_bytes(_unb64(pinned_jwk["x"]), "big"),
                                                  int.from_bytes(_unb64(pinned_jwk["y"]), "big"), ec.SECP256R1()).public_key()
            path = Path(journal)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.fchmod(fd, 0o600)
            os.close(fd)
            self._db = sqlite3.connect(path, check_same_thread=False)
            self._db.execute("PRAGMA synchronous=FULL")
            self._db.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), halted INTEGER NOT NULL)")
            self._db.execute("INSERT OR IGNORE INTO state VALUES(1,0)")
            self._db.execute("CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, request TEXT NOT NULL, state TEXT NOT NULL, ticket TEXT, status INTEGER, body BLOB, proof TEXT)")
            # A process death after SUBMITTED is ambiguous. Never resubmit it.
            self._db.execute("UPDATE state SET halted=1 WHERE EXISTS(SELECT 1 FROM jobs WHERE state='SUBMITTED')")
            self._db.commit()
            self._lock = threading.RLock()
            self._db_lock = threading.RLock()
            self._stopped = threading.Event()
            if self._db.execute("SELECT halted FROM state").fetchone()[0]:
                self._stopped.set()
            self._capability, self._origin = capability, origin
            self._capability_id = capability[4:36].lower()
            self._public_key, self._timeout = public, timeout_seconds
            self._config = config

    @property
    def halted(self) -> bool:
        # Also observe a halt written by another process sharing this journal.
        with self._db_lock:
            return self._stopped.is_set() or bool(self._db.execute("SELECT halted FROM state").fetchone()[0])

    def _active(self):
        if self.halted:
            raise HardHalted("Gateway halted; reconcile stored operations before provisioning a new workload")

    def _post(self, path: str, body: dict, *, control=False):
        if path not in {"/v1/egress/authorize", "/v1/egress/fetch", "/v1/egress/recover", "/v1/egress/halt"}:
            raise ValueError("Gateway route is not allowlisted")
        if not control:
            self._active()
        encoded = _json({**body, "capability": self._capability}).encode()
        if len(encoded) > 32768:
            raise ValueError("Request exceeds the governed client limit")
        # The only application network boundary. TLS verification is mandatory;
        # no redirects, environment proxy lookup, provider sockets or wallet access.
        connection = http.client.HTTPSConnection(self._origin.hostname, self._origin.port or 443,
                                                 timeout=self._timeout, context=ssl.create_default_context())
        try:
            connection.request("POST", path, body=encoded, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(65537)
            if len(data) > 65536 or 300 <= response.status < 400:
                raise ValueError("Oversized response or forbidden redirect")
            return response.status, {k.lower(): v for k, v in response.getheaders()}, data
        finally:
            connection.close()

    def _proof(self, compact: str) -> dict:
        # ProofRail signs the raw decoded payload, not a three-part JWT.
        if not isinstance(compact, str) or len(compact) > 16000:
            raise ValueError("Missing or oversized ProofRail signature")
        payload64, signature64 = compact.split(".")
        payload, signature = _unb64(payload64), _unb64(signature64)
        if len(payload) > 4096 or len(signature) != 64:
            raise ValueError("Invalid ProofRail size")
        der = encode_dss_signature(int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big"))
        self._public_key.verify(der, payload, ec.ECDSA(hashes.SHA256()))
        return json.loads(payload)

    def halt(self):
        self._stopped.set()
        # Persist first; failed connectivity must never reopen the local gate.
        with self._db_lock, self._db:
            self._db.execute("UPDATE state SET halted=1")
        try:
            self._post("/v1/egress/halt", {}, control=True)
        except Exception:
            pass  # Remote stop delivery is uncertain; the local latch stays set.

    def _authorize(self, request):
        status, _, data = self._post("/v1/egress/authorize", request)
        if status == 412:
            raise PolicyRejected("Forecast missing, expired, below the safety floor, or strict mode not configured")
        if status != 200:
            raise ValueError("Gateway refused authorization")
        ticket = json.loads(data)["authorization"]
        payload = self._proof(ticket)
        now = time.time_ns() // 1_000_000
        if (payload.get("typ") != "xguard-governance-authorization" or payload.get("v") != 1
                or payload.get("iss") != "https://api.xguardgate.com" or payload.get("aud") != "xguard-egress"
                or payload.get("capability_id") != self._capability_id
                or payload.get("request_digest") != request_digest(request)
                or payload.get("key_hash") != _hash(request["idempotency_key"].encode())
                or type(payload.get("iat")) is not int or type(payload.get("exp")) is not int
                or not payload["iat"] <= now < payload["exp"] <= payload["iat"] + 30000):
            raise ValueError("Authorization signature is not bound to this current request")
        economics = payload["economics"]
        if (economics.get("basis") != "operator_forecast_not_realized_revenue" or economics.get("currency") != "USD"
                or economics.get("allowed") is not True
                or int(economics["net_expected_usd_micros"]) <= max(0, int(economics["minimum_net_usd_micros"]))):
            raise ValueError("Signed economics do not satisfy the safety floor")
        return ticket, economics

    def _save_result(self, request, status, headers, data, *, replay=False):
        compact = headers.get("x-xguard-proof")
        evidence = self._proof(compact)
        if (evidence.get("typ") != "xguard-proofrail-egress" or evidence.get("iss") != "https://api.xguardgate.com"
                or evidence.get("capability_id") != self._capability_id
                or evidence.get("request_digest") != request_digest(request)
                or evidence.get("body_sha256") != _hash(data)
                or evidence.get("execution_id") != headers.get("x-xguard-execution-id")
                or evidence.get("outcome") == "completed" and evidence.get("upstream_status") != status
                or evidence.get("method") != request["method"]):
            raise ValueError("Result signature or request binding is invalid")
        with self._db_lock, self._db:
            self._db.execute("UPDATE jobs SET state='DONE', status=?, body=?, proof=? WHERE key=?",
                             (status, data, compact, request["idempotency_key"]))
        if not 200 <= status < 300 or evidence.get("outcome") != "completed":
            self.halt()
            raise HardHalted("A signed failed or uncertain outcome was stored; no new work is allowed")
        return ExecutionResult(status, data, evidence, replay or headers.get("x-xguard-replay") == "true")

    def execute(self, operation: Operation) -> ExecutionResult:
        with self._lock:
            self._active()
            request = operation.request()
            try:
                with self._db_lock:
                    prior = self._db.execute("SELECT request FROM jobs WHERE key=?", (request["idempotency_key"],)).fetchone()
                if prior:
                    if prior[0] != _json(request):
                        raise ValueError("A business key was reused with changed input")
                    return self.recover(operation.idempotency_key)
                ticket, _ = self._authorize(request)
                self._active()
                # Commit the exact business intent before any execution attempt.
                # A crash, cancellation or lost reply leaves a recover-only record.
                with self._db_lock, self._db:
                    self._db.execute("INSERT INTO jobs(key,request,state,ticket) VALUES(?,?,'SUBMITTED',?)",
                                     (operation.idempotency_key, _json(request), ticket))
                status, headers, data = self._post("/v1/egress/fetch", {**request, "governance_authorization": ticket})
                return self._save_result(request, status, headers, data)
            except PolicyRejected:
                raise
            except BaseException as error:
                self.halt()
                if isinstance(error, (KeyboardInterrupt, SystemExit)):
                    raise
                raise HardHalted("Execution stopped. Preserve the journal and reconcile; do not create a replacement business key") from error

    def recover(self, idempotency_key: str) -> ExecutionResult:
        """Read-only gateway recovery works while locally halted; never resubmits."""
        with self._lock:
            try:
                with self._db_lock:
                    row = self._db.execute("SELECT request FROM jobs WHERE key=?", (idempotency_key,)).fetchone()
                if row is None:
                    raise ValueError("Unknown local business operation")
                request = json.loads(row[0])
                status, headers, data = self._post("/v1/egress/recover", request, control=True)
                return self._save_result(request, status, headers, data, replay=True)
            except BaseException:
                self.halt()
                raise

    def rank(self, candidates: Iterable[Operation]) -> list[tuple[int, Operation]]:
        """Compare signed net estimates, with no assertion of global optimality."""
        ranked = []
        with self._lock:
            for index, operation in enumerate(candidates):
                if index >= 32:
                    raise ValueError("At most 32 candidates per evaluation batch")
                try:
                    _, economics = self._authorize(operation.request())
                    ranked.append((int(economics["net_expected_usd_micros"]), operation))
                except PolicyRejected:
                    continue
                except BaseException:
                    self.halt()
                    raise
        return sorted(ranked, key=lambda entry: entry[0], reverse=True)


class DailyYieldEngine:
    """Bounded scan/plan/execute loop for explicitly configured opportunities.

    scan_factory and planner must be pure local computations. Every market/API/
    vector read they need must be returned as an Operation and executed here.
    Scans also need operator-supplied, request-bound positive-value forecasts;
    their value is a planning assumption, not customer revenue. No exchanges,
    targets, signers or profitable opportunities are fabricated by this engine.
    """
    def __init__(self, gateway: XGuardAuthorizationGateway, interval_seconds=1.0):
        if interval_seconds < 0.25:
            raise ValueError("Polling faster than 250 ms is disabled; honor provider limits")
        self.gateway, self.interval = gateway, interval_seconds

    def run(self, scan_factory: Callable[[], list[Operation]],
            planner: Callable[[list[ExecutionResult]], list[Operation]], *, max_cycles=1):
        cycles = 0
        while max_cycles is None or cycles < max_cycles:
            self.gateway._active()
            started = time.monotonic()
            scans = scan_factory()
            if len(scans) > 32 or any(op.method not in {"GET", "HEAD", "POST"} for op in scans):
                raise ValueError("Use at most 32 explicit bounded scan requests")
            observations = []
            for scan in scans:
                try:
                    observations.append(self.gateway.execute(scan))
                except PolicyRejected:
                    continue
            # Refresh authorization at execution; ranking tickets may have expired.
            for _, opportunity in self.gateway.rank(planner(observations)):
                try:
                    yield self.gateway.execute(opportunity)
                except PolicyRejected:
                    continue
            cycles += 1
            if max_cycles is None or cycles < max_cycles:
                self.gateway._stopped.wait(max(0, self.interval - (time.monotonic() - started)))
