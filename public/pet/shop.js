/**
 * bnyPet 桌宠 - 商店 / 图鉴模块
 * ============================================================
 * 对外暴露全局 window.PetShop：
 *   PetShop.open(tab)   tab = 'shop'(默认) | 'codex'，打开弹层
 *   PetShop.close()     关闭并清空弹层
 *
 * 依赖 window.PetGame 的公共契约（api / state / render / emit / toast）。
 * 弹层挂载在 #pet-modal-root，复用 pet.css 的
 * .modal-mask / .modal / .modal-title / .modal-body / .modal-close /
 * .grid / .item-card / .btn 等公共 class。
 * ============================================================
 */
(function () {
    'use strict';

    // 物品 emoji 占位（无素材时使用）
    var EMOJI = {
        food_kibble: '🍚',
        food_can: '🥫',
        food_cake: '🍰',
        toy_ball: '⚽',
        toy_bell: '🔔',
        toy_robot: '🤖',
        skin_hat_straw: '👒',
        skin_ribbon: '🎀',
        skin_hat_crown: '👑'
    };

    window.PetShop = {
        // ---------- 内部字段 ----------
        _tab: 'shop',   // 当前标签页：shop | codex
        _items: null,   // /pet/items 返回的物品数据

        /**
         * 打开弹层
         * @param {string} [tab] 'shop'（默认）或 'codex'
         * @returns {Promise<void>}
         */
        open: function (tab) {
            this._tab = tab === 'codex' ? 'codex' : 'shop';

            var root = document.getElementById('pet-modal-root');
            if (!root) {
                return Promise.resolve();
            }

            var self = this;
            // 先拉取最新物品数据（含 bag / owned / equipped / coins）
            return window.PetGame.api('/pet/items').then(function (res) {
                if (!res) {
                    return;
                }
                self._items = res.data || {};
                self._render();
            });
        },

        /**
         * 关闭弹层并清空挂载点
         */
        close: function () {
            var root = document.getElementById('pet-modal-root');
            if (root) {
                root.innerHTML = '';
            }
        },

        /* ============================================================
         * 渲染
         * ============================================================ */

        /**
         * 生成单个物品图标（有素材用 img，否则用 emoji）
         * @private
         * @param {string} id 物品 id
         * @returns {string} HTML
         */
        _icon: function (id) {
            if (window.PetAssets && typeof window.PetAssets.resolve === 'function') {
                var url = window.PetAssets.resolve(id);
                if (url) {
                    return '<img class="item-icon" src="' + url + '" alt="">';
                }
            }
            var emoji = EMOJI[id] || '❓';
            return '<span class="item-icon emoji">' + emoji + '</span>';
        },

        /**
         * 生成一张物品卡片
         * @private
         * @param {Object} item 物品定义 {id,name,price,...}
         * @param {string} type food | toy | skin
         * @param {Object} ctx  {bag, owned, equipped, tab}
         * @returns {string} HTML
         */
        _card: function (item, type, ctx) {
            var id = item.id;
            var isFood = type === 'food';
            var isToy = type === 'toy';
            var isSkin = type === 'skin';
            var isOwned = isToy || isSkin ? !!ctx.owned[id] : false;
            var isEquipped = isSkin && ctx.equipped === id;

            var cls = 'item-card shop-card';
            // 图鉴中未拥有的玩具 / 装扮置灰
            if (ctx.tab === 'codex' && (isToy || isSkin) && !isOwned) {
                cls += ' disabled';
            }
            if (isOwned) {
                cls += ' owned';
            }
            if (isEquipped) {
                cls += ' equipped';
            }

            var html = '<div class="' + cls + '">';
            html += this._icon(id);
            html += '<div class="item-name">' + item.name + '</div>';

            // 价格（图鉴中也展示，便于对比）
            html += '<div class="item-price">🪙 ' + item.price + '</div>';

            // 图鉴：食物显示库存数量
            if (isFood && ctx.tab === 'codex') {
                html += '<div class="item-stock">库存 ' + (Number(ctx.bag[id]) || 0) + '</div>';
            }

            // 商店：购买按钮（永久物品已拥有则显示为禁用）
            if (ctx.tab === 'shop') {
                if (isOwned) {
                    html += '<button type="button" class="btn small" disabled>已拥有</button>';
                } else {
                    html += '<button type="button" class="btn primary small" data-buy="' + id + '">购买</button>';
                }
            }

            // 装扮：已拥有时提供穿戴 / 卸下
            if (isSkin && ctx.owned[id]) {
                if (isEquipped) {
                    html += '<button type="button" class="btn small" data-equip="">卸下</button>';
                } else {
                    html += '<button type="button" class="btn small" data-equip="' + id + '">穿戴</button>';
                }
            }

            html += '</div>';
            return html;
        },

        /**
         * 生成一个分区（标题 + 网格）
         * @private
         * @param {string} title 分区标题
         * @param {Array} list 物品列表
         * @param {string} type food | toy | skin
         * @param {Object} ctx 上下文
         * @returns {string} HTML
         */
        _section: function (title, list, type, ctx) {
            if (!list || !list.length) {
                return '';
            }
            var cards = '';
            for (var i = 0; i < list.length; i++) {
                cards += this._card(list[i], type, ctx);
            }
            return '<div class="shop-section-title">' + title + '</div>'
                + '<div class="grid">' + cards + '</div>';
        },

        /**
         * 渲染整个弹层内容
         * @private
         */
        _render: function () {
            var root = document.getElementById('pet-modal-root');
            if (!root) {
                return;
            }

            var items = this._items || {};
            var tab = this._tab || 'shop';
            var coins = Number(items.coins);
            if (!isFinite(coins)) {
                coins = 0;
            }

            var ctx = {
                bag: items.bag || {},
                owned: items.owned || {},
                equipped: items.equipped || '',
                tab: tab
            };

            var html = '';
            html += '<div class="modal-mask" data-close="1">';
            html += '<div class="modal shop-modal">';
            html += '<div class="modal-title">'
                + '<span>' + (tab === 'codex' ? '图鉴' : '商店') + '</span>'
                + '<span class="shop-coins">🪙 ' + coins + '</span>'
                + '</div>';
            html += '<button type="button" class="modal-close" data-close="1" aria-label="关闭">×</button>';
            html += '<div class="modal-body">';
            html += '<div class="shop-tabs">'
                + '<button type="button" class="shop-tab' + (tab === 'shop' ? ' active' : '') + '" data-tab="shop">商店</button>'
                + '<button type="button" class="shop-tab' + (tab === 'codex' ? ' active' : '') + '" data-tab="codex">图鉴</button>'
                + '</div>';
            html += this._section('食物', items.foods, 'food', ctx);
            html += this._section('玩具', items.toys, 'toy', ctx);
            html += this._section('装扮', items.skins, 'skin', ctx);
            html += '</div></div></div>';

            root.innerHTML = html;
            this._bind(root);
        },

        /**
         * 绑定弹层内的点击事件（事件委托）
         * @private
         * @param {HTMLElement} root 挂载点
         */
        _bind: function (root) {
            var self = this;
            root.addEventListener('click', function (e) {
                var el = e.target;
                // 从点击目标向上查找带业务属性的元素
                while (el && el !== root) {
                    if (el.getAttribute) {
                        if (el.getAttribute('data-close') === '1') {
                            self.close();
                            return;
                        }
                        var tab = el.getAttribute('data-tab');
                        if (tab) {
                            self._tab = tab;
                            self._render();
                            return;
                        }
                        var buyId = el.getAttribute('data-buy');
                        if (buyId) {
                            self._buy(buyId);
                            return;
                        }
                        var equipId = el.getAttribute('data-equip');
                        if (equipId !== null) {
                            self._equip(equipId);
                            return;
                        }
                    }
                    el = el.parentNode;
                }
            });
        },

        /* ============================================================
         * 交互动作
         * ============================================================ */

        /**
         * 购买物品
         * @private
         * @param {string} id 物品 id
         */
        _buy: function (id) {
            var self = this;
            window.PetGame.api('/pet/shop', { action: 'buy', item: id }).then(function (res) {
                if (!res) {
                    return;
                }
                self._apply(res.data);
                window.PetGame.toast('购买成功');
            });
        },

        /**
         * 穿戴 / 卸下装扮
         * @private
         * @param {string} id 装扮 id；'' 表示卸下
         */
        _equip: function (id) {
            var self = this;
            window.PetGame.api('/pet/shop', { action: 'equip', item: id }).then(function (res) {
                if (!res) {
                    return;
                }
                self._apply(res.data);
                window.PetGame.toast(id ? '穿戴成功' : '已卸下装扮');
            });
        },

        /**
         * 应用接口返回的数据：同步全局状态并重渲染
         * @private
         * @param {Object} data 形如 { state, items }
         */
        _apply: function (data) {
            if (!data) {
                return;
            }
            if (data.items) {
                this._items = data.items;
            }
            if (data.state && window.PetGame) {
                window.PetGame.state = data.state;
                window.PetGame.render(window.PetGame.state);
                window.PetGame.emit('state', window.PetGame.state);
            }
            this._render();
        }
    };
})();