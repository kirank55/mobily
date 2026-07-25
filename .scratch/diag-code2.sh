#!/usr/bin/env bash
set -u
cd /home/kiran/code-wsl/mobily
# Show key sections of workstation attach
echo "===== workstationPresence.ts (attach path) ====="
sed -n '85,180p' cli/src/workstationPresence.ts
echo "===== tmuxWorkstationAttach.ts (top + spawn) ====="
sed -n '1,180p' cli/src/tmuxWorkstationAttach.ts
echo "===== Does mux create a nested session when name equals outer? ====="
grep -n "sessionName\|new-session\|has-session\|createSession" cli/src/mux/tmux.ts | head -40
grep -n "session\|tmux" cli/src/index.ts | head -40
# Check if there's a shell pane that was supposed to exist - maybe window has multiple panes we missed
echo "===== windows/panes detail ====="
tmux list-windows -a -F '#{session_name}:#{window_index} #{window_panes} #{window_layout}'
tmux list-panes -t mobily-devtunnels-test -a -F 'idx=#{pane_index} pid=#{pane_pid} tty=#{pane_tty} cmd=#{pane_current_command} dead=#{pane_dead}'
# Check pts from ptmx - which slave?
echo "===== ptmx peer ====="
ls -l /proc/415689/fd/24
# find shell related to mobily pty
ps aux | grep -E 'pts/|node-pty|bash' | grep -v grep | head -30
# Check if Android WS is connected via sockets
ss -tpn 2>/dev/null | grep -E '37411|415689' | head -20 || netstat -tpn 2>/dev/null | grep 37411 | head