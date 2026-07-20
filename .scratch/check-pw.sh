ps aux | grep -E 'playwright|chromium|node' | grep -v grep | head -40
ls -la /home/kiran/code-wsl/mobily/android/test-results 2>/dev/null | head -20
ls -la /tmp/playwright* 2>/dev/null | head -10
pgrep -af playwright | head -20
pgrep -af 'vitest|chromium|chrome' | head -20