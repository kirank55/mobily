export NVM_DIR=$HOME/.nvm
. "$NVM_DIR/nvm.sh"
cd /home/kiran/code-wsl/mobily/cli
grep -rn "noExternal\|external\|@mobily/shared" package.json tsup.config.ts tsup.config.mts tsup.config.js 2>/dev/null | head -40
ls tsup.config.* 2>/dev/null
node -e "const p=require(\"./package.json\"); console.log(\"deps\", p.dependencies); console.log(\"build\", p.scripts && p.scripts.build);"
