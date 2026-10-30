/**
 * 侧边栏会话树的纯逻辑。
 *
 * 从 index.tsx 抽出来的唯一目的：能被 node:test 直接覆盖。
 * TUI 的渲染结果无法自动验证（要人眼看），但「分组、排序、可见性、展开判断」
 * 这些决定渲染内容的逻辑是可以的，而它们正是出错最多的地方。
 *
 * 这个文件不允许引入任何运行时依赖，只能有纯函数。
 */

/** 只依赖这几个字段，避免和 @opencode/plugin 的类型耦合，测试也好造数据。 */
export interface SessionLike {
  id: string
  parentID?: string | null
  title?: string | null
  time: { updated: number }
}

export interface Tree<T extends SessionLike = SessionLike> {
  /** 没有 parentID 的会话，保持传入顺序。 */
  roots: T[]
  /** parentID → 直接子会话，已按 time.updated 升序（早的在上）。 */
  children: Map<string, T[]>
}

/**
 * 把扁平的会话列表按 parentID 分成根会话和子会话两组。
 *
 * 泛型是为了不丢调用方的原始类型：传 Session[] 进来，拿到的还是 Session[]。
 *
 * parentID 指向一个不存在的会话时，这个子会话仍然进 children，
 * 但因为没有对应的根会话，它永远不会被渲染。这是有意的：
 * 宁可隐藏，也不要把它错挂到别的父会话下面。
 */
export function splitTree<T extends SessionLike>(sessions: readonly T[]): Tree<T> {
  const roots: T[] = []
  const children = new Map<string, T[]>()

  for (const session of sessions) {
    if (!session.parentID) {
      roots.push(session)
      continue
    }
    const siblings = children.get(session.parentID)
    if (siblings) siblings.push(session)
    else children.set(session.parentID, [session])
  }

  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.time.updated - b.time.updated)
  }

  return { roots, children }
}

/** 当前会话若是子会话，返回它的父会话 id；根会话或找不到时返回 null。 */
export function parentOf(sessions: readonly SessionLike[], sessionID: string): string | null {
  const found = sessions.find((session) => session.id === sessionID)
  return found?.parentID ?? null
}

/**
 * 选出可见的根会话：按更新时间倒序，截到 limit 条。
 *
 * 若正在查看某个子会话，它的父会话必须在可见范围内，否则侧边栏里
 * 看不到自己所在的线程。父会话排在 limit 之外时提到最前面。
 *
 * limit <= 0 由调用方兜底（上层会把 0 当成默认值），这里不做额外处理。
 */
export function visibleRoots<T extends SessionLike>(
  roots: readonly T[],
  currentParentID: string | null,
  limit: number,
): T[] {
  const sorted = [...roots].sort((a, b) => b.time.updated - a.time.updated)

  if (currentParentID) {
    const index = sorted.findIndex((session) => session.id === currentParentID)
    // index === -1 表示父会话不在本次结果里（被 FETCH_LIMIT 截掉了），此时不动
    if (index >= limit) {
      const [parent] = sorted.splice(index, 1)
      if (parent) sorted.unshift(parent)
    }
  }

  return sorted.slice(0, limit)
}

/** 这一行是否应该展开：手动展开过，或者它是当前会话的父会话。 */
export function shouldExpand(
  sessionID: string,
  expandedIDs: readonly string[],
  currentParentID: string | null,
): boolean {
  return expandedIDs.includes(sessionID) || sessionID === currentParentID
}

/** 会话标题：优先用 title，空串或纯空格时退回 id 前 8 位。 */
export function sessionTitle(session: SessionLike): string {
  const title = session.title?.trim()
  return title ? title : session.id.slice(0, 8)
}

/** 子会话行的树形连接符：最后一个用 └，其余用 ├。 */
export function childConnector(index: number, total: number): string {
  return index === total - 1 ? "\u2514" : "\u251C"
}
