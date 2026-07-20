export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
# kill leftovers
pkill -f '@playwright/test/cli.js' 2>/dev/null || true
sleep 1
# check for locks
find /tmp -name '*playwright*' 2>/dev/null | head -20
ls -la /tmp/.playwright* 2>/dev/null
# try with PWDEBUG off and node --trace-hanging / diagnostic
# use a short node script to import config
timeout 20 node --import tsx -e 'console.log("start"); const c=await import("./playwright.config.ts"); console.log(JSON.stringify(c.default,null,2)); console.log("done");' 2>&1 | tee /home/kiran/code-wsl/mobily/.scratch/pw-config-load.txt
echo CONFIG_LOAD_EXIT=$?
# try playwright with DEBUG
timeout 25 env DEBUG=pw:test* node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --list 2>&1 | tee /home/kiran/code-wsl/mobily/.scratch/pw-debug-list.txt
echo LIST_EXIT=$?