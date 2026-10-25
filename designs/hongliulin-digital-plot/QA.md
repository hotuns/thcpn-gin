# 红柳林 mock 数字样地验证

- 正式入口：`/atlas/topics/digital-plot`，一张图 → 专题定制。
- 真实背景：用户提供的红柳林 XYZ 正射影像。8 块边界、6 个站点、指标、插值、链路与 2026 航次全部为 mock。
- 平台生产构建通过。7 个相关测试文件、35 项测试通过，包含瓦片拼接/失败、地理范围、站点归属、地图生命周期及回退状态。
- 测试使用 `NODE_OPTIONS=--no-experimental-webstorage`，避免 Node 26 自带 Web Storage 干扰 jsdom。
- Vite 浏览器验证：在线三维瓦片拼接、地块抬升和站点、边界编辑/测量/保存、模拟航次卷帘；临时验证入口已移除，不影响正式路由认证。
- 模拟无效瓦片地址，验证 Three.js 与 MapLibre 均回退同区域本地预览并显示提示。
- `scene.png` 与 `boundary-workbench.png` 为实际 WebGL 截图；验证视口为 793×954，未据此声称完成桌面大屏尺寸验收。
- 通用 Three.js 检查脚本已运行：地块特效与隐私检查通过；其 Vue/Earth/行政区下钻模板项不适用于项目既有 React 终端地块适配，参见 `src/vendor/three-scope-map/README.md`。
- 保留用户原有未提交改动；没有部署、提交或访问真实设备数据。
