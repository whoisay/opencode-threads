/**
 * 会话树纯逻辑的测试。
 *
 * 原则：每个用例都对应一个真实出过的边界，不为了覆盖率凑数。
 * 这些逻辑决定了侧边栏渲染什么，而 TUI 的渲染结果没法自动验证，
 * 所以能测的只有这一层——它正好也是最容易出错的一层。
 *
 * 运行：先 build（tsc 会输出 dist/tree.js），再 node --test test/
 */
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  childConnector,
  parentOf,
  sessionTitle,
  shouldExpand,
  splitTree,
  visibleRoots,
} from "../dist/tree.js"

/** 造一个最小会话。updated 用数字，越大越新。 */
const s = (id, updated, parentID = null, title = null) => ({
  id,
  parentID,
  title,
  time: { updated },
})

test("splitTree: 空列表不炸", () => {
  const tree = splitTree([])
  assert.deepEqual(tree.roots, [])
  assert.equal(tree.children.size, 0)
})

test("splitTree: 全是根会话时 children 为空", () => {
  const tree = splitTree([s("a", 1), s("b", 2)])
  assert.deepEqual(tree.roots.map((x) => x.id), ["a", "b"])
  assert.equal(tree.children.size, 0)
})

test("splitTree: 按 parentID 分组，根会话保持传入顺序", () => {
  const tree = splitTree([s("root1", 10), s("kid1", 11, "root1"), s("root2", 12)])
  assert.deepEqual(tree.roots.map((x) => x.id), ["root1", "root2"])
  assert.deepEqual(tree.children.get("root1").map((x) => x.id), ["kid1"])
})

test("splitTree: 子会话按 time.updated 升序，不是按传入顺序", () => {
  // 服务端返回是 desc（新的在前），这里必须倒过来，否则子会话上下的顺序是反的
  const tree = splitTree([
    s("p", 100),
    s("kid-late", 30, "p"),
    s("kid-early", 10, "p"),
    s("kid-mid", 20, "p"),
  ])
  assert.deepEqual(
    tree.children.get("p").map((x) => x.id),
    ["kid-early", "kid-mid", "kid-late"],
  )
})

test("splitTree: 孤儿节点进 children 但不进 roots（宁可隐藏也不错挂）", () => {
  // parentID 指向一个不存在的会话，可能是 FETCH_LIMIT 把它爹截掉了
  const tree = splitTree([s("root", 10), s("orphan", 20, "missing-parent")])
  assert.deepEqual(tree.roots.map((x) => x.id), ["root"])
  assert.equal(tree.children.get("missing-parent").length, 1)
  // 关键断言：它不会出现在任何现有根会话的子列表里
  assert.equal(tree.children.get("root"), undefined)
})

test("parentOf: 根会话返回 null", () => {
  assert.equal(parentOf([s("a", 1)], "a"), null)
})

test("parentOf: 子会话返回父 id", () => {
  assert.equal(parentOf([s("a", 1), s("kid", 2, "a")], "kid"), "a")
})

test("parentOf: 找不到的 id 返回 null", () => {
  assert.equal(parentOf([s("a", 1)], "nope"), null)
})

test("visibleRoots: 按更新时间倒序", () => {
  const roots = [s("old", 1), s("new", 100), s("mid", 50)]
  assert.deepEqual(visibleRoots(roots, null, 10).map((x) => x.id), ["new", "mid", "old"])
})

test("visibleRoots: 截断到 limit", () => {
  const roots = [s("a", 3), s("b", 2), s("c", 1)]
  assert.deepEqual(visibleRoots(roots, null, 2).map((x) => x.id), ["a", "b"])
})

test("visibleRoots: limit 大于总数时返回全部", () => {
  const roots = [s("a", 2), s("b", 1)]
  assert.equal(visibleRoots(roots, null, 10).length, 2)
})

test("visibleRoots: 空列表不炸", () => {
  assert.deepEqual(visibleRoots([], "parent", 10), [])
})

test("visibleRoots: 父会话排在 limit 之外时提到最前面", () => {
  // 真实场景：limit=2，正在看的子会话属于最新的根会话（排第 3），
  // 不提升的话侧边栏里根本看不到自己所在的线程
  const roots = [s("a", 300), s("b", 200), s("parent", 100)]
  const result = visibleRoots(roots, "parent", 2)
  assert.deepEqual(result.map((x) => x.id), ["parent", "a"])
})

test("visibleRoots: 父会话已在可见范围内时保持原顺序", () => {
  const roots = [s("parent", 300), s("b", 200), s("c", 100)]
  const result = visibleRoots(roots, "parent", 2)
  assert.deepEqual(result.map((x) => x.id), ["parent", "b"])
})

test("visibleRoots: 父会话不在 roots 里时不动列表", () => {
  // 数据不全（父被 FETCH_LIMIT 截掉），此时不该乱插位置
  const roots = [s("a", 300), s("b", 200)]
  assert.deepEqual(visibleRoots(roots, "ghost", 2).map((x) => x.id), ["a", "b"])
})

test("visibleRoots: limit 为 1 时父会话挤出唯一位置", () => {
  const roots = [s("a", 300), s("b", 200), s("parent", 100)]
  assert.deepEqual(visibleRoots(roots, "parent", 1).map((x) => x.id), ["parent"])
})

test("shouldExpand: 手动展开过的为 true", () => {
  assert.equal(shouldExpand("a", ["a"], null), true)
})

test("shouldExpand: 当前会话的父会话强制展开", () => {
  // 进入子会话时，父会话必须自动打开，否则看不到自己在哪
  assert.equal(shouldExpand("a", [], "a"), true)
})

test("shouldExpand: 既没手动展开也不是当前父会话", () => {
  assert.equal(shouldExpand("a", ["b"], "c"), false)
})

test("sessionTitle: 正常标题原样返回", () => {
  assert.equal(sessionTitle(s("id", 1, null, "分析 dsh-TUI")), "分析 dsh-TUI")
})

test("sessionTitle: 前后空格被 trim", () => {
  assert.equal(sessionTitle(s("id", 1, null, "  有空格  ")), "有空格")
})

test("sessionTitle: 空字符串退回 id 前 8 位", () => {
  assert.equal(sessionTitle(s("ses_abcdefghij", 1, null, "")), "ses_abcd")
})

test("sessionTitle: 纯空格退回 id 前 8 位", () => {
  // 服务端有时给 "   " 而不是空串，之前会在侧边栏渲染成一行空白
  assert.equal(sessionTitle(s("ses_abcdefghij", 1, null, "   ")), "ses_abcd")
})

test("sessionTitle: title 为 null 退回 id 前 8 位", () => {
  assert.equal(sessionTitle(s("ses_abcdefghij", 1, null, null)), "ses_abcd")
})

test("childConnector: 最后一个用 └", () => {
  assert.equal(childConnector(2, 3), "\u2514")
})

test("childConnector: 非最后一个用 ├", () => {
  assert.equal(childConnector(0, 3), "\u251C")
  assert.equal(childConnector(1, 3), "\u251C")
})

test("childConnector: 只有一个子会话时也是 └", () => {
  assert.equal(childConnector(0, 1), "\u2514")
})
