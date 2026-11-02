# 原型验证

- 已通过浏览器实际打开三个方向，桌面1440×900，移动375×812，保存首屏、整页和手机截图。
- 三个方向手机端 documentElement.scrollWidth 均为375，无页面横向溢出。
- 设备导航、按名称搜索、设备详情、详情进入影像、图片dialog放大和关闭、手机导航进入数据分析已实际点击验证。
- 查询、导出和刷新是明确提示的演示动作，不执行生产操作。
- Python design_lint check/compare/ledger check因缺少Python Playwright跳过，改为浏览器目视与DOM验证。浏览器日志曾出现一条MutationObserver observe错误；原型源码未使用MutationObserver，无法据此认定控制台零错误。
- 真实图片接口和测量项未接入，森林图、曲线和地图位置在原型中明确标记为示意。
- 预览入口 http://127.0.0.1:5186/index.html ，不依赖当前5173开发服务。
