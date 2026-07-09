#!/bin/bash
# WSL git credential helper that delegates to Windows gh.exe
exec "/mnt/c/Program Files/GitHub CLI/gh.exe" auth git-credential "$@"
