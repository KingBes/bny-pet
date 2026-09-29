/**
 * bnyPet 桌宠 - 前端核心模块
 * ============================================================
 * 对外暴露全局 window.PetGame，公共契约（其它子任务依赖，名称不可更改）：
 *
 *   PetGame.state                 最新权威状态对象
 *   PetGame.on(evt, fn)           订阅事件
 *   PetGame.emit(evt, payload)    派发事件
 *   PetGame.api(path, body)       body 有值走 POST JSON，否则 GET；返回解析后的 JSON
 *   PetGame.refresh()             GET /pet/state，写入 state、渲染、emit('state')
 *   PetGame.action(type)          POST /pet/action {type}
 *   PetGame.render(state)         依据状态刷新 DOM 与 Canvas
 *   PetGame.toast(msg)            页面内气泡提示（非阻塞）
 *   PetGame.bridge                与 PebView 原生窗口桥接的安全包装
 * ============================================================
 */
(function () {
    'use strict';

    // 形态（stage）1~4 的中文名
    var STAGE_NAMES = ['幼生期', '成长期', '成熟期', '完全体'];

    // 各阶段外观配置：体型 / 配色 / 是否长耳朵、小角
    var STAGE_STYLE = {
        1: { r: 30, body: '#b6e2a1', belly: '#e9f7dd', accent: '#8fc86a', ears: false, horn: false },
        2: { r: 36, body: '#9ed36a', belly: '#eef8dc', accent: '#7cb84a', ears: false, horn: false },
        3: { r: 42, body: '#f7c873', belly: '#fdeecd', accent: '#e0a63f', ears: true, horn: false },
        4: { r: 48, body: '#f7a8c0', belly: '#fde4ec', accent: '#e07f9e', ears: true, horn: true }
    };

    window.PetGame = {
        // ---------- 公共状态 ----------
        state: null,

        // ---------- 内部字段 ----------
        _events: {},          // 事件总线
        _toastTimer: null,    // toast 自动隐藏定时器
        _stage: 1,            // 当前形态（1~4），供 Canvas 使用
        _canvas: null,
        _ctx: null,
        _raf: 0,
        _blinkUntil: 0,       // 当前眨眼结束时间
        _nextBlink: 0,        // 下一次眨眼开始时间
        _decoImg: null,       // 装扮素材图片（懒加载）
        _decoKey: '',         // 当前装扮素材 URL，用于判断是否需要重新加载
        _petImg: null,        // 宠物立绘图片（懒加载）
        _petKey: '',          // 当前立绘素材 URL
        _petFrames: [],       // 宠物逐帧序列（已加载帧，索引与清单对齐）
        _petFramesKey: '',    // 当前序列帧前缀，用于判断是否需要重置
        _bgImg: null,         // 舞台背景图片（懒加载）
        _bgKey: '',           // 当前背景素材 URL

        /* ============================================================
         * 极简事件总线
         * ============================================================ */

        /**
         * 订阅事件
         * @param {string} evt 事件名
         * @param {Function} fn 回调
         */
        on: function (evt, fn) {
            if (typeof fn !== 'function') {
                return;
            }
            if (!this._events[evt]) {
                this._events[evt] = [];
            }
            this._events[evt].push(fn);
        },

        /**
         * 派发事件（单个监听器异常不影响其它监听器）
         * @param {string} evt 事件名
         * @param {*} payload 载荷
         */
        emit: function (evt, payload) {
            var list = this._events[evt];
            if (!list) {
                return;
            }
            for (var i = 0; i < list.length; i++) {
                try {
                    list[i](payload);
                } catch (e) {
                    // 忽略单个监听器的异常，避免影响主流程
                }
            }
        },

        /* ============================================================
         * 网络请求
         * ============================================================ */

        /**
         * 统一请求封装
         * body 有值则 POST JSON，否则 GET。
         * 统一响应结构为 { code:0|1, msg:'', data:{} }；
         * code !== 0 时 toast 提示并返回 null。
         *
         * @param {string} path 接口路径
         * @param {*} [body] 请求体（有值则 POST）
         * @returns {Promise<Object|null>} 解析后的 JSON 对象或 null
         */
        api: function (path, body) {
            var options = { method: 'GET', headers: {} };
            if (body) {
                options.method = 'POST';
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }

            var self = this;
            return fetch(path, options).then(function (resp) {
                return resp.json();
            }).then(function (json) {
                if (!json || json.code !== 0) {
                    self.toast((json && json.msg) || '操作失败');
                    return null;
                }
                return json;
            }).catch(function () {
                self.toast('网络异常，请稍后重试');
                return null;
            });
        },

        /**
         * 拉取权威状态：GET /pet/state
         * 写入 state、渲染、emit('state')；
         * 若 data.offline 为非空字符串，则用 toast 显示离线收益信息。
         */
        refresh: function () {
            var self = this;
            return this.api('/pet/state').then(function (resp) {
                if (!resp) {
                    return;
                }
                var data = resp.data || {};
                if (data.state) {
                    self.state = data.state;
                }
                self.render(self.state);
                self.emit('state', self.state);

                if (typeof data.offline === 'string' && data.offline !== '') {
                    self.toast(data.offline);
                }
            });
        },

        /**
         * 执行一个动作：POST /pet/action {type}
         * 成功后写入新 state、渲染、emit('state')，
         * 并把返回的 data.events 数组逐条 toast。
         *
         * @param {string} type 动作类型：feed | pet | play | sleep
         */
        action: function (type) {
            var self = this;
            return this.api('/pet/action', { type: type }).then(function (resp) {
                if (!resp) {
                    return;
                }
                var data = resp.data || {};
                if (data.state) {
                    self.state = data.state;
                    self.render(self.state);
                    self.emit('state', self.state);
                }
                if (data.events && data.events.length) {
                    for (var i = 0; i < data.events.length; i++) {
                        self.toast(data.events[i]);
                    }
                }
            });
        },

        /* ============================================================
         * 渲染
         * ============================================================ */

        /**
         * 取数字并兜底
         * @private
         */
        _num: function (v, fallback) {
            var n = Number(v);
            return isFinite(n) ? n : fallback;
        },

        /**
         * 在若干候选字段中取第一个非空值
         * @private
         */
        _pick: function (sources, keys, fallback) {
            for (var i = 0; i < sources.length; i++) {
                var src = sources[i];
                if (!src) {
                    continue;
                }
                for (var j = 0; j < keys.length; j++) {
                    var v = src[keys[j]];
                    if (v !== undefined && v !== null) {
                        return v;
                    }
                }
            }
            return fallback;
        },

        /**
         * 渲染单条状态条（0~100）
         * @private
         */
        _renderStat: function (id, raw) {
            var v = Math.max(0, Math.min(100, this._num(raw, 0)));
            var fill = document.getElementById(id);
            if (!fill) {
                return;
            }
            fill.style.width = v + '%';
            var row = fill.closest ? fill.closest('.stat-row') : null;
            if (row) {
                var valueEl = row.querySelector('.stat-value');
                if (valueEl) {
                    valueEl.textContent = String(Math.round(v));
                }
            }
        },

        /**
         * 依据状态刷新 DOM 与 Canvas
         * @param {Object} state 状态对象
         */
        render: function (state) {
            var s = state || {};
            var stats = s.stats || {};
            var self = this;

            var setText = function (id, val) {
                var el = document.getElementById(id);
                if (el) {
                    el.textContent = String(val);
                }
            };

            // 顶部：名称与金币
            setText('pet-name', self._pick([s], ['name'], '小bny'));
            setText('pet-coins', self._num(self._pick([s], ['coins'], 0), 0));

            // 等级
            setText('pet-level', self._num(self._pick([s], ['level'], 1), 1));

            // 形态
            var stage = Math.round(self._num(self._pick([s], ['stage'], 1), 1));
            stage = Math.max(1, Math.min(4, stage));
            self._stage = stage;
            setText('pet-stage-name', STAGE_NAMES[stage - 1]);

            // 三条状态：优先读 state.stats.*，回退到顶层字段
            self._renderStat('stat-hunger', self._pick([stats, s], ['hunger'], 0));
            self._renderStat('stat-mood', self._pick([stats, s], ['mood'], 0));
            self._renderStat('stat-energy', self._pick([stats, s], ['energy'], 0));

            // 经验：当前值 + 升级所需值
            var exp = self._num(self._pick([s], ['exp'], self._pick([stats], ['exp'], 0)), 0);
            var need = self._num(
                self._pick([s], ['expNeed', 'expNext', 'expMax'], self._pick([stats], ['expNeed'], 0)),
                0
            );
            var expFill = document.querySelector('#pet-exp-bar .bar-fill');
            if (expFill) {
                var percent = need > 0 ? Math.max(0, Math.min(100, (exp / need) * 100)) : 0;
                expFill.style.width = percent + '%';
            }
            var remaining = need > 0 ? Math.max(0, need - exp) : 0;
            setText('pet-exp-text', '还需 ' + remaining + ' 经验升级');
        },

        /**
         * 页面内气泡提示（非阻塞，复用 #pet-bubble）
         * @param {string} msg 提示内容
         */
        toast: function (msg) {
            var el = document.getElementById('pet-bubble');
            if (!el) {
                return;
            }
            el.textContent = String(msg);
            el.classList.remove('hidden');

            if (this._toastTimer) {
                clearTimeout(this._toastTimer);
            }
            var self = this;
            this._toastTimer = setTimeout(function () {
                el.classList.add('hidden');
                self._toastTimer = null;
            }, 2500);
        },

        /* ============================================================
         * 桌面模式（悬浮窗形态）
         * ============================================================ */

        /**
         * 桌面模式初始化
         * URL 查询串含 mode=desktop 时：透明窗口 + 只显示宠物 + 拖动 + 位置恢复上报。
         * 非桌面模式直接返回，网页版零影响；原生桥接缺失时全部静默跳过。
         * @private
         */
        _initDesktop: function () {
            if (!/(?:^|[?&])mode=desktop(?:&|$)/.test(window.location.search)) {
                return;
            }

            document.documentElement.classList.add('is-desktop');

            // Canvas backing store 必须等于它的**显示尺寸**（.stage 的布局尺寸），不能用
            // innerWidth/innerHeight：收起态两者相同，但展开态 .stage 只占窗口上半部分，
            // 若按窗口尺寸建 backing store 再被 CSS 压缩显示，宠物会被压扁变形。
            var syncCanvasSize = function () {
                var c = document.getElementById('pet-stage');
                if (!c) {
                    return null;
                }
                var w = c.clientWidth || window.innerWidth;
                var h = c.clientHeight || window.innerHeight;
                if (c.width !== w || c.height !== h) {
                    c.width = w;
                    c.height = h;
                }
                return c;
            };

            // 补一帧同步并重绘：浮层切换会让 .stage 立刻改变布局，但窗口尺寸要等
            // 原生 setSize 回来才变，不补这一帧会按旧尺寸绘制、宠物被压扁
            var resyncCanvas = function () {
                var run = function () {
                    try {
                        if (syncCanvasSize()) {
                            window.PetGame._draw(0);
                        }
                    } catch (e) {
                        // 忽略补同步异常
                    }
                };
                try {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(run);
                    } else {
                        setTimeout(run, 0);
                    }
                } catch (e) {
                    // 忽略调度异常
                }
            };

            var canvas = syncCanvasSize();

            // screenX/screenY/availWidth 为 CSS 像素，后端 setPosition 需物理屏幕像素
            var dpr = window.devicePixelRatio || 1;
            var lastSent = null;

            // 上报窗口位置（乘 dpr 取整；与上次相同则跳过）
            var report = function (x, y) {
                var px = Math.round(x * dpr);
                var py = Math.round(y * dpr);
                if (lastSent && lastSent.x === px && lastSent.y === py) {
                    return;
                }
                lastSent = { x: px, y: py };
                if (typeof window.petSetPos === 'function') {
                    try {
                        window.petSetPos(px, py);
                    } catch (e) {
                        // 桥接异常静默忽略
                    }
                }
            };

            // 初始位置：解析 → 校验 x/y → 钳制到可视区 → report。
            // 同步值与 Promise 两种返回共用本逻辑；桥接缺失 / 结果无效 / Promise reject
            // 均传入空值走默认右下角分支，任何异常都在内部消化，不向外抛出。
            var applyPos = function (raw) {
                try {
                    var pos = raw;
                    if (typeof pos === 'string') {
                        try {
                            pos = JSON.parse(pos);
                        } catch (e) {
                            pos = null;
                        }
                    }

                    var availW = window.screen ? window.screen.availWidth : 0;
                    var availH = window.screen ? window.screen.availHeight : 0;
                    var maxX = Math.max(0, (availW || 0) - window.innerWidth);
                    var maxY = Math.max(0, (availH || 0) - window.innerHeight);

                    var x;
                    var y;
                    if (
                        pos
                        && typeof pos.x === 'number' && isFinite(pos.x)
                        && typeof pos.y === 'number' && isFinite(pos.y)
                    ) {
                        x = Math.min(Math.max(pos.x, 0), maxX);
                        y = Math.min(Math.max(pos.y, 0), maxY);
                    } else {
                        x = Math.max(0, maxX - 24);
                        y = Math.max(0, maxY - 24);
                    }
                    report(x, y);
                } catch (e) {
                    // 位置恢复失败不影响页面
                }
            };

            // webview 的 JS 桥对每次 bind 调用都返回 Promise（见 vendor Window.php 的
            // encodeResult / test/demo-bind.php 的 await 用法），因此这里必须兼容：
            // 返回值带 then 时异步取结果，否则按普通值同步处理。
            if (typeof window.petGetPos === 'function') {
                try {
                    var raw = window.petGetPos();
                    if (raw && typeof raw.then === 'function') {
                        raw.then(applyPos, function () {
                            // Promise 被 reject：回退默认右下角
                            applyPos(null);
                        });
                    } else {
                        applyPos(raw);
                    }
                } catch (e) {
                    // 桥接同步异常：回退默认右下角
                    applyPos(null);
                }
            } else {
                // 桥接不存在（浏览器预览）：回退默认右下角
                applyPos(null);
            }

            // 定期把窗口真实位置同步进存档。
            // 绝不能用 window.screenX 上报：实测它是 stale 的（setPosition 移动窗口后仍返回
            // 窗口创建时的原生默认位），既会把正确存档覆盖成错误值，还会调 setPosition 把
            // 已经恢复好的窗口拽回错误位置。改由 PHP 侧 GetWindowRect 读真实矩形，
            // 该桥接只写文件、不移动窗口，因此不会出现"自己拽自己"。
            try {
                setInterval(function () {
                    if (typeof window.petSyncPos !== 'function') {
                        return;
                    }
                    try {
                        window.petSyncPos();
                    } catch (e) {
                        // 桥接异常静默忽略
                    }
                }, 500);
            } catch (e) {
                // 忽略定时器创建异常
            }

            // 拖动条：左键按下交给原生桥接移动窗口
            var dragbar = document.getElementById('pet-dragbar');
            if (dragbar) {
                dragbar.addEventListener('mousedown', function (e) {
                    e.stopPropagation();
                    if (e.button !== 0) {
                        return;
                    }
                    if (typeof window.petDrag !== 'function') {
                        return;
                    }
                    try {
                        window.petDrag(e.screenX, e.screenY);
                    } catch (err) {
                        // 桥接异常静默忽略
                    }
                });
            }

            // 点击宠物切换操作浮层（拖动条已 stopPropagation，不会误触发）
            // 展开浮层时让原生窗口放大到展开态，收起时缩回贴合宠物的收起态
            if (canvas) {
                canvas.addEventListener('click', function () {
                    var open = !document.body.classList.contains('panel-open');
                    if (open) {
                        document.body.classList.add('panel-open');
                    } else {
                        document.body.classList.remove('panel-open');
                    }
                    if (typeof window.petSetPanel === 'function') {
                        try {
                            // 传屏幕可用尺寸（换算成物理像素），供后端展开时钳制位置、
                            // 避免窗口常驻右下角时展开有一截跑出可视区
                            var availW = window.screen ? Math.round(window.screen.availWidth * dpr) : 0;
                            var availH = window.screen ? Math.round(window.screen.availHeight * dpr) : 0;
                            window.petSetPanel(open, availW, availH);
                        } catch (e) {
                            // 桥接异常静默忽略，浮层仍照常切换
                        }
                    }
                    resyncCanvas();
                });
            }

            // 跟随窗口 / 舞台尺寸变化重设 Canvas 尺寸并重绘。
            // 收起与展开都会触发 resize，这里统一按 .stage 的实际布局尺寸同步
            window.addEventListener('resize', function () {
                var c = syncCanvasSize();
                if (!c) {
                    return;
                }
                try {
                    window.PetGame._draw(0);
                } catch (e) {
                    // 忽略重绘异常
                }
            });
        },

        /* ============================================================
         * Canvas 占位宠物（纯代码绘制 + 浮动 / 眨眼动画）
         * ============================================================ */

        /**
         * 启动动画循环
         * @private
         */
        _startLoop: function () {
            var canvas = document.getElementById('pet-stage');
            if (!canvas || !canvas.getContext) {
                return;
            }
            var ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            this._canvas = canvas;
            this._ctx = ctx;

            var self = this;
            var loop = function (ts) {
                self._draw(ts || 0);
                self._raf = requestAnimationFrame(loop);
            };
            // 同步绘制首帧，避免 requestAnimationFrame 被节流时画面空白
            try {
                this._draw(0);
            } catch (e) {
                // 忽略首帧绘制异常，交由 rAF 循环继续尝试
            }
            this._raf = requestAnimationFrame(loop);
        },

        /**
         * 绘制一帧
         * @private
         * @param {number} ts 时间戳
         */
        _draw: function (ts) {
            var ctx = this._ctx;
            var canvas = this._canvas;
            if (!ctx || !canvas) {
                return;
            }

            var W = canvas.width;
            var H = canvas.height;
            ctx.clearRect(0, 0, W, H);

            // ---- 素材：背景 + 宠物形象（缺失时回退到下方纯代码绘制）----
            var usedImage = this._drawPetImage(ctx, ts, W, H, this._stage);

            var cfg = STAGE_STYLE[this._stage] || STAGE_STYLE[1];
            var r = cfg.r;

            // 上下浮动
            var bob = Math.sin(ts / 520) * 4;

            // 眨眼节奏：随机间隔 2.5s~4.5s，眨眼持续 140ms
            if (ts > this._nextBlink) {
                this._blinkUntil = ts + 140;
                this._nextBlink = ts + 2500 + Math.random() * 2000;
            }
            var blinking = ts < this._blinkUntil;

            var cx = W / 2;
            var baseY = H - 30 - r;
            var cy = baseY + bob;

            // ---- 地面阴影 ----
            ctx.save();
            ctx.fillStyle = 'rgba(180, 150, 110, 0.25)';
            ctx.beginPath();
            ctx.ellipse(cx, H - 26, r * 1.0, r * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // ---- 纯代码身体：仅在无宠物素材图片时绘制（有无素材都不闪、不空白）----
            if (!usedImage) {
                // ---- 小脚 ----
                ctx.fillStyle = cfg.accent;
                this._ellipse(ctx, cx - r * 0.42, cy + r * 0.92, r * 0.24, r * 0.14);
                this._ellipse(ctx, cx + r * 0.42, cy + r * 0.92, r * 0.24, r * 0.14);

                // ---- 耳朵（stage >= 3）----
                if (cfg.ears) {
                    ctx.fillStyle = cfg.body;
                    this._ear(ctx, cx - r * 0.62, cy - r * 0.78, -0.5, r);
                    this._ear(ctx, cx + r * 0.62, cy - r * 0.78, 0.5, r);
                }

                // ---- 小角（stage 4）----
                if (cfg.horn) {
                    ctx.fillStyle = '#ffd97a';
                    ctx.beginPath();
                    ctx.moveTo(cx, cy - r * 1.25);
                    ctx.quadraticCurveTo(cx + r * 0.16, cy - r * 1.05, cx, cy - r * 0.86);
                    ctx.quadraticCurveTo(cx - r * 0.16, cy - r * 1.05, cx, cy - r * 1.25);
                    ctx.closePath();
                    ctx.fill();
                }

                // ---- 身体 ----
                ctx.fillStyle = cfg.body;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, r * 0.96, 0, 0, Math.PI * 2);
                ctx.fill();

                // ---- 肚皮 ----
                ctx.fillStyle = cfg.belly;
                ctx.beginPath();
                ctx.ellipse(cx, cy + r * 0.3, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // ---- 头顶高光 ----
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.beginPath();
                ctx.ellipse(cx - r * 0.35, cy - r * 0.5, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
                ctx.fill();

                // ---- 眼睛 ----
                var eyeY = cy - r * 0.1;
                var eyeX = r * 0.34;
                var eyeR = r * 0.14;
                if (blinking) {
                    ctx.strokeStyle = '#4a3b2e';
                    ctx.lineWidth = Math.max(1.5, r * 0.05);
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(cx - eyeX - eyeR, eyeY);
                    ctx.lineTo(cx - eyeX + eyeR, eyeY);
                    ctx.moveTo(cx + eyeX - eyeR, eyeY);
                    ctx.lineTo(cx + eyeX + eyeR, eyeY);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = '#4a3b2e';
                    this._circle(ctx, cx - eyeX, eyeY, eyeR);
                    this._circle(ctx, cx + eyeX, eyeY, eyeR);
                    // 眼神光
                    ctx.fillStyle = '#ffffff';
                    this._circle(ctx, cx - eyeX + eyeR * 0.35, eyeY - eyeR * 0.35, eyeR * 0.34);
                    this._circle(ctx, cx + eyeX + eyeR * 0.35, eyeY - eyeR * 0.35, eyeR * 0.34);
                }

                // ---- 腮红 ----
                ctx.fillStyle = 'rgba(244, 120, 150, 0.35)';
                this._ellipse(ctx, cx - r * 0.62, cy + r * 0.2, r * 0.2, r * 0.13);
                this._ellipse(ctx, cx + r * 0.62, cy + r * 0.2, r * 0.2, r * 0.13);

                // ---- 嘴巴 ----
                ctx.strokeStyle = '#4a3b2e';
                ctx.lineWidth = Math.max(1.4, r * 0.045);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.arc(cx, cy + r * 0.06, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
                ctx.stroke();
            }

            // ---- 装扮配饰（跟随浮动偏移 bob）----
            this._drawEquip(ctx, cx, cy, r);
        },

        /* ============================================================
         * 素材宠物图（背景 + 立绘 / 逐帧序列，缺失时回退纯代码绘制）
         * ============================================================ */

        /**
         * 尝试用素材图片渲染舞台背景与宠物形象。
         * 素材缺失或仍在加载时返回 false，由 _draw 回退到纯代码绘制。
         * @private
         * @param {CanvasRenderingContext2D} ctx
         * @param {number} ts 时间戳
         * @param {number} W 画布宽
         * @param {number} H 画布高
         * @param {number} stage 当前形态 1~4
         * @returns {boolean} 是否已用图片渲染宠物形象
         */
        _drawPetImage: function (ctx, ts, W, H, stage) {
            // 背景：只要素材可用就铺满舞台（与宠物是否有图无关）
            this._drawPetBackground(ctx, W, H);

            var img = this._pickPetFrame(ts, stage) || this._pickPetSingle(stage);
            if (!img) {
                return false;
            }

            var bob = Math.sin(ts / 520) * 4;
            var h = H * 0.78;
            var ratio = img.height / img.width;
            if (!isFinite(ratio) || ratio <= 0) {
                ratio = 1;
            }
            var w = h / ratio;
            var x = (W - w) / 2;
            var y = (H - 26) - h + bob;
            ctx.drawImage(img, x, y, w, h);
            return true;
        },

        /**
         * 按 cover 方式绘制舞台背景 bg_room（懒加载，缺失时静默跳过）
         * @private
         */
        _drawPetBackground: function (ctx, W, H) {
            var url = null;
            if (window.PetAssets && typeof window.PetAssets.resolve === 'function') {
                url = window.PetAssets.resolve('bg_room');
            }
            if (!url) {
                this._bgKey = '';
                this._bgImg = null;
                return;
            }
            if (this._bgKey !== url) {
                // URL 变化：重新加载
                this._bgKey = url;
                this._bgImg = null;
                var self = this;
                var image = new Image();
                image.onload = function () {
                    self._bgImg = image;
                };
                image.src = url;
                return;
            }
            if (!this._bgImg) {
                return;
            }
            var bw = this._bgImg.width;
            var bh = this._bgImg.height;
            if (!bw || !bh) {
                return;
            }
            var scale = Math.max(W / bw, H / bh);
            var dw = bw * scale;
            var dh = bh * scale;
            ctx.drawImage(this._bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        },

        /**
         * 取当前帧的 idle 序列图片；无序列 / 尚未加载完成时返回 null
         * @private
         */
        _pickPetFrame: function (ts, stage) {
            if (!window.PetAssets || typeof window.PetAssets.list !== 'function') {
                return null;
            }
            var prefix = 'pet_stage' + stage + '_idle_';
            var urls = window.PetAssets.list(prefix);
            if (!urls || urls.length === 0) {
                return null;
            }
            if (this._petFramesKey !== prefix) {
                // 序列变化：重置缓存并预加载各帧
                this._petFramesKey = prefix;
                this._petFrames = [];
                var self = this;
                for (var i = 0; i < urls.length; i++) {
                    (function (idx, url) {
                        var image = new Image();
                        image.onload = function () {
                            self._petFrames[idx] = image;
                        };
                        image.src = url;
                    })(i, urls[i]);
                }
            }
            var idx = Math.floor(ts / 180) % urls.length;
            return this._petFrames[idx] || null;
        },

        /**
         * 取单张立绘 pet_stage{N} 图片（懒加载）；缺失 / 加载中返回 null
         * @private
         */
        _pickPetSingle: function (stage) {
            var url = null;
            if (window.PetAssets && typeof window.PetAssets.resolve === 'function') {
                url = window.PetAssets.resolve('pet_stage' + stage);
            }
            if (!url) {
                this._petKey = '';
                this._petImg = null;
                return null;
            }
            if (this._petKey !== url) {
                // URL 变化：重新加载
                this._petKey = url;
                this._petImg = null;
                var self = this;
                var image = new Image();
                image.onload = function () {
                    self._petImg = image;
                };
                image.src = url;
                return null;
            }
            return this._petImg;
        },

        /* ============================================================
         * 装扮绘制（依据 state.equipped 在宠物头顶绘制配饰）
         * ============================================================ */

        /**
         * 绘制当前穿戴的配饰。
         * 优先使用素材图片（若 PetAssets 提供了 URL），否则使用 Canvas 路径绘制。
         * @private
         * @param {CanvasRenderingContext2D} ctx
         * @param {number} cx 宠物中心 x（已含浮动偏移）
         * @param {number} cy 宠物中心 y（已含浮动偏移）
         * @param {number} r 宠物半径
         */
        _drawEquip: function (ctx, cx, cy, r) {
            var id = this.state && this.state.equipped;
            if (!id) {
                // 未穿戴：清空缓存的素材状态
                this._decoImg = null;
                this._decoKey = '';
                return;
            }

            var url = null;
            if (window.PetAssets && typeof window.PetAssets.resolve === 'function') {
                url = window.PetAssets.resolve(id);
            }

            if (url) {
                this._drawEquipImage(ctx, url, cx, cy, r);
            } else {
                this._drawEquipShape(ctx, id, cx, cy, r);
            }
        },

        /**
         * 懒加载并绘制装扮素材图片
         * @private
         */
        _drawEquipImage: function (ctx, url, cx, cy, r) {
            if (this._decoKey !== url) {
                // URL 变化：重新加载
                this._decoKey = url;
                this._decoImg = null;
                var self = this;
                var img = new Image();
                img.onload = function () {
                    self._decoImg = img;
                };
                img.src = url;
                return; // 加载完成后的下一帧再绘制
            }
            if (!this._decoImg) {
                return;
            }
            var ratio = this._decoImg.height / this._decoImg.width;
            if (!isFinite(ratio) || ratio <= 0) {
                ratio = 1;
            }
            var w = r * 1.5;
            var h = w * ratio;
            ctx.drawImage(this._decoImg, cx - w / 2, cy - r * 1.2 - h * 0.5, w, h);
        },

        /**
         * 使用 Canvas 路径绘制内置配饰
         * @private
         */
        _drawEquipShape: function (ctx, id, cx, cy, r) {
            if (id === 'skin_hat_straw') {
                this._drawStrawHat(ctx, cx, cy - r * 0.84, r);
            } else if (id === 'skin_ribbon') {
                this._drawRibbon(ctx, cx, cy - r * 0.94, r);
            } else if (id === 'skin_hat_crown') {
                this._drawCrown(ctx, cx, cy - r * 0.92, r);
            }
        },

        /**
         * 草帽
         * @private
         */
        _drawStrawHat: function (ctx, x, y, r) {
            ctx.save();
            // 帽檐
            ctx.fillStyle = '#f0d185';
            ctx.beginPath();
            ctx.ellipse(x, y, r * 1.28, r * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
            // 帽顶
            ctx.fillStyle = '#e6c063';
            ctx.beginPath();
            ctx.ellipse(x, y - r * 0.02, r * 0.72, r * 0.5, 0, Math.PI, Math.PI * 2);
            ctx.fill();
            // 帽带
            ctx.fillStyle = '#c9622f';
            ctx.beginPath();
            ctx.ellipse(x, y - r * 0.06, r * 0.7, r * 0.1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        },

        /**
         * 蝴蝶结
         * @private
         */
        _drawRibbon: function (ctx, x, y, r) {
            var s = r * 0.4;
            ctx.save();
            ctx.fillStyle = '#f0749c';
            // 左环
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x - s * 1.5, y - s * 0.95, x - s * 1.55, y);
            ctx.quadraticCurveTo(x - s * 1.5, y + s * 0.95, x, y);
            ctx.closePath();
            ctx.fill();
            // 右环
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + s * 1.5, y - s * 0.95, x + s * 1.55, y);
            ctx.quadraticCurveTo(x + s * 1.5, y + s * 0.95, x, y);
            ctx.closePath();
            ctx.fill();
            // 中心结
            ctx.fillStyle = '#e9558a';
            this._circle(ctx, x, y, s * 0.42);
            ctx.restore();
        },

        /**
         * 王冠
         * @private
         */
        _drawCrown: function (ctx, x, y, r) {
            var w = r * 0.86;
            var h = r * 0.58;
            ctx.save();
            ctx.fillStyle = '#ffd257';
            ctx.beginPath();
            ctx.moveTo(x - w, y);
            ctx.lineTo(x - w, y - h * 0.5);
            ctx.lineTo(x - w * 0.55, y - h);
            ctx.lineTo(x - w * 0.22, y - h * 0.42);
            ctx.lineTo(x, y - h * 1.12);
            ctx.lineTo(x + w * 0.22, y - h * 0.42);
            ctx.lineTo(x + w * 0.55, y - h);
            ctx.lineTo(x + w, y - h * 0.5);
            ctx.lineTo(x + w, y);
            ctx.closePath();
            ctx.fill();
            // 冠底描边
            ctx.strokeStyle = '#e0a63f';
            ctx.lineWidth = Math.max(1, r * 0.03);
            ctx.beginPath();
            ctx.moveTo(x - w, y);
            ctx.lineTo(x + w, y);
            ctx.stroke();
            // 宝石
            ctx.fillStyle = '#e9558a';
            this._circle(ctx, x, y - h * 0.36, r * 0.08);
            ctx.restore();
        },

        /**
         * 画圆（内部工具）
         * @private
         */
        _circle: function (ctx, x, y, radius) {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        },

        /**
         * 画椭圆（内部工具）
         * @private
         */
        _ellipse: function (ctx, x, y, rx, ry) {
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
        },

        /**
         * 画一只耳朵（内部工具）
         * @private
         */
        _ear: function (ctx, x, y, tilt, r) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(tilt);
            ctx.beginPath();
            ctx.moveTo(0, r * 0.32);
            ctx.quadraticCurveTo(-r * 0.3, -r * 0.42, 0, -r * 0.5);
            ctx.quadraticCurveTo(r * 0.3, -r * 0.42, 0, r * 0.32);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        },

        /* ============================================================
         * 事件绑定
         * ============================================================ */

        /**
         * 绑定页面交互事件
         * @private
         */
        _bindEvents: function () {
            var self = this;

            // 四个动作按钮：喂养 / 抚摸 / 陪玩 / 睡觉
            var actionBtns = document.querySelectorAll('#pet-actions [data-action]');
            for (var i = 0; i < actionBtns.length; i++) {
                (function (btn) {
                    btn.addEventListener('click', function () {
                        var type = btn.getAttribute('data-action');
                        if (type) {
                            self.action(type);
                        }
                    });
                })(actionBtns[i]);
            }

            // 商店
            var shopBtn = document.getElementById('btn-shop');
            if (shopBtn) {
                shopBtn.addEventListener('click', function () {
                    if (window.PetShop && typeof window.PetShop.open === 'function') {
                        window.PetShop.open();
                    } else {
                        self.toast('功能尚未加载');
                    }
                });
            }

            // 图鉴
            var codexBtn = document.getElementById('btn-codex');
            if (codexBtn) {
                codexBtn.addEventListener('click', function () {
                    if (window.PetShop && typeof window.PetShop.open === 'function') {
                        window.PetShop.open('codex');
                    } else {
                        self.toast('功能尚未加载');
                    }
                });
            }

            // 小游戏
            var miniBtn = document.getElementById('btn-minigame');
            if (miniBtn) {
                miniBtn.addEventListener('click', function () {
                    if (window.PetMinigame && typeof window.PetMinigame.open === 'function') {
                        window.PetMinigame.open();
                    } else {
                        self.toast('功能尚未加载');
                    }
                });
            }

            // 隐藏到托盘
            var hideBtn = document.getElementById('btn-hide');
            if (hideBtn) {
                hideBtn.addEventListener('click', function () {
                    self.bridge.hide();
                });
            }

            // 静音（首版占位）
            var muteBtn = document.getElementById('btn-mute');
            if (muteBtn) {
                muteBtn.addEventListener('click', function () {
                    var pressed = muteBtn.getAttribute('aria-pressed') === 'true';
                    muteBtn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
                    self.toast('首版暂无声效');
                });
            }
        },

        /**
         * 若素材层可用则填充 data-asset-key 图标位（缺失时保持 CSS 占位）
         * @private
         */
        _applyAssets: function () {
            if (!window.PetAssets || typeof window.PetAssets.resolve !== 'function') {
                return;
            }
            var nodes = document.querySelectorAll('[data-asset-key]');
            for (var i = 0; i < nodes.length; i++) {
                var key = nodes[i].getAttribute('data-asset-key');
                if (!key) {
                    continue;
                }
                var url = window.PetAssets.resolve(key);
                if (url) {
                    nodes[i].style.backgroundImage = 'url("' + url + '")';
                }
            }
        },

        /* ============================================================
         * 原生窗口桥接
         * ============================================================ */

        /**
         * PebView 桥接安全包装。
         * 原生侧只在返回值非空时才回传，因此桥接函数为全局
         * window.petHide / petQuit / petNotify / petConfirm，均返回字符串。
         * 浏览器预览模式下这些函数不存在，回退到 toast / confirm。
         */
        bridge: {
            /**
             * 隐藏窗口到托盘
             */
            hide: function () {
                if (typeof window.petHide === 'function') {
                    window.petHide();
                } else {
                    window.PetGame.toast('浏览器预览模式：无法隐藏窗口');
                }
            },

            /**
             * 退出程序
             */
            quit: function () {
                if (typeof window.petQuit === 'function') {
                    window.petQuit();
                } else {
                    window.PetGame.toast('浏览器预览模式：无法退出');
                }
            },

            /**
             * 系统通知
             * @param {string} title 标题
             * @param {string} msg 内容
             */
            notify: function (title, msg) {
                if (typeof window.petNotify === 'function') {
                    window.petNotify(title, msg);
                } else {
                    window.PetGame.toast(title + '：' + msg);
                }
            },

            /**
             * 确认框
             * @param {string} msg 提示内容
             * @returns {Promise<'yes'|'no'>}
             */
            confirm: function (msg) {
                if (typeof window.petConfirm === 'function') {
                    return Promise.resolve(window.petConfirm(msg)).then(function (r) {
                        return r === 'yes' ? 'yes' : 'no';
                    });
                }
                return Promise.resolve(window.confirm(msg) ? 'yes' : 'no');
            }
        }
    };

    /* ============================================================
     * 初始化
     * ============================================================ */
    function init() {
        if (window.PetWasm && typeof window.PetWasm.init === 'function') {
            // wasm 层由其它子任务提供，存在即初始化，缺失时静默跳过
            try {
                window.PetWasm.init();
            } catch (e) {
                // 忽略 wasm 初始化异常，不影响页面骨架
            }
        }
        window.PetGame._bindEvents();
        window.PetGame._applyAssets();
        // 素材清单加载完成后补填一次图标位（清单为空或失败时静默跳过）
        if (window.PetAssets && typeof window.PetAssets.ready === 'function') {
            window.PetAssets.ready().then(function () {
                try {
                    if (window.PetGame && typeof window.PetGame._applyAssets === 'function') {
                        window.PetGame._applyAssets();
                    }
                } catch (e) {
                    // 忽略补填异常
                }
            });
        }
        // 桌面模式：先按窗口尺寸设置 Canvas，再启动绘制循环
        window.PetGame._initDesktop();
        window.PetGame._startLoop();
        window.PetGame.refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();