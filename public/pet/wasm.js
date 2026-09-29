/*
 * 桌宠核心 wasm 前端加载器
 * ------------------------------------------------------------
 * wasm 模块由 PHP 侧的 app\service\WasmService 在请求时现场生成，
 * 通过 GET /pet/wasm 返回，.wasm 二进制不落盘、每次请求内容与代码一致。
 *
 * 导出函数（名称与签名由 PHP 侧固定）：
 *   rng(seed, max) -> 0 .. max-1 的伪随机整数（max<=0 时返回 0）
 *   clamp(v, lo, hi) -> 把 v 裁剪到 [lo, hi]
 *   exp_need(level) -> 100 + level * 50（与 PetService::expNeed() 一致）
 *   stage_of(level) -> 1..4 形态（与 PetService::stageOf() 一致）
 *
 * 兜底策略：wasm 未就绪或加载失败时，禁止使用 Math.random()，
 * 改用纯 JS 的确定性 LCG 实现，保证 rng 结果与 wasm 版本一致。
 */
(function () {
  'use strict';

  /** 已实例化出的 wasm 导出对象（instance.exports），未就绪时为 null */
  var exportsObj = null;
  /** ready() 可重复调用：已就绪立刻 resolve，未就绪等待加载完成 */
  var readyPromise = null;
  /** 降级提示只输出一次 */
  var warned = false;

  // 纯 JS 的确定性 LCG 兜底（与 wasm 侧 rng 算法一致）
  function lcgRng(seed, max) {
    var s = (seed * 1103515245 + 12345) >>> 0;
    s = (s >>> 7) >>> 0;
    return max > 0 ? (s % max) : 0;
  }

  // 加载并实例化 wasm 模块，导出对象存到 exportsObj
  function load() {
    readyPromise = fetch('/pet/wasm')
      .then(function (res) {
        if (!res.ok) {
          throw new Error('wasm 响应异常: ' + res.status);
        }
        return res.arrayBuffer();
      })
      .then(function (buffer) {
        return WebAssembly.instantiate(buffer);
      })
      .then(function (result) {
        // 兼容两种返回值形态：{module, instance} 或直接是 Instance
        var inst = result && result.instance ? result.instance : result;
        exportsObj = inst && inst.exports ? inst.exports : null;
        if (!exportsObj || typeof exportsObj.rng !== 'function') {
          throw new Error('wasm 导出函数不完整');
        }
      })
      .catch(function (err) {
        // 加载失败：保留 exportsObj = null，后续调用自动走纯 JS 兜底
        console.warn('[PetWasm] wasm 加载失败，已降级为纯 JS 实现: ', err);
      });
  }

  function ensureWarned() {
    if (!warned && !exportsObj) {
      warned = true;
      console.warn('[PetWasm] wasm 尚未就绪，使用纯 JS 确定性兜底实现');
    }
  }

  window.PetWasm = {
    /**
     * 返回 Promise：resolve 后 wasm 可用（可重复调用，已就绪则立刻 resolve）
     * @returns {Promise}
     */
    ready: function () {
      if (exportsObj) {
        return Promise.resolve();
      }
      return readyPromise || Promise.resolve();
    },

    /**
     * 伪随机数：返回 0 .. max-1 的整数
     * @param {number} seed 种子
     * @param {number} max 上限（不含）
     * @returns {number}
     */
    rng: function (seed, max) {
      if (exportsObj) {
        return exportsObj.rng(seed | 0, max | 0) | 0;
      }
      ensureWarned();
      return lcgRng(seed | 0, max | 0) | 0;
    },

    /**
     * 数值裁剪：把 v 裁剪到 [lo, hi]
     * @param {number} v
     * @param {number} lo
     * @param {number} hi
     * @returns {number}
     */
    clamp: function (v, lo, hi) {
      if (exportsObj) {
        return exportsObj.clamp(v | 0, lo | 0, hi | 0) | 0;
      }
      ensureWarned();
      var x = v | 0, low = lo | 0, high = hi | 0;
      return (x < low ? low : (x > high ? high : x)) | 0;
    },

    /**
     * 升级所需经验：100 + level * 50（与 PetService::expNeed() 一致）
     * @param {number} level
     * @returns {number}
     */
    expNeed: function (level) {
      if (exportsObj) {
        return exportsObj.exp_need(level | 0) | 0;
      }
      ensureWarned();
      return (100 + (level | 0) * 50) | 0;
    },

    /**
     * 由等级推导形态（1..4）：>=20 -> 4, >=10 -> 3, >=5 -> 2, 否则 1
     * 与 PetService::stageOf() 一致
     * @param {number} level
     * @returns {number}
     */
    stageOf: function (level) {
      if (exportsObj) {
        return exportsObj.stage_of(level | 0) | 0;
      }
      ensureWarned();
      var l = level | 0;
      if (l >= 20) { return 4; }
      if (l >= 10) { return 3; }
      if (l >= 5) { return 2; }
      return 1;
    },

    /**
     * 是否已就绪
     * @returns {boolean}
     */
    isReady: function () {
      return exportsObj !== null;
    }
  };

  // 页面加载后立即开始加载 wasm
  load();
})();
