"""Run from governance-workerd.mjs, using an isolated TLS endpoint and real ES256."""
import dataclasses
import json
import os
import subprocess
import sys

from xguard_governance import HardHalted, Operation, XGuardAuthorizationGateway

config = json.load(sys.stdin)
kwargs = dict(capability=config["capability"], pinned_jwk=config["public_key"],
              journal=config["journal"], api=config["api"])
gateway = XGuardAuthorizationGateway(**kwargs)
assert gateway is XGuardAuthorizationGateway(**kwargs)
job = Operation(**config["input"], idempotency_key="python-business-order-001")
assert gateway.rank([job])[0][0] == 8090
one = gateway.execute(job)
assert one.status == 201 and json.loads(one.body)["accepted"] is True
assert json.loads(one.body)["request"]["title"] == "مهمة مأذونة"
two = gateway.execute(job)
assert two.replay and two.body == one.body
assert os.stat(config["journal"]).st_mode & 0o777 == 0o600

try:
    gateway.execute(dataclasses.replace(job, idempotency_key="tampered-result-001"))
except HardHalted:
    pass
else:
    raise AssertionError("Forged result must fail signature verification")
assert gateway.halted
# Recovery reads the authentic server-side result without clearing the halt.
recovered = gateway.recover("tampered-result-001")
assert recovered.replay and recovered.status == 201 and gateway.halted
try:
    gateway.execute(dataclasses.replace(job, idempotency_key="must-not-dispatch-001"))
except HardHalted:
    pass
else:
    raise AssertionError("Halted client dispatched a new operation")

# A fresh process observes the durable latch rather than resetting the Singleton.
program = """import json,sys
from xguard_governance import XGuardAuthorizationGateway
g=XGuardAuthorizationGateway(**json.load(sys.stdin))
assert g.halted
print('restart_halted')
"""
restart = subprocess.run([sys.executable, "-c", program], input=json.dumps(kwargs),
                         text=True, capture_output=True, cwd=os.path.dirname(__file__), check=True)
assert "restart_halted" in restart.stdout
print("python_governance_verified")
