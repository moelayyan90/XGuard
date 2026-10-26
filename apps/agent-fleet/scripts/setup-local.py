"""Install pinned official CPU inference assets; never provision paid inference."""
import hashlib
import json
import os
import pathlib
import platform
import secrets
import shutil
import tarfile
import urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
ROOT = APP / '.runtime'
LOCK = json.loads((APP / 'models.lock.json').read_text())

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def download(item):
    target = ROOT / item['filename']
    if target.exists() and target.stat().st_size == item['size'] and digest(target) == item['sha256']:
        return target
    temporary = target.with_suffix(target.suffix + '.part')
    if temporary.exists():
        temporary.unlink()
    request = urllib.request.Request(item['url'], headers={'User-Agent': 'XGuardAgentFleetSetup/1.0'})
    count = 0
    try:
        with urllib.request.urlopen(request, timeout=45) as response, temporary.open('xb') as output:
            temporary.chmod(0o600)
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > item['size']:
                    raise RuntimeError('Asset exceeded pinned byte size')
                output.write(chunk)
        if count != item['size'] or digest(temporary) != item['sha256']:
            raise RuntimeError('Asset does not match pinned size and SHA-256')
        temporary.replace(target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return target

def main():
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        raise SystemExit('This pinned installer supports Linux x86_64. Use a local llama.cpp server on other systems.')
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    ROOT.chmod(0o700)
    print('Downloading and verifying the official CPU engine...', flush=True)
    archive = download(LOCK['engine'])
    engine_dir = ROOT / 'engine'
    engine_dir.mkdir(mode=0o700, exist_ok=True)
    with tarfile.open(archive, 'r:gz') as bundle:
        # Python's data filter rejects absolute paths, traversal and unsafe links.
        bundle.extractall(engine_dir, filter='data')
    candidates = list(engine_dir.rglob('llama-server'))
    if len(candidates) != 1:
        raise RuntimeError('Pinned archive did not contain exactly one llama-server')
    candidates[0].chmod(0o700)
    print('Downloading and verifying the official local model...', flush=True)
    model = download(LOCK['model'])
    manifest = {'engine': str(candidates[0]), 'model': str(model), 'model_id': LOCK['model']['id'], 'model_sha256': LOCK['model']['sha256']}
    path = ROOT / 'installed.json'
    path.write_text(json.dumps(manifest, indent=2))
    path.chmod(0o600)
    key_path = ROOT / 'model.key'
    if key_path.is_symlink():
        raise RuntimeError('Local credential cannot be a symlink')
    if not key_path.exists():
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(secrets.token_hex(32))
    print(json.dumps({'installed': True, 'model': LOCK['model']['id'], 'paid_api_calls': 0}), flush=True)

if __name__ == '__main__':
    main()
