export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
# kill any leftover
pkill -f 'playwright test tests/browser/terminalSnapshot' 2>/dev/null || true
pkill -f 'run-playwright' 2>/dev/null || true
sleep 2
cd /home/kiran/code-wsl/mobily/android
export CI=1
echo "START $(date -Is)" > /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt
# use local playwright binary, not windows pnpm
timeout 90 node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --reporter=list >> /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt 2>&1
EC=$?
echo "PLAYWRIGHT_EXIT=$EC" >> /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt
echo "END $(date -Is)" >> /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt
cat /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt