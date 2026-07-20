pgrep -af 'playwright|run-playwright|pnpm|stdbuf' | head -30
ls -la /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt 2>&1
ls -la /home/kiran/code-wsl/mobily/.scratch/run-playwright2.sh
# try running node playwright directly with timeout to see startup
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
timeout 15 node ../node_modules/.bin/playwright test tests/browser/terminalSnapshot.pw.mjs --reporter=line 2>&1 | head -100
echo TIMEOUT_OR_EXIT=$?