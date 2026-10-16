"""Deployment boundaries and failure recovery, without touching systemd."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('deployment', Path(__file__).resolve().parents[1] / 'deploy/automation/apply-release.py')
deployment = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deployment)


def package(release_id='new-release', extra=None, tamper=False):
    files = {
        'server.mjs': b'// server fixture',
        'dist/index.html': b'<div id="app"></div>',
        'dist/assets/new-12345678.js': b'new game',
        'VERSION.json': json.dumps({'releaseId': release_id}).encode(),
    }
    files.update(extra or {})
    files['SHA256SUMS'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in files.items()).encode()
    if tamper:
        files['server.mjs'] = b'changed after hashing'
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w:gz') as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo('MYGAME-server/' + name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return result.getvalue()


class FakeService:
    def __init__(self, base, *, preflight_error=False, active_failure=False, rollback_failure=False):
        self.base = base
        self.preflight_error = preflight_error
        self.active_failure = active_failure
        self.rollback_failure = rollback_failure
        self.restarted = []

    def preflight(self, release, release_id):
        if self.preflight_error:
            raise RuntimeError('preflight failed')
        assert (release / 'dist/index.html').is_file()

    def restart(self):
        self.restarted.append((self.base / 'current').resolve().name)

    def check(self, release_id=None):
        return not (self.active_failure if release_id else self.rollback_failure)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.old = self.base / 'releases/bootstrap'
        (self.old / 'dist/assets').mkdir(parents=True)
        (self.old / 'dist/assets/old-12345678.js').write_text('old game')
        (self.base / 'current').symlink_to(self.old)
        self.service = FakeService(self.base)

    def deploy(self, data=None, release_id='new-release', digest=None):
        data = package() if data is None else data
        deployment.deploy(self.base, data, digest or hashlib.sha256(data).hexdigest(), release_id, self.service)

    def test_success_retains_old_assets_and_previous_version(self):
        self.deploy()
        current = (self.base / 'current').resolve()
        self.assertEqual(current.name, 'new-release')
        self.assertEqual((self.base / 'previous').resolve(), self.old)
        self.assertEqual((current / 'dist/assets/old-12345678.js').read_text(), 'old game')
        self.assertEqual(self.service.restarted, ['new-release'])
        self.deploy()  # A successful job can be retried without restarting again.
        self.assertEqual(self.service.restarted, ['new-release'])

    def test_preflight_failure_keeps_current_untouched(self):
        self.service.preflight_error = True
        with self.assertRaisesRegex(RuntimeError, 'preflight'):
            self.deploy()
        self.assertEqual((self.base / 'current').resolve(), self.old)
        self.assertEqual(self.service.restarted, [])
        self.assertEqual(list((self.base / 'releases').glob('.staging-*')), [])

    def test_active_failure_rolls_back_and_restarts_old_version(self):
        self.service.active_failure = True
        with self.assertRaisesRegex(RuntimeError, 'previous version restored'):
            self.deploy()
        self.assertEqual((self.base / 'current').resolve(), self.old)
        self.assertEqual(self.service.restarted, ['new-release', 'bootstrap'])

    def test_restart_failure_also_rolls_back(self):
        def restart():
            self.service.restarted.append((self.base / 'current').resolve().name)
            if len(self.service.restarted) == 1:
                raise RuntimeError('systemd restart failed')
        self.service.restart = restart
        with self.assertRaisesRegex(RuntimeError, 'previous version restored'):
            self.deploy()
        self.assertEqual(self.service.restarted, ['new-release', 'bootstrap'])

    def test_rollback_failure_is_explicit(self):
        self.service.active_failure = self.service.rollback_failure = True
        with self.assertRaisesRegex(RuntimeError, 'DEPLOY AND ROLLBACK FAILED'):
            self.deploy()
        self.assertEqual((self.base / 'current').resolve(), self.old)

    def test_wrong_archive_hash_rejected_before_switch(self):
        with self.assertRaisesRegex(ValueError, 'Archive checksum'):
            self.deploy(digest='0' * 64)
        self.assertEqual((self.base / 'current').resolve(), self.old)

    def test_tampered_file_rejected_before_switch(self):
        with self.assertRaisesRegex(ValueError, 'file checksum'):
            self.deploy(package(tamper=True))
        self.assertEqual(self.service.restarted, [])

    def test_wrong_version_rejected(self):
        with self.assertRaisesRegex(ValueError, 'metadata'):
            self.deploy(package('other-release'))

    def test_conflicting_old_asset_rejected(self):
        with self.assertRaisesRegex(ValueError, 'different content'):
            self.deploy(package(extra={'dist/assets/old-12345678.js': b'different game'}))

    def test_archive_traversal_and_links_rejected(self):
        for path, kind in [('MYGAME-server/../../escape', tarfile.REGTYPE), ('/tmp/escape', tarfile.REGTYPE), ('MYGAME-server/link', tarfile.SYMTYPE), ('MYGAME-server/hardlink', tarfile.LNKTYPE)]:
            with self.subTest(path=path):
                result = io.BytesIO()
                with tarfile.open(fileobj=result, mode='w:gz') as archive:
                    entry = tarfile.TarInfo(path)
                    entry.type = kind
                    entry.linkname = '/tmp/escape'
                    archive.addfile(entry, io.BytesIO())
                with self.assertRaises(ValueError):
                    self.deploy(result.getvalue())
        self.assertEqual((self.base / 'current').resolve(), self.old)


if __name__ == '__main__':
    unittest.main()
