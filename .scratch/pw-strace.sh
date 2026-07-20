# kill the hung list
kill 83853 83848 2>/dev/null || true
sleep 1
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily/android
ls -la playwright*.ts playwright*.js playwright*.mjs 2>/dev/null
ls -la tests/browser/terminalSnapshot.pw.mjs
# strace briefly why list hangs
timeout 8 strace -f -e openat,connect,read,stat node /home/kiran/code-wsl/mobily/node_modules/@playwright/test/cli.js test tests/browser/terminalSnapshot.pw.mjs --list 2>/home/kiran/code-wsl/mobily/.scratch/pw-strace.txt
echo STRACE_DONE
tail -80 /home/kiran/code-wsl/mobily/.scratch/pw-strace.txt