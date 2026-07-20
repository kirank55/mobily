export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$HOME/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily/android
pnpm exec vitest run tests/readableTerminalGrid.test.ts tests/fontPreference.test.ts tests/terminalDocument.test.ts tests/terminalBridge.test.ts tests/terminalSizeOwnership.test.ts
echo "VITEST_EXIT=$?"