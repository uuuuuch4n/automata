# Automaton Editor

ブラウザで動く DFA / NFA / ε-NFA のエディタ兼シミュレータです。ビルド不要(素の ES Modules + SVG)。

## 機能
- 状態の追加・移動・削除、初期状態 / 受理状態の設定
- 遷移の追加(複数記号 `a,b`、ε は `eps` または `ε`、自己ループ、双方向の曲線表示)
- 入力文字列の実行とステップ実行(現在の状態集合をハイライト)
- JSON の保存 / 読込、SVG 書き出し、ブラウザへの自動保存

## 使い方
```bash
npm start        # ローカルサーバを起動(ES Modules のため file:// では動きません)
npm test         # ロジックのテスト(Node 18+)
```

操作: `v` 選択 / `s` 状態 / `t` 遷移 / `d` 削除 / `Delete` 選択物を削除 / `Esc` キャンセル

## 構成
- `src/automaton.js` — DOM 非依存のモデルとシミュレーション(テスト対象)
- `src/editor.js` — SVG 描画と UI
- `test/` — `node:test` によるテスト

## ライセンス
MIT
