/**
 * bnyPet 桌宠 - 「接食物」小游戏模块
 * ============================================================
 * 对外暴露全局 window.PetMinigame：
 *   PetMinigame.open()   打开小游戏弹层
 *   PetMinigame.close()  关闭弹层并清理全部资源（定时器 / 动画帧 / 监听器）
 *
 * 依赖：
 *   window.PetGame  公共契约（api / state / render / emit / toast）
 *   window.PetWasm  确定性随机数（ready / rng / isReady），可选；
 *                   缺失或失败时仍可继续游玩。
 *
 * 随机数规则：
 *   掉落位置与食物种类等随机数一律通过 PetWasm.rng(seed, max) 派生；
 *   自持 seed，每次取数后推进 seed，避免同一 seed 反复得到相同值。
 *   代码中不使用 Math.random()。
 * ============================================================
 */
(function () {
    'use strict';

    // 一局时长（秒）
    var TOTAL_TIME = 30;
    // 画布逻辑尺寸（CSS 侧会限制最大宽度，适配 400 宽窗口）
    var CANVAS_W = 320;
    var CANVAS_H = 300;
    // 盘子尺寸
    var BASKET_W = 64;
    var BASKET_H = 20;
    // 盘子顶面 y 坐标（距画布底部的摆放线）
    var BASKET_TOP = CANVAS_H - 30;
    // 键盘移动速度（像素/秒）
    var KEY_SPEED = 300;
    // 食物半径与可选 emoji
    var FOOD_R = 11;
    var FOODS = ['🍎', '🍖', '🍩', '🍓', '🥕', '🍪'];
    // 生成食物的横向轨道数
    var LANE_COUNT = 8;

    window.PetMinigame = {
        // ---------- 内部字段 ----------
        _root: null,          // 挂载点 #pet-modal-root
        _canvas: null,        // 游戏画布
        _ctx: null,           // 画布上下文
        _raf: 0,              // requestAnimationFrame 句柄
        _timer: null,         // 倒计时 setInterval 句柄
        _running: false,      // 是否正在游戏中
        _starting: false,     // 是否正在等待 wasm 就绪后开始（防重复开始）
        _score: 0,            // 当前得分
        _remaining: TOTAL_TIME, // 剩余秒数
        _foods: [],           // 掉落中的食物列表
        _basketX: CANVAS_W / 2, // 盘子中心 x（画布坐标）
        _seed: 1,             // 自持随机种子
        _lastTs: 0,           // 上一帧时间戳
        _spawnAcc: 0,         // 生成食物的时间累计器
        _keys: { left: false, right: false }, // 键盘方向状态
        _handlers: [],        // 已绑定监听器，便于统一移除
        _wasmPromise: null,   // PetWasm.ready() 的缓存 Promise
        _claimed: false,      // 本局是否已领取奖励
        _refs: null,          // 关键 DOM 引用

        /* ============================================================
         * 对外接口
         * ============================================================ */

        /**
         * 打开小游戏弹层
         */
        open: function () {
            var root = document.getElementById('pet-modal-root');
            if (!root) {
                return;
            }
            // 若已打开，先清理旧状态，避免监听器堆积
            this._cleanup();
            this._root = root;
            this._render();
            // 提前预热 wasm（不阻塞界面渲染）
            this._ensureWasm();
        },

        /**
         * 关闭弹层：清理全部资源并清空挂载点
         */
        close: function () {
            this._cleanup();
            var root = document.getElementById('pet-modal-root');
            if (root) {
                root.innerHTML = '';
            }
            this._root = null;
            this._refs = null;
            this._canvas = null;
            this._ctx = null;
        },

        /* ============================================================
         * 渲染与事件绑定
         * ============================================================ */

        /**
         * 渲染弹层骨架，并缓存 DOM 引用
         * @private
         */
        _render: function () {
            var root = this._root;
            if (!root) {
                return;
            }

            var html = '';
            html += '<div class="modal-mask" data-close="1">';
            html += '<div class="modal mini-modal">';
            html += '<div class="modal-title">接食物 小游戏</div>';
            html += '<button type="button" class="modal-close" data-close="1" aria-label="关闭">×</button>';
            html += '<div class="modal-body">';

            // 顶部信息：倒计时 + 得分
            html += '<div class="mini-hud">'
                + '<span class="mini-hud-item">⏱ 剩余 <b class="mini-time">' + TOTAL_TIME + '</b> 秒</span>'
                + '<span class="mini-hud-item">⭐ 得分 <b class="mini-score">0</b></span>'
                + '</div>';

            // 画布
            html += '<div class="mini-stage">'
                + '<canvas id="mini-canvas" width="' + CANVAS_W + '" height="' + CANVAS_H + '"></canvas>'
                + '</div>';

            // 结算区（默认隐藏）
            html += '<div class="mini-result hidden">'
                + '<div class="mini-result-text">本局得分 <b class="mini-result-score">0</b></div>'
                + '<button type="button" class="btn primary mini-reward">领取奖励</button>'
                + '</div>';

            // 操作提示 + 开始按钮
            html += '<div class="mini-tip">← → 键移动，或拖动鼠标／手指让盘子接住掉落的食物</div>';
            html += '<div class="mini-actions">'
                + '<button type="button" class="btn primary mini-start">开始</button>'
                + '</div>';

            html += '</div></div></div>';

            root.innerHTML = html;

            this._refs = {
                canvas: root.querySelector('#mini-canvas'),
                hud: root.querySelector('.mini-hud'),
                time: root.querySelector('.mini-time'),
                score: root.querySelector('.mini-score'),
                tip: root.querySelector('.mini-tip'),
                start: root.querySelector('.mini-start'),
                actions: root.querySelector('.mini-actions'),
                result: root.querySelector('.mini-result'),
                resultScore: root.querySelector('.mini-result-score'),
                reward: root.querySelector('.mini-reward')
            };
            this._canvas = this._refs.canvas;
            this._ctx = this._canvas && this._canvas.getContext ? this._canvas.getContext('2d') : null;

            this._bind();
            // 画一帧静态画面（未开始时也能看到背景与盘子）
            this._draw();
        },

        /**
         * 绑定弹层内的小游戏事件
         * @private
         */
        _bind: function () {
            var self = this;
            var root = this._root;
            var refs = this._refs;
            if (!refs) {
                return;
            }

            // 遮罩 / 关闭按钮：事件委托。
            // 只认点击目标本身带 data-close="1"（遮罩空白处或关闭按钮），
            // 不做向上回溯，避免点击弹层内部（开始 / 领取奖励 / 画布）时误关闭。
            this._on(root, 'click', function (e) {
                var el = e.target;
                if (el && el.getAttribute && el.getAttribute('data-close') === '1') {
                    self.close();
                }
            });

            // 开始 / 领取奖励
            this._on(refs.start, 'click', function () {
                self._start();
            });
            this._on(refs.reward, 'click', function () {
                self._claim();
            });

            // 键盘 ← →
            this._on(document, 'keydown', function (e) {
                self._onKey(e, true);
            });
            this._on(document, 'keyup', function (e) {
                self._onKey(e, false);
            });

            // 鼠标移动跟随
            this._on(this._canvas, 'mousemove', function (e) {
                self._moveBasketToClientX(e.clientX);
            });

            // 触摸拖动跟随（禁止页面滚动）
            var touchHandler = function (e) {
                if (e.touches && e.touches.length) {
                    e.preventDefault();
                    self._moveBasketToClientX(e.touches[0].clientX);
                }
            };
            this._on(this._canvas, 'touchstart', touchHandler, { passive: false });
            this._on(this._canvas, 'touchmove', touchHandler, { passive: false });
        },

        /**
         * 注册监听器并登记，便于统一移除
         * @private
         */
        _on: function (target, type, fn, opts) {
            if (!target || !target.addEventListener) {
                return;
            }
            target.addEventListener(type, fn, opts);
            this._handlers.push({ target: target, type: type, fn: fn, opts: opts });
        },

        /**
         * 移除全部已登记监听器
         * @private
         */
        _unbind: function () {
            for (var i = 0; i < this._handlers.length; i++) {
                var h = this._handlers[i];
                try {
                    h.target.removeEventListener(h.type, h.fn, h.opts);
                } catch (e) {
                    // 忽略个别移除异常
                }
            }
            this._handlers = [];
        },

        /* ============================================================
         * 随机数（不依赖 Math.random）
         * ============================================================ */

        /**
         * 确保 wasm 就绪（失败也不阻断游玩）
         * @private
         * @returns {Promise<void>}
         */
        _ensureWasm: function () {
            if (this._wasmPromise) {
                return this._wasmPromise;
            }
            this._wasmPromise = Promise.resolve().then(function () {
                if (window.PetWasm && typeof window.PetWasm.ready === 'function') {
                    return window.PetWasm.ready();
                }
            }).catch(function () {
                // wasm 不可用：继续使用下面的确定性兜底随机数
            });
            return this._wasmPromise;
        },

        /**
         * 取一个 0..max-1 的随机整数。
         * 优先使用 PetWasm.rng(seed, 1000000)，并推进自持 seed；
         * window.PetWasm 完全缺失时使用确定性 LCG 兜底，绝不使用 Math.random()。
         * @private
         * @param {number} max 上界（不含）
         * @returns {number}
         */
        _rand: function (max) {
            if (!(max > 0)) {
                return 0;
            }
            var wasm = window.PetWasm;
            if (wasm && typeof wasm.rng === 'function') {
                var s = wasm.rng(this._seed, 1000000);
                this._seed = s + 1;
                return ((s % max) + max) % max;
            }
            // 兜底：线性同余，同样由自持 seed 派生
            this._seed = (this._seed * 1103515245 + 12345) % 2147483648;
            return ((this._seed % max) + max) % max;
        },

        /* ============================================================
         * 回合流程
         * ============================================================ */

        /**
         * 点击「开始」：先等 wasm 就绪，再开始一局
         * @private
         */
        _start: function () {
            if (this._running || this._starting) {
                return;
            }
            this._starting = true;
            var self = this;
            this._ensureWasm().then(function () {
                self._beginRound();
            });
        },

        /**
         * 初始化并开始一局
         * @private
         */
        _beginRound: function () {
            var refs = this._refs;
            if (!refs || !this._ctx) {
                return;
            }
            this._starting = false;

            this._score = 0;
            this._remaining = TOTAL_TIME;
            this._foods = [];
            this._basketX = CANVAS_W / 2;
            this._spawnAcc = 0;
            this._lastTs = 0;
            this._claimed = false;
            this._keys.left = false;
            this._keys.right = false;
            // 每局由时间派生新种子（不使用 Math.random）
            this._seed = (Date.now() % 1000000) + 1;

            this._running = true;

            // 界面：隐藏开始与结算，显示信息栏与提示
            refs.start.classList.add('hidden');
            refs.result.classList.add('hidden');
            refs.tip.classList.remove('hidden');
            refs.hud.classList.remove('hidden');
            this._updateHud();

            this._startTimer();
            this._startLoop();
        },

        /**
         * 启动倒计时（每秒递减）
         * @private
         */
        _startTimer: function () {
            var self = this;
            this._stopTimer();
            this._timer = setInterval(function () {
                if (!self._running) {
                    return;
                }
                self._remaining -= 1;
                if (self._remaining < 0) {
                    self._remaining = 0;
                }
                self._updateHud();
                if (self._remaining <= 0) {
                    self._endRound();
                }
            }, 1000);
        },

        /**
         * 结束本局：停止循环与定时器，展示结算
         * @private
         */
        _endRound: function () {
            if (!this._running) {
                return;
            }
            this._running = false;
            this._stopLoop();
            this._stopTimer();
            this._keys.left = false;
            this._keys.right = false;

            // 最后一帧定妆
            this._draw();

            var refs = this._refs;
            if (refs) {
                refs.result.classList.remove('hidden');
                refs.start.classList.add('hidden');
                refs.tip.classList.add('hidden');
                if (refs.resultScore) {
                    refs.resultScore.textContent = String(this._score);
                }
                if (refs.reward) {
                    refs.reward.disabled = this._claimed;
                }
            }
        },

        /**
         * 领取奖励：提交分数，成功则同步状态并关闭弹层
         * @private
         */
        _claim: function () {
            if (this._claimed) {
                return;
            }
            if (!window.PetGame || typeof window.PetGame.api !== 'function') {
                return;
            }

            var self = this;
            var game = window.PetGame;
            var refs = this._refs;
            if (refs && refs.reward) {
                refs.reward.disabled = true;
            }

            game.api('/pet/minigame', { score: this._score }).then(function (res) {
                if (!res) {
                    // 后端拒绝：保持弹层打开，允许重试
                    if (self._refs && self._refs.reward) {
                        self._refs.reward.disabled = false;
                    }
                    return;
                }

                self._claimed = true;
                var data = res.data || {};

                if (data.state) {
                    game.state = data.state;
                    game.render(game.state);
                    game.emit('state', game.state);
                }
                if (data.events && data.events.length) {
                    for (var i = 0; i < data.events.length; i++) {
                        game.toast(data.events[i]);
                    }
                }

                self.close();
            });
        },

        /* ============================================================
         * 游戏循环
         * ============================================================ */

        /**
         * 启动 requestAnimationFrame 循环
         * @private
         */
        _startLoop: function () {
            var self = this;
            this._lastTs = 0;
            this._raf = requestAnimationFrame(function (ts) {
                self._loop(ts);
            });
        },

        /**
         * 停止动画帧循环
         * @private
         */
        _stopLoop: function () {
            if (this._raf) {
                cancelAnimationFrame(this._raf);
                this._raf = 0;
            }
            this._lastTs = 0;
        },

        /**
         * 停止倒计时
         * @private
         */
        _stopTimer: function () {
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
        },

        /**
         * 游戏主循环（deltaTime 驱动，兼容不同刷新率）
         * @private
         * @param {number} ts 高精度时间戳
         */
        _loop: function (ts) {
            if (!this._running) {
                return;
            }
            var dt = this._lastTs ? (ts - this._lastTs) / 1000 : 0;
            this._lastTs = ts;
            if (!(dt > 0)) {
                dt = 0;
            }
            if (dt > 0.1) {
                dt = 0.1; // 防止切后台后大跳帧
            }

            this._update(dt);
            this._draw();

            var self = this;
            this._raf = requestAnimationFrame(function (t) {
                self._loop(t);
            });
        },

        /**
         * 难度系数：随剩余时间由 0 增长到 1
         * @private
         * @returns {number}
         */
        _difficulty: function () {
            var d = (TOTAL_TIME - this._remaining) / TOTAL_TIME;
            if (!(d > 0)) {
                return 0;
            }
            return d > 1 ? 1 : d;
        },

        /**
         * 推进一帧逻辑
         * @private
         * @param {number} dt 帧间隔（秒）
         */
        _update: function (dt) {
            // 键盘左右移动
            var dir = 0;
            if (this._keys.left) {
                dir -= 1;
            }
            if (this._keys.right) {
                dir += 1;
            }
            if (dir !== 0) {
                this._setBasketX(this._basketX + dir * KEY_SPEED * dt);
            }

            var diff = this._difficulty();

            // 生成食物：间隔随时间缩短（0.85s → 0.5s）
            var interval = 0.85 - 0.35 * diff;
            this._spawnAcc += dt;
            while (this._spawnAcc >= interval) {
                this._spawnAcc -= interval;
                this._spawnFood();
            }

            // 下落速度随时间提升（110 → 240 像素/秒）
            var speed = 110 + 130 * diff;
            for (var i = this._foods.length - 1; i >= 0; i--) {
                var f = this._foods[i];
                f.y += speed * dt;

                // 命中判定：食物进入盘口横向范围
                if (f.y + FOOD_R >= BASKET_TOP && f.y <= BASKET_TOP + BASKET_H) {
                    if (Math.abs(f.x - this._basketX) <= BASKET_W / 2 + FOOD_R * 0.4) {
                        this._foods.splice(i, 1);
                        this._score += 1;
                        this._updateHud();
                        continue;
                    }
                }

                // 落出底部：消失（不扣分）
                if (f.y - FOOD_R > CANVAS_H) {
                    this._foods.splice(i, 1);
                }
            }
        },

        /**
         * 生成一个食物：位置与种类均由确定性随机数派生
         * @private
         */
        _spawnFood: function () {
            var s = this._rand(1000000);
            var lane = s % LANE_COUNT; // 由 wasm 给出的随机数派生
            var margin = FOOD_R + 6;
            var usable = CANVAS_W - margin * 2;
            var x = margin + (lane + 0.5) * (usable / LANE_COUNT);
            var emoji = FOODS[this._rand(FOODS.length)];

            this._foods.push({ x: x, y: -FOOD_R, emoji: emoji });
        },

        /**
         * 设置盘子中心 x（限制在画布内）
         * @private
         * @param {number} x
         */
        _setBasketX: function (x) {
            var half = BASKET_W / 2;
            if (x < half) {
                x = half;
            }
            if (x > CANVAS_W - half) {
                x = CANVAS_W - half;
            }
            this._basketX = x;
        },

        /**
         * 依据客户端 x 坐标换算到画布坐标并移动盘子
         * @private
         * @param {number} clientX
         */
        _moveBasketToClientX: function (clientX) {
            var canvas = this._canvas;
            if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
                return;
            }
            var rect = canvas.getBoundingClientRect();
            if (!rect.width) {
                return;
            }
            var x = (clientX - rect.left) * (canvas.width / rect.width);
            this._setBasketX(x);
        },

        /* ============================================================
         * 键盘 / 触摸输入
         * ============================================================ */

        /**
         * 键盘按下 / 抬起
         * @private
         * @param {KeyboardEvent} e
         * @param {boolean} down
         */
        _onKey: function (e, down) {
            var key = e.key;
            var code = e.keyCode;
            if (key === 'ArrowLeft' || key === 'Left' || code === 37) {
                this._keys.left = down;
                e.preventDefault();
            } else if (key === 'ArrowRight' || key === 'Right' || code === 39) {
                this._keys.right = down;
                e.preventDefault();
            }
        },

        /* ============================================================
         * 绘制
         * ============================================================ */

        /**
         * 更新信息栏文本
         * @private
         */
        _updateHud: function () {
            var refs = this._refs;
            if (!refs) {
                return;
            }
            if (refs.time) {
                refs.time.textContent = String(this._remaining);
            }
            if (refs.score) {
                refs.score.textContent = String(this._score);
            }
        },

        /**
         * 绘制一帧
         * @private
         */
        _draw: function () {
            var ctx = this._ctx;
            if (!ctx) {
                return;
            }

            ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

            // 背景：淡淡的天空 → 桌面渐变
            var g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
            g.addColorStop(0, '#fffaf0');
            g.addColorStop(0.7, '#fdf1dc');
            g.addColorStop(1, '#f6e6c8');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            // 桌面线
            ctx.strokeStyle = 'rgba(200, 170, 130, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, BASKET_TOP + BASKET_H + 2);
            ctx.lineTo(CANVAS_W, BASKET_TOP + BASKET_H + 2);
            ctx.stroke();

            // 食物（emoji 文字绘制）
            ctx.font = '20px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (var i = 0; i < this._foods.length; i++) {
                var f = this._foods[i];
                ctx.fillText(f.emoji, f.x, f.y);
            }

            // 盘子
            this._drawBasket(ctx, this._basketX, BASKET_TOP);
        },

        /**
         * 绘制盘子
         * @private
         * @param {CanvasRenderingContext2D} ctx
         * @param {number} x 中心 x
         * @param {number} y 盘口 y
         */
        _drawBasket: function (ctx, x, y) {
            var w = BASKET_W;
            var h = BASKET_H;

            ctx.save();

            // 盘底阴影
            ctx.fillStyle = 'rgba(180, 150, 110, 0.25)';
            ctx.beginPath();
            ctx.ellipse(x, y + h + 6, w / 2 + 6, 5, 0, 0, Math.PI * 2);
            ctx.fill();

            // 盘身（上宽下窄的小篮子）
            ctx.fillStyle = '#f0c877';
            ctx.beginPath();
            ctx.moveTo(x - w / 2, y);
            ctx.lineTo(x + w / 2, y);
            ctx.lineTo(x + w / 2 - 8, y + h);
            ctx.lineTo(x - w / 2 + 8, y + h);
            ctx.closePath();
            ctx.fill();

            // 盘口
            ctx.fillStyle = '#e0a63f';
            ctx.beginPath();
            ctx.ellipse(x, y, w / 2, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fbe3ad';
            ctx.beginPath();
            ctx.ellipse(x, y, w / 2 - 4, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        },

        /* ============================================================
         * 清理
         * ============================================================ */

        /**
         * 清理全部运行时资源：
         * 动画帧、倒计时定时器、键盘 / 鼠标 / 触摸监听器、食物与按键状态。
         * 游戏进行中关闭同样安全。
         * @private
         */
        _cleanup: function () {
            this._running = false;
            this._starting = false;
            this._stopLoop();
            this._stopTimer();
            this._unbind();
            this._foods = [];
            this._keys.left = false;
            this._keys.right = false;
            this._spawnAcc = 0;
        }
    };
})();