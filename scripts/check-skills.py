#!/usr/bin/env python3
"""Offline validation of project skills, provenance and local entry points.

Uses Python's standard library; never installs packages or executes skill examples.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / '.agents' / 'skills'
errors = []


def require(condition, message):
    if not condition:
        errors.append(message)


def safe_file(base, relative):
    path = base / relative
    require(not path.is_symlink(), f'Symlink is not allowed: {path}')
    if not path.resolve().is_relative_to(base.resolve()):
        errors.append(f'Path escapes expected directory: {relative}')
        return None
    require(path.is_file(), f'Missing file: {path}')
    return path if path.is_file() else None


def check_hash(base, relative, expected):
    path = safe_file(base, relative)
    if path:
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        require(actual == expected, f'Hash mismatch: {path.relative_to(ROOT)}')


def scalar(text, key):
    match = re.search(r'^' + re.escape(key) + r':\s*(.+)$', text, re.M)
    if not match:
        return ''
    value = match.group(1).strip()
    if value.startswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return ''
    return value.strip("'")


def main():
    lock = json.loads((SKILLS / 'sources.lock.json').read_text())
    require(lock.get('version') == 1, 'Unsupported manifest version')
    names = [entry['name'] for entry in lock['sources']] + lock['original_skills']
    require(len(names) == len(set(names)), 'Duplicate skill names')
    found = {p.parent.name for p in SKILLS.glob('*/SKILL.md')}
    require(found == set(names), f'Skill catalog mismatch: {sorted(found)}')
    expected_paths = {'sources.lock.json'}
    for entry in lock['sources']:
        name = entry['name']
        require(bool(re.fullmatch(r'[0-9a-f]{40}', entry['commit'])), f'Unpinned source: {name}')
        require(entry['repository'].startswith('https://github.com/'), f'Invalid source URL: {name}')
        require(bool(entry.get('license')), f'Missing license declaration: {name}')
        require('LICENSE.txt' in entry['files'], f'License not tracked: {name}')
        require(bool(entry.get('adaptations')), f'Missing adaptation notes: {name}')
        for relative, record in entry['files'].items():
            check_hash(SKILLS / name, relative, record['installed_sha256'])
            expected_paths.add(name + '/' + relative)
            if 'upstream_sha256' in record:
                require(bool(re.fullmatch(r'[0-9a-f]{64}', record['upstream_sha256'])), f'Invalid upstream hash: {name}/{relative}')
    for relative, expected in lock['project_files'].items():
        check_hash(SKILLS, relative, expected)
        expected_paths.add(relative)
    actual_paths = {str(p.relative_to(SKILLS)) for p in SKILLS.rglob('*') if p.is_file()}
    require(actual_paths == expected_paths, f'Untracked/missing skill files: {sorted(actual_paths ^ expected_paths)}')

    agents_text = (ROOT / 'AGENTS.md').read_text()
    index_text = (ROOT / 'docs/SKILLS.md').read_text()
    for name in names:
        path = SKILLS / name / 'SKILL.md'
        if not path.exists():
            continue
        text = path.read_text()
        parts = text.split('---', 2)
        require(len(parts) == 3 and not parts[0].strip(), f'Invalid frontmatter: {name}')
        if len(parts) != 3:
            continue
        require(scalar(parts[1], 'name') == name, f'Name does not match directory: {name}')
        description = scalar(parts[1], 'description')
        require(0 < len(description) <= 1024, f'Invalid description: {name}')
        require('../PROJECT.md' in text, f'Missing project contract entry: {name}')
        require(f'.agents/skills/{name}/SKILL.md' in agents_text, f'Missing AGENTS route: {name}')
        require(f'.agents/skills/{name}/SKILL.md' in index_text, f'Missing catalog link: {name}')
        agent = safe_file(SKILLS / name, 'agents/openai.yaml')
        if agent:
            yaml_text = agent.read_text()
            require('$' + name in yaml_text, f'Missing named skill in default prompt: {name}')
            for target in re.findall(r'^\s+icon_(?:small|large):\s*[\'"]([^\'"]+)', yaml_text, re.M):
                safe_file(SKILLS / name, target)

    # Validate file targets, not heading anchors or example paths inside code fences.
    documents = list(SKILLS.rglob('*.md')) + [ROOT / 'docs/SKILLS.md', ROOT / 'docs/decisions/D023-game-development-skills.md']
    for path in documents:
        text = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if target.startswith('#') or urlsplit(target).scheme:
                continue
            relative = unquote(target.split('#', 1)[0])
            linked = (path.parent / relative).resolve()
            require(linked.is_relative_to(ROOT), f'Link escapes repo: {path}: {target}')
            require(linked.exists(), f'Broken local link: {path.relative_to(ROOT)} -> {target}')

    wrapper = SKILLS / 'playwright/scripts/playwright_cli.sh'
    pinned = lock['runtime']['playwright_cli']
    require('@playwright/cli@' + pinned in wrapper.read_text(), 'CLI pin differs from manifest')
    result = subprocess.run(['bash', '-n', str(wrapper)], capture_output=True, text=True)
    require(result.returncode == 0, 'Wrapper syntax error: ' + result.stderr)
    if errors:
        print('\n'.join('ERROR: ' + e for e in errors), file=sys.stderr)
        return 1
    print(f'PASS: {len(names)} skills; {len(expected_paths)} files; source hashes, licenses, links, agent metadata and wrapper syntax.')
    print('Scope: installation structure; browser execution and client discovery are separate checks.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
