echo "HOME=$HOME"
ls -la "$HOME/.nvm" 2>&1 | head -20
ls -la "$HOME/.nvm/versions/node" 2>&1 | head -20
ls /usr/bin/node /usr/local/bin/node 2>&1
command -v volta; command -v mise; command -v asdf; command -v fnm
ls "$HOME/.local/share/fnm" 2>&1 | head -10
ls "$HOME/.volta/bin" 2>&1 | head -10
# find node binaries
find /home/kiran -name 'node' -type f 2>/dev/null | head -20
find /usr -name 'node' -type f 2>/dev/null | head -10
# check profile files
grep -n "nvm\|fnm\|node\|pnpm" "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile" 2>/dev/null | head -40
