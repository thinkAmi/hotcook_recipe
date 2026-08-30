# CLAUDE.md

## npm 系のコマンドは `mise exec --` を挟んで実行する

```bash
mise exec -- npm test
```

このリポジトリは Node の版を [.node-version](.node-version) に固定しているが、
**素の `node` がそれと違う版を指すことがある。** mise の shims より先に、特定の版の
インストール先が PATH に載っている場合で、`mise doctor` が `activated: no` を返す環境が
これにあたる。

食い違ったまま `npm test` や `npm run build` を通すと、「手元では通ったのに CI で落ちる」を
作る。逆に、通らないはずのものが通ってしまうほうが厄介で、気づく手段が無い。

実行前に一度だけ確かめる。

```bash
node -v && mise exec -- node -v
```

両方が同じ版なら `mise exec` は省いてよい。違っていれば挟む。
