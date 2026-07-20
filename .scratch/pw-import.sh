export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
pkill -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
# inspect transform cache for locks
find /tmp/playwright-transform-cache-1000 -type f 2>/dev/null | head -40
ls -la /tmp/playwright-transform-cache-1000/ 2>/dev/null
# try clearing cache
rm -rf /tmp/playwright-transform-cache-1000
# try importing test dependencies directly
cd /home/kiran/code-wsl/mobily/android
timeout 30 node -e '
console.log("1");
import("@mobily/shared").then(m=>{console.log("shared ok", Object.keys(m).slice(0,5)); return import("./src/terminal/terminalDocument.js");}).then(m=>{console.log("doc ok", typeof m.buildTerminalDocument); console.log("done");}).catch(e=>{console.error(e); process.exit(1);});
' 2>&1
echo IMPORT_EXIT=$?
# try running the test file as plain node (will fail on test APIs but shows load)
timeout 30 node --input-type=module -e '
console.log("loading test file...");
await import("./tests/browser/terminalSnapshot.pw.mjs");
console.log("loaded");
' 2>&1 | head -50
echo LOAD_TEST_EXIT=$?