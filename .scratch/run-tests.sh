source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
# try other common setups
[ -f "$HOME/.fnm/env" ] && . "$HOME/.fnm/env"
[ -f "$HOME/.asdf/asdf.sh" ] && . "$HOME/.asdf/asdf.sh"
export PATH="$HOME/.local/share/pnpm:/usr/local/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
echo "NODE=$(command -v node)"
echo "PNPM=$(command -v pnpm)"
node -v 2>&1
pnpm -v 2>&1
pnpm exec vitest run tests/readableTerminalGrid.test.ts tests/fontPreference.test.ts tests/terminalDocument.test.ts tests/terminalBridge.test.ts tests/terminalSizeOwnership.test.ts
echo "VITEST_EXIT=$?"
