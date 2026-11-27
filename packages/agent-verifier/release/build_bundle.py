"""Build reproducible MCPB bytes and the matching official registry entry."""
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZIP_STORED, ZipFile, ZipInfo

here = Path(__file__).resolve().parent
package = here.parent
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((here / "manifest.json").read_text())
version = manifest["version"]
bundle = out / (manifest["name"] + ".mcpb")
files = {"manifest.json": here / "manifest.json", "LICENSE": package.parents[1] / "LICENSE"}
for filename in ("extension.mjs", "io.mjs", "mcp.mjs", "verify.mjs"):
    files["server/" + filename] = package / filename
with ZipFile(bundle, "w", compression=ZIP_STORED) as archive:
    for name, source in sorted(files.items()):
        info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, source.read_bytes())
repo = manifest["repository"]["url"]
metadata = {
    "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    "name": "io.github.moelayyan90/xguard-open-verifier",
    "title": manifest["display_name"], "description": manifest["description"],
    "repository": {"url": repo, "source": "github", "subfolder": "packages/agent-verifier"},
    "version": version, "websiteUrl": manifest["homepage"],
    "packages": [{"registryType": "mcpb",
                  "identifier": f"{repo}/releases/download/open-verifier-v{version}/{bundle.name}",
                  "fileSha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
                  "transport": {"type": "stdio"}}],
}
(out / "server.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(bundle, metadata["packages"][0]["fileSha256"])
