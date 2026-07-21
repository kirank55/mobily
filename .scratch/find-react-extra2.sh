export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd /home/kiran/code-wsl/mobily
for f in node_modules/next/dist/compiled/react/package.json node_modules/next/dist/compiled/react-dom/package.json; do
  echo "--- $f ---"
  head -5 "$f" 2>&1 || echo missing
done
grep -n '^  react-dom@' pnpm-lock.yaml | head -n 10
ls node_modules/.pnpm | grep -E '^react' | head -n 20
