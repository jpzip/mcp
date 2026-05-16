# mcp-server-jpzip

> 日本の郵便番号を Claude / 任意の MCP クライアントから引ける Model Context Protocol サーバー。`jpzip.nadai.dev`(Cloudflare Pages 配信の静的データ)を背後にもつ、stateless な stdio サーバー。

- 配信元: <https://jpzip.nadai.dev>
- データ仕様: [`jpzip/spec`](https://github.com/jpzip/spec)
- 元データ: 日本郵便 KEN_ALL / KEN_ALL_ROME(月次更新追従)

## インストール (Claude Code)

```sh
claude mcp add jpzip -- npx -y @jpzip/mcp-server-jpzip
```

Claude Desktop など `mcp.json` を直接編集する場合:

```json
{
  "mcpServers": {
    "jpzip": {
      "command": "npx",
      "args": ["-y", "@jpzip/mcp-server-jpzip"]
    }
  }
}
```

## 提供 Tool

| Tool | 用途 |
|---|---|
| `lookup_zipcode(zipcode)` | 郵便番号 → 住所(漢字/カナ/ローマ字 + JIS/総務省コード) |
| `search_by_address(query, limit?)` | 住所文字列 → 郵便番号候補(漢字/カナ/ローマ字横断、空白無視の部分一致) |
| `list_cities_in_prefecture(prefecture)` | 都道府県名 → 市区町村一覧(総務省コード付き) |
| `get_metadata()` | データバージョン・件数・生成時刻 |

## 動作モデル

- `lookup_zipcode` は対応する 3 桁 prefix(数十KB)のみを CDN から取得し、メモリにキャッシュする。
- `search_by_address` / `list_cities_in_prefecture` は初回呼び出し時に全件(約 25MB)を CDN から取得しメモリに保持する。同一 MCP プロセス内の以降の呼び出しは即時。
- 永続キャッシュは持たない(stateless)。Claude の再起動で in-memory データは破棄され、次回必要になった時に再取得する。

## 既知の制約

- 駅・路線・事業所情報は jpzip データセットに含まれない(郵便番号⇄住所のみ)。
- 検索クエリは 1 言語(漢字 / カナ / ローマ字)内での連続部分一致のみ対応。例えば「Yokohama Honcho」(ローマ字で中区を飛ばす)はマッチしない。

## ライセンス

MIT(コード) / 配信データは Public Domain 相当(日本郵便)。
