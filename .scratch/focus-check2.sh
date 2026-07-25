#!/usr/bin/env bash
set -u
cd /home/kiran/code-wsl/mobily
echo "======== How term.html / terminalDocument loaded ========"
grep -Rn "terminalDocument\|term.html\|xtermAssets\|inject\|WebView\|source=" android/src android/app --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' 2>/dev/null | head -80
echo "======== package.json metro/expo ========"
grep -n -E 'playwright|expo|metro|android' android/package.json | head -40
echo "======== processes metro/expo ========"
pgrep -af 'metro|expo start|react-native' 2>/dev/null | head -20 || echo none
ss -tlnp 2>/dev/null | grep -E '8081|19000|19001|8082' || netstat -tlnp 2>/dev/null | grep -E '8081|19000' || true