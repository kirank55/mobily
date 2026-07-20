export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
ls -laR /home/kiran/code-wsl/mobily/android/test-results 2>&1 | head -50
ls -la /home/kiran/code-wsl/mobily/node_modules/playwright-core/.local-browsers 2>&1 | head -20
ls -la "$HOME/.cache/ms-playwright" 2>&1 | head -30
# check open files / children of playwright
pstree -p 76134 2>/dev/null || ps --forest -g $(ps -o sid= -p 76134) 2>/dev/null | head -40
ls -la /proc/76134/fd 2>/dev/null | head -30
tr '\0' ' ' < /proc/76134/cmdline; echo