<div style="padding:18px;max-width: 1024px;margin:0 auto;background-color:#fff;color:#333">
<h2>运行前置条件</h2>
<ul>
  <li>项目说明：这是基于 webman + PebView + php-wasm 的桌宠小游戏。</li>
  <li>启动方式：Windows 下用 <code>windows.bat</code>（或在项目根执行 <code>php windows.php</code>）；注意不要用 <code>php start.php start</code>（Windows 下会被框架拒绝并提示改用 <code>windows.php</code>）。</li>
  <li>访问方式：网页版 <code>http://127.0.0.1:8787/pet</code>（访问根路径 <code>/</code> 会自动跳转）。</li>
  <li>前置条件：需要 PHP 开启 <code>ffi</code> 扩展（<code>php.ini</code> 中 <code>extension=ffi</code> 且 <code>ffi.enable=true</code>），否则原生桌宠窗口不会启动，只保留网页版；另外需要系统已安装 WebView2 运行时。</li>
  <li>素材替换：宠物图片等素材放在 <code>public/pet/assets/</code>，详见该目录下的 <code>README.md</code>。</li>
</ul>
<h2>桌面悬浮模式</h2>
<ul>
  <li>窗口形态：透明背景（页面未绘制的区域直接透出桌面）、无系统标题栏、始终置顶。平时窗口收起为 <strong>136×168</strong>，只包含宠物本体与周围少量留白，不占多余桌面空间。</li>
  <li>拖动方式：按住窗口顶部 24px 的拖动条（该区域不可见，但可按住）用鼠标左键拖动窗口。</li>
  <li>操作浮层：点击宠物本体，窗口会临时放大到 <strong>360×300</strong> 并从底部弹出操作浮层（动作按钮与工具栏）；再次点击宠物则收起浮层、窗口缩回宠物大小。窗口放大时若超出屏幕，会自动钳制回可视区域内。</li>
  <li>点击穿透：右键系统托盘图标，菜单中有「开启点击穿透」与「关闭点击穿透」两项。这两项是幂等的开关动作，菜单不会显示勾选状态，需自行记住当前状态；开启穿透后窗口不再接收鼠标事件，必须通过托盘菜单重新关闭。</li>
  <li>位置记忆：窗口位置自动保存在 <code>runtime/pet/window.json</code>，重启应用后回到上次位置；首次启动（无存档）默认出现在屏幕右下角并保留边距。</li>
  <li>网页版不受影响：浏览器直接打开 <code>http://127.0.0.1:8787/pet</code>（不带参数）时仍保持原来的完整面板形态，方便粘贴、截图与专注使用。</li>
</ul>
<h3>配置开关</h3>
<ul>
  <li>配置位置：<code>config/plugin/kingbes/pebview/pebview.php</code> 中的 <code>desktop</code> 段。</li>
  <li><code>enabled</code>：设为 <code>false</code> 可关闭桌面悬浮模式，退回旧行为（系统标题栏、不透明、不置顶），并导航到网页版 <code>/pet</code>。</li>
  <li>可调项：<code>size</code>（收起态窗口尺寸，宽度不得小于 Windows 的 <code>SM_CXMINTRACK</code>=136，否则会被系统钳制）、<code>expandSize</code>（点击宠物时的展开态尺寸）、<code>alwaysOnTop</code>（是否置顶）、<code>clickThrough</code>（初始是否开启点击穿透）、<code>dragBarHeight</code>（拖动条高度，必须与前端拖动条高度一致，默认 24）。</li>
</ul>
<h1>webman</h1>

基于<a href="https://www.workerman.net" target="__blank">workerman</a>开发的超高性能PHP框架


<h1>学习</h1>

<ul>
  <li>
    <a href="https://www.workerman.net/webman" target="__blank">主页 / Home page</a>
  </li>
  <li>
    <a href="https://webman.workerman.net" target="__blank">文档 / Document</a>
  </li>
  <li>
    <a href="https://www.workerman.net/doc/webman/install.html" target="__blank">安装 / Install</a>
  </li>
  <li>
    <a href="https://www.workerman.net/questions" target="__blank">问答 / Questions</a>
  </li>
  <li>
    <a href="https://www.workerman.net/apps" target="__blank">市场 / Apps</a>
  </li>
  <li>
    <a href="https://www.workerman.net/sponsor" target="__blank">赞助 / Sponsors</a>
  </li>
  <li>
    <a href="https://www.workerman.net/doc/webman/thanks.html" target="__blank">致谢 / Thanks</a>
  </li>
</ul>

<div style="float:left;padding-bottom:30px;">

  <h1>赞助商</h1>

  <h4>特别赞助</h4>
  <a href="https://www.crmeb.com/?form=workerman" target="__blank">
    <img src="https://www.workerman.net/img/sponsors/6429/20230719111500.svg" width="200">
  </a>

  <h4>铂金赞助</h4>
  <a href="https://www.fadetask.com/?from=workerman" target="__blank"><img src="https://www.workerman.net/img/sponsors/1/20230719084316.png" width="200"></a>
  <a href="https://www.yilianyun.net/?from=workerman" target="__blank" style="margin-left:20px;"><img src="https://www.workerman.net/img/sponsors/6218/20230720114049.png" width="200"></a>


</div>


<div style="float:left;padding-bottom:30px;clear:both">

  <h1>请作者喝咖啡</h1>

<img src="https://www.workerman.net/img/wx_donate.png" width="200">
<img src="https://www.workerman.net/img/ali_donate.png" width="200">
<br>
<b>如果您觉得webman对您有所帮助，欢迎捐赠。</b>


</div>


<div style="clear: both">
<h1>LICENSE</h1>
The webman is open-sourced software licensed under the MIT.
</div>

</div>


