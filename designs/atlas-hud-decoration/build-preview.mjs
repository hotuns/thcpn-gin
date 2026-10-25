// Build a standalone review sheet from the actual production ornaments, without authentication or API mocks.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(path.join(root, 'app/package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = path.join(root, 'app/apps/platform/src');
const compiled = ts.transpileModule(fs.readFileSync(path.join(src, 'observatory-decoration.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { ObservatoryFrame, ObservatoryMasthead, ObservatoryTitle } = module.exports;
const h = React.createElement;
const css = fs.readFileSync(path.join(src, 'observatory-decoration.css'), 'utf8');
const ornament = title => renderToStaticMarkup(h(React.Fragment, null, h(ObservatoryFrame), h(ObservatoryMasthead), h(ObservatoryTitle, { title, eyebrow: 'IN-SITU ECOCLOUD / OBSERVATION NETWORK' })));
fs.writeFileSync(path.join(here, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>一张图 · 装饰组件预览</title><style>${css}
*{box-sizing:border-box}body{margin:0;padding:32px;background:#030a15;color:#dceeff;font-family:system-ui,sans-serif}body>header{max-width:1440px;margin:0 auto 24px}body>header p{color:#7c9bb8;font-size:13px}.preview{max-width:1440px;margin:24px auto;position:relative;min-height:320px;background:radial-gradient(ellipse at 50% 70%,#103d55,#061326 65%);border:1px solid #233e5c;padding:0 24px 24px}.preview>.obs-title{width:min(620px,55%);margin:auto}.panels{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:24px;margin-top:28px}.atlas-directory{min-height:150px;border:1px solid #365b7e}.atlas-directory header{padding:12px 16px;font-size:13px}.panel-copy{padding:20px 16px;font-size:12px;color:#80a4bf;line-height:1.8}.center{display:grid;place-content:center;text-align:center;color:#507795;font-size:12px;letter-spacing:3px;border:1px dashed #335574}footer{max-width:1440px;margin:auto;color:#7490a9;font-size:12px}@media(max-width:700px){body{padding:12px}.preview>.obs-title{width:100%}.panels{grid-template-columns:1fr}.center{min-height:120px}.preview{padding-inline:12px}}
</style><header><h2>一张图 / 装饰系统</h2><p>生产组件的独立预览 · 无业务数据 · 参考蓝色金属折线风格，采用原创 SVG / CSS</p></header>${['生态观测一张图','数字样地'].map(title=>`<section class="preview atlas-shell">${ornament(title)}<div class="panels"><section class="atlas-directory"><header>设备运行概况</header><div class="panel-copy">蓝银角标 / 金色刻线<br>面板标题条与正文分层</div></section><div class="center">${title}<br>地图区域</div><section class="atlas-directory"><header>观测数据</header><div class="panel-copy">贯穿式翼板 / 中央标题铭牌<br>装饰不拦截地图和控件操作</div></section></div></section>`).join('')}<footer>仅审阅装饰组件；设备、地图、指标与影像仍由现有业务页面展示。</footer></html>`);

// The second sheet exercises the exact header hierarchy against all production CSS.
const productionCSS = ['atlas.css', 'atlas-templates.css', 'digital-plot.css', 'observatory.css', 'observatory-decoration.css'].map(file => fs.readFileSync(path.join(src, file), 'utf8')).join('\n');
const title = renderToStaticMarkup(h(ObservatoryTitle, {title:'生态观测一张图', eyebrow:'IN-SITU ECOCLOUD / 一张图', className:'atlas-title'}));
const masthead = renderToStaticMarkup(h(ObservatoryMasthead));
const frame = renderToStaticMarkup(h(ObservatoryFrame));
const health = `<section class="atlas-summary atlas-health"><header><strong>设备运行概况</strong><small>近 24 小时</small></header><div class="atlas-health-grid">${['设备总数','正常上报','上报超时','状态未知'].map((label,i)=>`<div class="atlas-health-count is-${['total','normal','overdue','unknown'][i]}"><span>${label}</span><strong>—</strong></div>`).join('')}</div><footer>装饰布局预览 · 不含业务数据</footer></section>`;
const tools = '<div class="atlas-header-actions"><time class="atlas-clock"><span>当前日期</span><strong>当前时间</strong></time><button aria-label="全屏">⛶</button></div>';
fs.writeFileSync(path.join(here,'layouts.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一张图 · 生产布局校验</title><style>${productionCSS}*{box-sizing:border-box}body{margin:0;background:#030a15;color:#e3f3ff;font-family:system-ui}body>h2{font-size:14px;margin:20px}button{background:#133248;border:1px solid #496f91;color:white;padding:8px}.atlas-shell{height:500px!important;min-height:500px!important;margin-bottom:24px}.atlas-workbench{height:280px!important}.atlas-map-region{display:grid;place-content:center;color:#7599b5;background:radial-gradient(ellipse,#214659,#061221)}.atlas-directory>header{padding:12px}.atlas-inspector{padding:16px}.atlas-panorama-workbench>.atlas-directory{bottom:16px!important}.digital-plot{height:300px;min-height:300px}.dp-workspace{display:block;padding:30px;color:#7599b5}</style>${['technology','panorama'].map(mode=>`<h2>${mode} / 生产样式与结构</h2><div class="atlas-shell atlas-layout-balanced atlas-template-${mode}">${frame}<div class="atlas-topbar">${masthead}<header class="atlas-header">${title}</header>${health}${tools}</div><div class="${mode==='panorama'?'atlas-panorama-workbench':'atlas-workbench'}"><section class="atlas-directory"><header>设备列表</header></section><div class="atlas-map-region">地图区域</div><aside class="atlas-inspector">观测数据</aside></div></div>`).join('')}<h2>digital-plot / 生产样式与结构</h2><div class="digital-plot">${frame}<header class="dp-header">${masthead}<a class="dp-back">← 专题定制</a>${renderToStaticMarkup(h(ObservatoryTitle,{title:'数字样地',eyebrow:'DIGITAL FIELD OBSERVATORY',className:'dp-title'}))}<div class="dp-header-tools"><time class="atlas-clock">当前时间</time><button aria-label="全屏">⛶</button></div></header><div class="dp-workspace">地图与观测面板区域 · 不含业务数据</div></div></html>`);
