export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$HOME/.local/share/pnpm:$PATH"
cd /home/kiran/code-wsl/mobily/android
echo "NODE=$(command -v node)"
echo "PNPM=$(command -v pnpm)"
node -v
pnpm -v
echo ENV_OK