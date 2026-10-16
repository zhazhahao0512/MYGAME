#!/usr/bin/env python3
"""Root-owned deployment helper. Configuration: /etc/mygame-deploy.json."""
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')


def unpack(data, destination):
    """Never extract archive links, devices, absolute paths or traversal entries."""
    count = total = 0
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            count += 1
            path = PurePosixPath(member.name)
            if count > 2000 or path.is_absolute() or '..' in path.parts or '\\' in member.name:
                raise ValueError('Unsafe archive path or too many entries')
            if not path.parts or path.parts[0] != 'MYGAME-server':
                raise ValueError('Unexpected archive root')
            rel = Path(*path.parts[1:])
            if str(rel) in seen:
                raise ValueError('Duplicate archive path')
            seen.add(str(rel))
            out = destination / rel
            if member.isdir():
                out.mkdir(parents=True, exist_ok=True, mode=0o755)
            elif member.isfile():
                total += member.size
                if total > 64 * 1024 * 1024:
                    raise ValueError('Uncompressed package exceeds 64 MiB')
                out.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with archive.extractfile(member) as source, out.open('xb') as target:
                    shutil.copyfileobj(source, target)
                out.chmod(0o644)
            else:
                raise ValueError('Archive links and special files are not allowed')
    checks = {}
    for line in (destination / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        path = PurePosixPath(name)
        if not HASH.fullmatch(digest) or path.is_absolute() or '..' in path.parts or '\\' in name or name in checks:
            raise ValueError('Invalid checksum manifest')
        checks[name] = digest
    actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file() and p != destination / 'SHA256SUMS'}
    if actual != set(checks):
        raise ValueError('Checksum manifest does not cover exactly the package files')
    for name, digest in checks.items():
        if hashlib.sha256((destination / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Package file checksum mismatch')
    for required in ['server.mjs', 'dist/index.html', 'VERSION.json']:
        if not (destination / required).is_file():
            raise ValueError('Missing required file: ' + required)


def link_to(link, target):
    temporary = link.with_name(link.name + '.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, link)


def keep_assets(old, new):
    """Keep old hashed assets reachable by clients already running an older page."""
    previous = old / 'dist/assets'
    if not previous.is_dir():
        return
    current = new / 'dist/assets'
    current.mkdir(parents=True, exist_ok=True)
    for source in previous.rglob('*'):
        if source.is_symlink():
            raise ValueError('Unexpected link in old assets')
        if not source.is_file():
            continue
        dest = current / source.relative_to(previous)
        if dest.exists():
            if source.read_bytes() != dest.read_bytes():
                raise ValueError('An existing asset name has different content')
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
            dest.chmod(0o644)


class SystemService:
    def __init__(self, config):
        self.config = config
        self.account = pwd.getpwnam(config['user'])
        if self.account.pw_uid == 0:
            raise ValueError('Game service must not run as root')

    def healthy(self, port, release_id=None, timeout=20):
        deadline = time.monotonic() + timeout
        local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while time.monotonic() < deadline:
            try:
                base = f'http://127.0.0.1:{port}'
                with local_http.open(base + '/_health', timeout=2) as response:
                    if json.load(response).get('status') != 'ok':
                        raise ValueError('Unhealthy server')
                if release_id:
                    with local_http.open(base + '/_version', timeout=2) as response:
                        if json.load(response).get('releaseId') != release_id:
                            raise ValueError('Wrong running release')
                with local_http.open(base + '/', timeout=2) as response:
                    if b'id="app"' not in response.read():
                        raise ValueError('Missing game entry page')
                return True
            except (OSError, ValueError):
                time.sleep(.25)
        return False

    def preflight(self, release, release_id):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen(
            [self.config['node'], str(release / 'server.mjs')], cwd=release,
            env={'PATH': '/usr/bin:/bin', 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(port)},
            user=self.account.pw_uid, group=self.account.pw_gid, extra_groups=[],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            if not self.healthy(port, release_id):
                raise RuntimeError('New release failed isolated startup; current release unchanged')
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

    def restart(self):
        subprocess.run(['systemctl', 'restart', self.config['service']], check=True, timeout=45)

    def check(self, release_id=None):
        return self.healthy(self.config['port'], release_id)


def deploy(base, data, digest, release_id, service):
    if not ID.fullmatch(release_id) or not HASH.fullmatch(digest):
        raise ValueError('Invalid release ID or SHA-256')
    if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Archive checksum mismatch or oversized upload')
    current = base / 'current'
    if not current.is_symlink() or not current.resolve().is_dir():
        raise ValueError('Configure current symlink and service before enabling deployment')
    old = current.resolve()
    releases = base / 'releases'
    releases.mkdir(exist_ok=True, mode=0o755)
    target = releases / release_id
    if target.exists():
        if current.resolve() == target.resolve() and service.check(release_id):
            return  # Retry of a completed deployment.
        raise ValueError('Release ID already exists; rerun GitHub workflow for a new attempt ID')
    stage = Path(tempfile.mkdtemp(prefix='.staging-', dir=releases))
    stage.chmod(0o755)
    try:
        unpack(data, stage)
        version = json.loads((stage / 'VERSION.json').read_text())
        if version.get('releaseId') != release_id:
            raise ValueError('Release metadata does not match requested ID')
        keep_assets(old, stage)
        service.preflight(stage, release_id)
        stage.rename(target)
        link_to(current, target)
        try:
            service.restart()
            if not service.check(release_id):
                raise RuntimeError('New release failed active health/version check')
        except Exception as error:
            link_to(current, old)
            try:
                service.restart()
                if not service.check():
                    raise RuntimeError('Old release is not healthy')
            except Exception as rollback:
                raise RuntimeError(f'DEPLOY AND ROLLBACK FAILED; current points to {old}; inspect service: {rollback}') from error
            raise RuntimeError('Deployment failed; previous version restored') from error
        link_to(base / 'previous', old)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run using the configured sudo deployment helper')
    if len(sys.argv) != 3 or not ID.fullmatch(sys.argv[1]) or not HASH.fullmatch(sys.argv[2]):
        raise SystemExit('Usage: mygame-deploy RELEASE_ID ARCHIVE_SHA256')
    config_path = Path('/etc/mygame-deploy.json')
    metadata = config_path.lstat()
    if config_path.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise SystemExit('Deployment configuration must be root-owned and not group/world writable')
    config = json.loads(config_path.read_text())
    base = Path(config['base'])
    if not base.is_absolute() or base.resolve() != base or base == Path('/'):
        raise SystemExit('Invalid deployment base')
    if base.stat().st_uid != 0 or base.stat().st_mode & 0o022:
        raise SystemExit('Deployment base must be root-owned and not group/world writable')
    if not re.fullmatch(r'[A-Za-z0-9_-]+(?:\.service)?', config['service']):
        raise SystemExit('Invalid service name')
    if not isinstance(config['port'], int) or not 1 <= config['port'] <= 65535 or not Path(config['node']).is_absolute():
        raise SystemExit('Invalid port or Node path')
    with (base / '.deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        incoming = base / 'incoming'
        if incoming.is_symlink() or incoming.resolve() != incoming:
            raise SystemExit('Incoming directory must not be a symlink')
        path = incoming / (sys.argv[1] + '.tar.gz')
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as archive:
            if not stat.S_ISREG(os.fstat(archive.fileno()).st_mode):
                raise SystemExit('Upload must be a regular file')
            data = archive.read(32 * 1024 * 1024 + 1)
        deploy(base, data, sys.argv[2], sys.argv[1], SystemService(config))
    print('Deployment healthy:', sys.argv[1])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
