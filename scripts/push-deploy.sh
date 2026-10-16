#!/usr/bin/env bash
set -euo pipefail
# Values come from the GitHub production environment. Never echo credentials.
: "${MYGAME_SSH_HOST:?Set MYGAME_SSH_HOST}"
: "${MYGAME_SSH_USER:?Set MYGAME_SSH_USER}"
: "${MYGAME_SSH_KEY:?Set MYGAME_SSH_KEY}"
: "${MYGAME_KNOWN_HOSTS:?Set MYGAME_KNOWN_HOSTS}"
: "${MYGAME_RELEASE_ID:?Missing release ID}"
DEPLOY_PORT=${MYGAME_SSH_PORT:-22}
DEPLOY_BASE=${MYGAME_DEPLOY_ROOT:-/opt/mygame}
[[ "$MYGAME_SSH_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo 'Use an IPv4 address or DNS hostname'; exit 1; }
[[ "$MYGAME_SSH_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || exit 1
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] && (( 10#$DEPLOY_PORT > 0 && 10#$DEPLOY_PORT < 65536 )) || exit 1
[[ "$DEPLOY_BASE" =~ ^/[A-Za-z0-9_/-]+$ && "$DEPLOY_BASE" != / ]] || exit 1
[[ "$MYGAME_RELEASE_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$ ]] || exit 1
shopt -s nullglob
archives=(releases/*.tar.gz)
[[ ${#archives[@]} == 1 ]] || { echo 'Expected one build archive'; exit 1; }
archive=${archives[0]}
digest=$(sha256sum "$archive" | cut -d ' ' -f 1)
key_dir=$(mktemp -d)
trap 'rm -rf "$key_dir"' EXIT
printf '%s\n' "$MYGAME_SSH_KEY" > "$key_dir/key"
printf '%s\n' "$MYGAME_KNOWN_HOSTS" > "$key_dir/known_hosts"
chmod 600 "$key_dir/key" "$key_dir/known_hosts"
opts=(-i "$key_dir/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$key_dir/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
scp "${opts[@]}" -P "$DEPLOY_PORT" "$archive" "$MYGAME_SSH_USER@$MYGAME_SSH_HOST:$DEPLOY_BASE/incoming/$MYGAME_RELEASE_ID.tar.gz"
ssh "${opts[@]}" -p "$DEPLOY_PORT" "$MYGAME_SSH_USER@$MYGAME_SSH_HOST" "sudo -n /usr/local/sbin/mygame-deploy '$MYGAME_RELEASE_ID' '$digest'"
