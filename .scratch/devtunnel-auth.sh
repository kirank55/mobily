#!/usr/bin/env bash
set -u
export PATH="/home/kiran/bin:${PATH}"
echo "=== devtunnel user show ==="
devtunnel user show 2>&1
echo "user-show EXIT:$?"