#!/bin/bash
set -euo pipefail
export PATH="/home/kiran/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin"
cd /home/kiran/code-wsl/mobily/android
npx expo-modules-autolinking resolve --platform android
