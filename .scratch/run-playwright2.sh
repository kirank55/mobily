export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$HOME/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily/android
export CI=1
export DEBUG=pw:api
# force line buffering
stdbuf -oL -eL pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs --reporter=line 2>&1 | tee /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt
echo "PLAYWRIGHT_EXIT=${PIPESTATUS[0]}" | tee -a /home/kiran/code-wsl/mobily/.scratch/playwright-out.txt