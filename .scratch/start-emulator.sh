#!/usr/bin/env bash
export PATH=/home/kiran/Android/Sdk/emulator:/home/kiran/Android/Sdk/platform-tools:/usr/bin:/bin
exec emulator -avd Mobily_API_36 -no-snapshot -no-boot-anim -netdelay none -netspeed full -camera-back imagefile:/tmp/mobily-camera.png
