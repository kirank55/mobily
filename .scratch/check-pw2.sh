#!/usr/bin/env bash
pstree -p 541302 2>/dev/null || ps --forest -g $(ps -o sid= -p 541302) 2>/dev/null | head -40
echo ---
ls -la /home/kiran/code-wsl/mobily/node_modules/.bin/playwright
ls /home/kiran/.cache/ms-playwright 2>/dev/null | head
# any chromium?
pgrep -af chromium | head -10
# open files / wait?
ls -l /proc/541302/fd 2>/dev/null | head -20
tr '\0' ' ' < /proc/541302/cmdline; echo
