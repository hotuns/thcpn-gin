# 用户端 Select 滚动回归

共用 shadcn Select 的弹出层最大高度为 `320px` 与 Radix 可用高度的较小值。
弹出层使用纵向 flex，Viewport 允许收缩并负责滚动；上下滚动按钮不收缩。
不能只对外层设置 overflow，否则选项仍可能无法滚动。

## 浏览器回归步骤

1. 在一张图选择包含至少 30 个节点的网关，展开节点选择器。
2. 检查弹出层上下边界都在视口内，高度不超过 320px。
3. 在菜单中向下滚动，确认最后一个选项完整可见且可选，选择后菜单关闭、值更新。
4. 再次打开，检查当前选项可见；使用方向键、Home/End 和 Escape 检查键盘操作。
5. 在较矮视口、靠近页面底部的选择器及 Dialog 内重复检查。

可在菜单打开时通过只读 DOM 检查 `.shadcn-select-content` 的边界，
以及 `.shadcn-select-viewport` 的 `clientHeight`、`scrollHeight`、`scrollTop`。
长列表应满足 `scrollHeight > clientHeight`；滚到底部后，末项边界应在 Viewport 内。
此问题依赖真实浏览器布局，jsdom 的零尺寸测量不能替代浏览器回归。

## 2026-09-26 验证记录

- 修复前：775px 高视口内菜单高 1032px，底边 1428.5px；Viewport 与内容均高 1030px，无可滚动范围。
- 修复后：菜单高 320px；720px 高视口内底边 354.5px，自动向上展开。
- 滚轮到达末项后：scrollTop 736px，clientHeight 294px，scrollHeight 1030px。
- 末项底边 348.5px，小于 Viewport 底边 353.5px；点击末项后节点值成功更新。
