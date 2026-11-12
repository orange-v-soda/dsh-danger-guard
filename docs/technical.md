# 技术说明

## 挂载位置

插件向 `tools/pre-execute` 注册一个监听器，`prepend: true`，排在所有同类监听器之前。

这条瀑布在工具 body 执行前调用，每次调用拿到三个参数：

- `exec` —— 待执行调用，含 `name`（工具名）、`arguments`（调用参数）、`agent`、`signal`
- `next()` —— 交棒给下一个监听器；没人接管时由流水线提供的终结回调返回 `{ kind: 'allow' }`

返回值是 `allow` / `deny` / `ask` / `cancel` 之一。`deny` 的 `reason` 会被拼成 `Error: <reason>` 作为工具结果回给模型，工具不会执行。

## 判定流程

```
apply(ctx)
  └─ tools/pre-execute
       ├─ exec.name 匹配命令类工具 → inspectShell()
       │    ├─ 整条命令查 fork bomb（会被 `;` 切段，只能整条匹配）
       │    └─ 按 && || ; 换行切段 → 逐段 stripElevation() → checkSegment()
       ├─ exec.name 匹配写文件类工具 → inspectWrite()
       └─ 命中返回 { kind: 'deny', reason }
           未命中 return next()
```

`inspect()` 外层包了 try/catch：守卫自身出错时直接放行，避免把工具全禁掉，让沙箱和审批策略继续兜底。

## 规则表

命令类：

| 判断 | 实现位置 |
| --- | --- |
| fork bomb | `inspectShell`，整条命令正则 |
| `rm` + 递归 + 强制 | `checkSegment`，分别用 `RECURSIVE_FLAG` 和 `FORCE_FLAG` 匹配，不看参数顺序 |
| PowerShell `-Recurse` / CMD `/s` | `checkSegment`，两条路径合并在 `looksRecursive` / `looksForce` |
| 磁盘、关机、权限位 | `checkSegment`，按首个命令词匹配 |
| 目标是否受保护 | `isProtectedPath`，先查 `FATAL_TARGETS` 字面量，再查 `SYSTEM_PATH` / `WINDOWS_PATH` 前缀 |

写入类：取 `arguments.file_path`（兼容 `filePath`、`path`、`target`），交给同一个 `isProtectedPath`。

关键设计：**看「操作 + 目标」而不是关键词**。`rm -rf` 本身不拒绝，只有目标落在根目录或系统目录才拒绝，所以 `rm -rf ./dist` 正常放行。

## 扩展

新增一条命令规则：在 `checkSegment` 里加一个分支并返回理由字符串，其余由 `inspect()` 统一包装。新增受保护路径：加进 `FATAL_TARGETS`，或补一条 `SYSTEM_PATH` 式的正则。

理由文本会原样进模型上下文，写清楚「拦了什么、为什么、要不要换个方式」比写一句 "blocked" 有用。

## 与其他层的关系

执行前的完整链路是：`tools/pre-execute` 瀑布 → 结果为 `ask` 时走审批 seam → 结果为 `allow` 时再跑工具自带的 `checkGuards` → 才真正执行。

所以本插件只负责第一段。它和 DSH 的沙箱模式、审批策略互不替代：沙箱管「物理上能不能」，这里管「看起来要不要」。Auto review 也挂在这条瀑布上，同样 `prepend`，两者互不知晓，谁先注册谁先跑。

## 已知绕过

变量拼接、`eval`、`xargs`、把命令写进脚本再执行、`find -delete`、`git clean -fdx`，以及 `run_code` 里直接调 Node 的 `fs.rm`——后者根本不经过工具流水线。这层只降低手滑概率，不构成安全边界。
