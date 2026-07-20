export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$HOME/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily/android
pnpm exec playwright test tests/browser/terminalSnapshot.pw.mjs
echo "PLAYWRIGHT_EXIT=$?"