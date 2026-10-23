#!/bin/sh
# Builds my-postmaster_<version>_amd64.deb from the Electron runtime in node_modules.
# Needs: npm install (once), dpkg-deb. Works offline.
set -e
cd "$(dirname "$0")"
VER=$(node -p "require('./package.json').version")
P=build/pkg
APP=$P/opt/my-postmaster/resources/app
rm -rf build
mkdir -p $P/DEBIAN $P/usr/bin $P/usr/share/applications
# Electron 45+ no longer downloads its runtime on npm install (it fetches it lazily on first run),
# so fetch it explicitly here. A no-op when node_modules/electron/dist is already present.
node node_modules/electron/install.js
mkdir -p $P/opt && cp -a node_modules/electron/dist $P/opt/my-postmaster
mv $P/opt/my-postmaster/electron $P/opt/my-postmaster/my-postmaster
rm -f $P/opt/my-postmaster/resources/default_app.asar

# app code + production dependencies only
mkdir -p $APP
cp -r package.json package-lock.json src icons icon.png $APP/
cp -r node_modules $APP/
(cd $APP && npm prune --omit=dev --no-audit --no-fund --offline >/dev/null 2>&1 || npm prune --omit=dev --no-audit --no-fund >/dev/null)
rm -rf $APP/node_modules/monaco-editor/esm $APP/node_modules/monaco-editor/dev $APP/node_modules/monaco-editor/min-maps
find $APP/node_modules -name '*.map' -delete
rm -f $APP/package-lock.json

# desktop integration
for s in 16 32 48 64 128 256 512; do
  mkdir -p $P/usr/share/icons/hicolor/${s}x$s/apps
  cp icons/$s.png $P/usr/share/icons/hicolor/${s}x$s/apps/my-postmaster.png
done
mkdir -p $P/usr/share/icons/hicolor/scalable/apps && cp icon.svg $P/usr/share/icons/hicolor/scalable/apps/my-postmaster.svg
ln -s /opt/my-postmaster/my-postmaster $P/usr/bin/my-postmaster
cat > $P/usr/share/applications/my-postmaster.desktop <<D
[Desktop Entry]
Name=My Postmaster
GenericName=API Client
Comment=Test HTTP, GraphQL, WebSocket, Socket.IO, SSE, MQTT and gRPC APIs, with Claude AI
Exec=/opt/my-postmaster/my-postmaster %U
Icon=my-postmaster
Type=Application
Categories=Development;WebDevelopment;
Keywords=api;rest;http;graphql;websocket;grpc;mqtt;postman;
StartupWMClass=My Postmaster
D

SIZE=$(du -sk $P/opt $P/usr | awk '{s+=$1} END {print s}')
cat > $P/DEBIAN/control <<D
Package: my-postmaster
Version: $VER
Architecture: amd64
Maintainer: Magesh <maggimagesh995@gmail.com>
Installed-Size: $SIZE
Depends: libgtk-3-0, libnss3, libxss1, libasound2t64 | libasound2, libgbm1
Section: devel
Priority: optional
Description: My Postmaster - API client with Claude AI
 Desktop API client: HTTP/REST, GraphQL, WebSocket, Socket.IO, SSE, MQTT and gRPC.
 Collections, environments, Postman-compatible scripts and tests, collection runner
 with data files, performance testing, mock servers, cookies, proxy and client
 certificates, OAuth 1/2, AWS SigV4, JWT, Digest and Hawk auth, Postman / OpenAPI /
 HAR / Insomnia import, code generation. AI uses your Claude Code login.
D
printf '#!/bin/sh\nchmod 4755 /opt/my-postmaster/chrome-sandbox || true\ngtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true\nupdate-desktop-database -q 2>/dev/null || true\n' > $P/DEBIAN/postinst
chmod 755 $P/DEBIAN/postinst
dpkg-deb --root-owner-group -Zxz --build $P my-postmaster_${VER}_amd64.deb
