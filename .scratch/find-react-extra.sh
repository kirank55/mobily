export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily
node -p "require('./node_modules/next/dist/compiled/react/package.json').version + ' node_modules/next/dist/compiled/react/package.json'"
node -p "require('./node_modules/next/dist/compiled/react-dom/package.json').version + ' node_modules/next/dist/compiled/react-dom/package.json'"
echo "=== pnpm react-dom@ ==="
ls node_modules/.pnpm | grep react-dom || true
echo "=== android react symlink target ==="
readlink android/node_modules/react
readlink -f android/node_modules/react
echo "=== lock packages react/react-dom ==="
grep -n '^  react@' pnpm-lock.yaml | head -10
grep -n '^  react-dom@' pnpm-lock.yaml | head -10
