"""Serve behind HTTPS; configure UPSTREAM_KEY and register /data in XGuard."""
import os
import secrets
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()

@app.get("/data")
def data(x_api_key: str = Header(default="")):
    expected = os.environ.get("UPSTREAM_KEY", "")
    if not expected or not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"result": "Your useful API result"}
