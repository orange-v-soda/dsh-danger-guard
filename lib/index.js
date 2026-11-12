/**
 * danger-guard
 *
 * 通过 tools/pre-execute 瀑布式监听器拦截明显危险的命令与文件写入。
 * 命中时返回 { kind: "deny", reason }，工具流水线会把 reason 作为
 * `Error: <reason>` 的工具结果回给模型，并且不会走审批流程。
 * 未命中时必须调用 next()，否则会截断后续所有检查。
 */

export const name = 'danger-guard'
export const inject = ['tools']

/** 命令类工具（原生与 PTC inner call 用的是同一批名字）*/
const SHELL_TOOL = /^(bash|pwsh|powershell|shell|zsh|sh|cmd|terminal)$/i

/** 写文件类工具 */
const WRITE_TOOL = /^(write|edit|create_file|apply_patch|patch|str_replace_editor)$/i

/** 删除即事故的路径字面量 */
const FATAL_TARGETS = new Set([
  '/', '/*', '~', '~/', '~/*', '${home}', '$home', '%userprofile%',
  'c:\\', 'c:/', 'c:\\*', 'c:/*', '*', '.', '..',
])

/** 系统目录及其子路径，删改都要拦 */
const SYSTEM_PATH = /^\/(etc|usr|bin|sbin|boot|lib|root)(\/|$)/
const WINDOWS_PATH = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/

function isProtectedPath(raw) {
  if (typeof raw !== 'string') return false
  const target = raw.trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (target === '') return false
  if (FATAL_TARGETS.has(target)) return true
  return SYSTEM_PATH.test(target) || WINDOWS_PATH.test(target)
}

/** 取命令字符串：不同工具的键名略有差异 */
function commandOf(exec) {
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return undefined
  const raw = args.command ?? args.cmd ?? args.script ?? args.code
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string').join(' ')
  return undefined
}

/** 按 shell 连接符切段，逐段检查 */
function segments(command) {
  return command
    .split(/&&|\|\||[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 剥离提权前缀，避免 sudo rm -rf 之类绕过首个命令词判断 */
function stripElevation(segment) {
  return segment.replace(/^(sudo|doas|pkexec|runas)\s+/i, '')
}

function tokensOf(segment) {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
}

/** 去掉引号并剥离首个命令词后的参数 */
function argumentTargets(segment) {
  return tokensOf(segment)
    .slice(1)
    .filter((t) => !t.startsWith('-'))
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
}

const RECURSIVE_FLAG = /(^|\s)-[a-z]*r[a-z]*(\s|$)|--recursive/i
const FORCE_FLAG = /(^|\s)-[a-z]*f[a-z]*(\s|$)|--force/i

/** 检查单个命令段，命中返回拒绝理由 */
function checkSegment(segment) {
  const lower = segment.toLowerCase()

  // rm -rf 类递归强制删除
  if (/^rm\b/.test(lower) && RECURSIVE_FLAG.test(segment) && FORCE_FLAG.test(segment)) {
    if (argumentTargets(segment).some(isProtectedPath)) {
      return '递归强制删除指向受保护的根目录或系统目录'
    }
  }

  // PowerShell 的 -Recurse / -Force 与 CMD 的 /s /q
  const looksRecursive = RECURSIVE_FLAG.test(segment) || /\s\/[sq]\b/i.test(segment)
  const looksForce = FORCE_FLAG.test(segment) || /\s\/[qf]\b/i.test(segment)
  if (/^(remove-item|ri|del|erase|rd|rmdir)\b/.test(lower) && looksRecursive && looksForce) {
    if (argumentTargets(segment).some(isProtectedPath)) {
      return '递归强制删除指向受保护的根目录或系统目录'
    }
  }

  // 磁盘与分区
  if (/^(mkfs(\.\w+)?|mke2fs|wipefs)\b/.test(lower)) return '检测到格式化文件系统或擦除磁盘签名的操作'
  if (/^diskpart\b/.test(lower)) return '检测到 diskpart 磁盘分区操作'
  if (/^format\b/.test(lower)) return '检测到磁盘格式化操作'
  if (/^dd\b/.test(lower) && /of=\/dev\//.test(lower)) return '检测到向块设备直接写入的操作'

  // 关机 / 重启
  if (/^(shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\b/.test(lower)) {
    return '检测到关机或重启主机的操作'
  }

  // 权限位被整体放开
  if (/^chmod\s+-r\s+777\s+\/(\s|$)/.test(lower) || /^chown\s+-r\s+.+\s+\/(\s|$)/.test(lower)) {
    return '检测到递归修改根目录权限的操作'
  }

  return undefined
}

/** 检查命令类调用，命中返回拒绝理由 */
function inspectShell(exec) {
  const command = commandOf(exec)
  if (typeof command !== 'string' || command.trim() === '') return undefined

  // fork bomb 会被 `;` 切段，只能在整条命令上判断
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command)) {
    return '检测到 fork bomb（进程炸弹）写法'
  }

  for (const segment of segments(command)) {
    const reason = checkSegment(stripElevation(segment))
    if (reason !== undefined) {
      return `${reason}。命令:${segment.slice(0, 200)}`
    }
  }
  return undefined
}

/** 检查写入类调用，命中返回拒绝理由 */
function inspectWrite(exec) {
  const args = exec.arguments
  if (args === null || typeof args !== 'object') return undefined
  const path = args.file_path ?? args.filePath ?? args.path ?? args.target
  if (isProtectedPath(path)) {
    return `拒绝写入受保护的系统路径:${String(path)}`
  }
  return undefined
}

function inspect(exec) {
  if (SHELL_TOOL.test(exec.name)) return inspectShell(exec)
  if (WRITE_TOOL.test(exec.name)) return inspectWrite(exec)
  return undefined
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.on(
      'tools/pre-execute',
      async (exec, next) => {
        let reason
        try {
          reason = inspect(exec)
        } catch {
          // 守卫自身出错时放行，交给沙箱与原生权限模型兜底
          return next()
        }

        if (reason !== undefined) {
          return {
            kind: 'deny',
            reason: `[danger-guard] ${reason}。该调用被本地策略拒绝，未执行；如确有必要，请说明具体对象与用途。`,
            info: { name: 'DangerGuardBlocked', code: 'DANGER_GUARD_BLOCKED' },
          }
        }

        return next()
      },
      { prepend: true },
    ),
  )
}
