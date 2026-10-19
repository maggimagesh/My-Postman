#!/bin/sh
# Install the .deb in a clean Ubuntu container and run the end-to-end tests as an unprivileged user.
# Needs: npm install and ./build-deb.sh first (the tests use the dev dependencies in node_modules).
# Usage: test/docker_test.sh 18.04
set -u
V="$1"
# seccomp=unconfined: Docker's default profile blocks the namespaces the Chromium sandbox needs
cd "$(dirname "$0")/.."
DEB="${DEB:-$(ls -t my-postmaster_*_amd64.deb | head -1)}"
docker run --rm --security-opt seccomp=unconfined -e DEBIAN_FRONTEND=noninteractive -e DEB="$DEB" -v "$PWD":/w:ro ubuntu:"$V" sh -c '
set -e
apt-get update -qq >/dev/null
# the package itself, exactly as a user would install it
apt-get install -y -qq /w/$DEB >/tmp/install.log 2>&1 || { tail -30 /tmp/install.log; exit 1; }
echo "== installed: $(dpkg-query -W -f="\${Package} \${Version} \${Status}" my-postmaster) on $(. /etc/os-release; echo $PRETTY_NAME)"
# test-only tools
apt-get install -y -qq xvfb xauth desktop-file-utils >/dev/null 2>&1
desktop-file-validate /usr/share/applications/my-postmaster.desktop && echo "== desktop file valid"
[ "$(stat -c %a /opt/my-postmaster/chrome-sandbox)" = 4755 ] || { echo "== chrome-sandbox is not setuid"; exit 1; }
set +e
useradd -m tester
rc=0
# the launcher starts the app and it keeps running (a crash on start exits early)
runuser -u tester -- env -i PATH=/usr/bin:/bin HOME=/home/tester LANG=C.UTF-8 \
  xvfb-run -a -s "-screen 0 1920x1080x24" timeout 20 my-postmaster >/tmp/launch.log 2>&1
if [ $? -eq 124 ]; then echo "== app started from the launcher"; else echo "== app failed to start"; tail -30 /tmp/launch.log; rc=1; fi
# end-to-end tests: the installed Electron runtime and app code, driven by test/smoke-test.js
cp -a /opt/my-postmaster /tmp/mp && rm -rf /tmp/mp/resources/app && mkdir /tmp/mp/resources/app
echo "{\"name\":\"my-postmaster-test\",\"main\":\"index.js\"}" > /tmp/mp/resources/app/package.json
echo "require(\"/w/test/smoke-test.js\");" > /tmp/mp/resources/app/index.js
chmod -R a+rX /tmp/mp && chown root /tmp/mp/chrome-sandbox && chmod 4755 /tmp/mp/chrome-sandbox
runuser -u tester -- env -i PATH=/usr/bin:/bin HOME=/home/tester LANG=C.UTF-8 \
  MP_MAIN=/opt/my-postmaster/resources/app/src/main/main.js \
  xvfb-run -a -s "-screen 0 1920x1080x24" timeout 300 /tmp/mp/my-postmaster >/tmp/test.log 2>&1 || rc=1
grep -qE "^[0-9]+/[0-9]+ checks passed" /tmp/test.log || tail -40 /tmp/test.log
grep -E "^(PASS|FAIL|[0-9]+/[0-9]+ checks passed)" /tmp/test.log
dpkg -r my-postmaster >/dev/null && [ ! -e /opt/my-postmaster ] && [ ! -e /usr/bin/my-postmaster ] && echo "== removed cleanly" || rc=1
exit $rc
'
