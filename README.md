# <img src="icon.png" width="32" align="middle" alt="" /> dsh-danger-guard

一款简单有效的危险指令禁止插件


## 安装

可通过npm和github两种方式进行安装：

```
@orange-v-soda/dsh-danger-guard          # npm
github:orange-v-soda/dsh-danger-guard    # GitHub
```

## 什么时候需要？
如果您：
- 想开启 Auto review，但对模型临场判断的稳定性有顾虑。
- 想给 agent 划一条简单的权限边界。
- 沙箱的配置出现问题，而无法硬性限制agent行为。
那么本插件或许能有所帮助

## 工作原理

- 通过 DSH 自带的工具审核接口（`tools/pre-execute`），在工具真正执行前做一次确定性的硬性检查：命中固定规则就直接拒绝，不经过模型判断。
- 支持自定义添加、修改相应的检查规则。（推荐交给agent进行）

## 边界

- 这是一款非常轻量化的简单约束，核心目标是用于防止模型失误，在工作之的过程中，无意识地使用部分过于危险的指令。
- 但其检查规则是明确固定的，如果agent有意绕过，则难以进行全面的封堵。因此不太能防止本身带有恶意的agent操作。

## 技术说明

[docs/technical.md](docs/technical.md) —— 技术文档细致的说明了：当前的默认规则与底层运行逻辑。建议交给agent阅读。

## 声明

- **适配版本**：DSH `>= 0.2.1-rc.2`
- **开源协议**：MIT
- **纯本地**：只在进程内检查工具参数，不联网、不上传、不写文件
