/**
 * bnyPet 素材清单加载层
 * ============================================================
 * 命名约定：
 *   1. 素材统一放在 public/pet/assets/ 下（可再按子目录分类）；
 *   2. 格式为透明背景 PNG（音频除外），文件名英文小写 + 下划线；
 *   3. key = 文件名去掉扩展名，例如：
 *        public/pet/assets/ui/ui_coin.png          -> key "ui_coin"
 *        public/pet/assets/pet/pet_stage2_idle_03.png -> key "pet_stage2_idle_03"
 *      同名文件冲突时以路径更浅者（更靠近 assets 根目录）优先；
 *   4. 素材「缺失即回退占位」：resolve() 返回 null、list() 返回 []，
 *      调用方自动回退到 Canvas 代码绘制 / emoji 占位，缺失不会报错。
 *
 * 数据来源：GET /pet/asset-list -> { code:0, msg:'', data:{ files:{ key:url } } }
 * 对外暴露 window.PetAssets：resolve / list / ready / init
 * ============================================================
 */
(function () {
    'use strict';

    var LIST_URL = '/pet/asset-list';

    var _files = {};      // key -> URL
    var _loading = null;  // 清单加载 Promise（只会创建一次，永不 reject）

    /**
     * 触发一次清单加载：成功写入 _files，任何异常静默吞掉。
     * 多次调用复用同一个 Promise。
     * @returns {Promise<void>}
     */
    function load() {
        if (_loading) {
            return _loading;
        }
        if (typeof fetch !== 'function') {
            _loading = Promise.resolve();
            return _loading;
        }
        _loading = fetch(LIST_URL, { method: 'GET' })
            .then(function (resp) {
                return resp.json();
            })
            .then(function (json) {
                var data = json && json.data;
                var files = data && data.files;
                if (json && json.code === 0 && files) {
                    _files = files;
                }
            })
            .catch(function () {
                // 静默：404 / 网络异常 / JSON 解析失败均不影响页面
            });
        return _loading;
    }

    window.PetAssets = {
        /**
         * 按 key 取素材 URL（同步）。
         * @param {string} key 素材键名
         * @returns {string|null} URL 或 null（未加载 / 不存在）
         */
        resolve: function (key) {
            if (!key || !Object.prototype.hasOwnProperty.call(_files, key)) {
                return null;
            }
            return _files[key] || null;
        },

        /**
         * 按前缀取一组素材 URL（同步），按文件名（即 key）升序，用于逐帧动画。
         * @param {string} prefix 文件名前缀，如 "pet_stage1_idle_"
         * @returns {string[]} 命中的 URL 数组，无命中返回 []
         */
        list: function (prefix) {
            if (!prefix) {
                return [];
            }
            var keys = [];
            for (var k in _files) {
                if (Object.prototype.hasOwnProperty.call(_files, k) && k.indexOf(prefix) === 0) {
                    keys.push(k);
                }
            }
            keys.sort();
            var out = [];
            for (var i = 0; i < keys.length; i++) {
                out.push(_files[keys[i]]);
            }
            return out;
        },

        /**
         * 清单加载完成（成功或失败）后 resolve；永不 reject。
         * @returns {Promise<void>}
         */
        ready: function () {
            return load();
        },

        /**
         * 幂等触发加载，供显式调用。
         */
        init: function () {
            load();
        }
    };

    // 脚本加载即非阻塞发起请求，稍后图片可用时会自然生效
    load();
})();