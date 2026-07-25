#!/usr/bin/env bash
ps -ef | grep -E 'playwright|run-focus|chromium' | grep -v grep | head -30
echo ---
ls /home/kiran/code-wsl/mobily/android/node_modules/.bin/playwright 2>&1 | head
echo ---
# See if npx playwright is waiting for something
pgrep -af playwright | head -20
