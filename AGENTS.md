# AGENTS.md

## 这是什么

DSH 插件，在 `tools/pre-execute` 瀑布上挂一个监听器，命中危险规则时返回 `deny`。

## 结构

- `lib/index.js` —— 全部逻辑。导出 `name`、`inject`、`apply`。
- `cordis.patch.yml` —— 把自己插进 profile 的 loader 行。
- `package.json` —— `dsh.bundle.patch` 指向上面那个文件，这是被识别为 bundle 的关键。

## 改规则

- 命令规则在 `checkSegment()`，路径判定在 `isProtectedPath()`。
- 新增规则返回一个字符串理由即可，`inspect()` 会统一包装成 `deny`。
- 未命中必须 `return next()`，否则会截断整条 pre-execute 链。
- 不匹配的调用要原样交棒，不要改成返回 `allow`。

## 验证

改完把包 link 进 profile 后，用指向不存在路径的探针测试，例如
`Remove-Item -Recurse -Force 'C:\Windows\__probe__'` —— 没拦住也不会有副作用。

## 不要做的事

- 不要引入依赖，保持单文件零 import。
- 不要在监听器里抛异常，异常会 pass 到流水线；`inspect()` 外层已包 try/catch。
- 不要把这里当沙箱，也不要承诺覆盖面。
