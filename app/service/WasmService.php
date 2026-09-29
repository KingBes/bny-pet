<?php

namespace app\service;

use Kingbes\Wasm\Module;
use Kingbes\Wasm\ValType;
use Kingbes\Wasm\NumType;

/**
 * 桌宠核心 WebAssembly 模块生成服务
 * ------------------------------------------------------------
 * 使用纯 PHP 的 kingbes/wasm 在运行时现场构建 .wasm 二进制，
 * 通过 HTTP 接口 /pet/wasm 提供给前端（前端 public/pet/wasm.js）加载。
 *
 * 模块只导出以下 4 个函数（名称即导出名，前端依赖，务必保持稳定）：
 *   rng(seed: i32, max: i32) -> i32      伪随机，返回 0 .. max-1
 *   clamp(v: i32, lo: i32, hi: i32) -> i32  数值裁剪
 *   exp_need(level: i32) -> i32          升级所需经验
 *   stage_of(level: i32) -> i32          由等级推导形态（1~4）
 *
 * 公式对应关系（两处必须同步修改）：
 *   exp_need  对应 PetService::expNeed()  => 100 + level * 50
 *   stage_of  对应 PetService::stageOf()  => >=20 -> 4, >=10 -> 3, >=5 -> 2, 否则 1
 *
 * 注意：本类不写任何磁盘缓存，每次调用都重新构建，保证二进制与代码一致。
 */
class WasmService
{
    /**
     * 构建并返回宠物核心模块的 .wasm 二进制字节
     *
     * @return string 二进制字符串，可直接作为 application/wasm 响应体
     */
    public static function petCoreBytes(): string
    {
        $mod = new Module();

        self::buildRng($mod);
        self::buildClamp($mod);
        self::buildExpNeed($mod);
        self::buildStageOf($mod);

        return $mod->toBytes();
    }

    /**
     * rng(seed: i32, max: i32) -> i32
     *
     * 伪随机数：返回 0 .. max-1 之间的整数。
     * 若 max <= 0 直接返回 0（必须防护，否则 rem_u 除以 0 会触发 wasm trap）。
     * 否则按线性同余算法计算：
     *   s = seed * 1103515245 + 12345   （i32 自然回绕，等价于溢出取模 2^32）
     *   s = s >>> 7                     （无符号右移）
     *   return s % max                  （无符号取余）
     *
     * 该算法与前端 public/pet/wasm.js 的纯 JS 兜底实现保持一致。
     *
     * @param Module $mod
     * @return void
     */
    private static function buildRng(Module $mod): void
    {
        $fn = $mod->newFn([
            'name' => 'rng',
            'params' => [ValType::I32, ValType::I32],
            'results' => [ValType::I32],
        ]);

        // 条件：max <= 0（有符号比较）
        $fn->getLocal(1)->const(0)->le(NumType::I32, true);
        $label = $fn->if_([], [ValType::I32]);
        // then：max 非法，返回 0
        $fn->const(0);
        $fn->else_($label);
        // else：s = seed * 1103515245 + 12345
        $fn->getLocal(0)->const(1103515245)->mul(NumType::I32);
        $fn->const(12345)->add(NumType::I32);
        // s = s >>> 7（无符号右移）
        $fn->const(7)->shr(NumType::I32, false);
        // s = s % max（无符号取余）
        $fn->getLocal(1)->rem(NumType::I32, false);
        $fn->end($label);

        $mod->commit($fn);
    }

    /**
     * clamp(v: i32, lo: i32, hi: i32) -> i32
     *
     * 把 v 裁剪到 [lo, hi] 区间：
     *   if (v < lo) then lo else (if (v > hi) then hi else v)
     *
     * 与 PetService 内部使用的 0..100 裁剪逻辑同源。
     *
     * @param Module $mod
     * @return void
     */
    private static function buildClamp(Module $mod): void
    {
        $fn = $mod->newFn([
            'name' => 'clamp',
            'params' => [ValType::I32, ValType::I32, ValType::I32],
            'results' => [ValType::I32],
        ]);

        // 条件：v < lo（有符号比较）
        $fn->getLocal(0)->getLocal(1)->lt(NumType::I32, true);
        $outer = $fn->if_([], [ValType::I32]);
        // then：返回 lo
        $fn->getLocal(1);
        $fn->else_($outer);
        // else 分支内部：v > hi ?
        $fn->getLocal(0)->getLocal(2)->gt(NumType::I32, true);
        $inner = $fn->if_([], [ValType::I32]);
        // then：返回 hi
        $fn->getLocal(2);
        $fn->else_($inner);
        // else：返回 v
        $fn->getLocal(0);
        $fn->end($inner);
        $fn->end($outer);

        $mod->commit($fn);
    }

    /**
     * exp_need(level: i32) -> i32
     *
     * 由 level 升到 level+1 所需经验，必须与 PHP 侧 PetService::expNeed() 完全一致：
     *   return 100 + level * 50
     *
     * @param Module $mod
     * @return void
     */
    private static function buildExpNeed(Module $mod): void
    {
        $fn = $mod->newFn([
            'name' => 'exp_need',
            'params' => [ValType::I32],
            'results' => [ValType::I32],
        ]);

        // level * 50 + 100
        $fn->getLocal(0)->const(50)->mul(NumType::I32);
        $fn->const(100)->add(NumType::I32);

        $mod->commit($fn);
    }

    /**
     * stage_of(level: i32) -> i32
     *
     * 由等级推导形态，必须与 PHP 侧 PetService::stageOf() 完全一致：
     *   level >= 20 -> 4
     *   level >= 10 -> 3
     *   level >= 5  -> 2
     *   否则        -> 1
     *
     * @param Module $mod
     * @return void
     */
    private static function buildStageOf(Module $mod): void
    {
        $fn = $mod->newFn([
            'name' => 'stage_of',
            'params' => [ValType::I32],
            'results' => [ValType::I32],
        ]);

        // level >= 20 ?
        $fn->getLocal(0)->const(20)->ge(NumType::I32, true);
        $l1 = $fn->if_([], [ValType::I32]);
        $fn->const(4);
        $fn->else_($l1);
        // level >= 10 ?
        $fn->getLocal(0)->const(10)->ge(NumType::I32, true);
        $l2 = $fn->if_([], [ValType::I32]);
        $fn->const(3);
        $fn->else_($l2);
        // level >= 5 ?
        $fn->getLocal(0)->const(5)->ge(NumType::I32, true);
        $l3 = $fn->if_([], [ValType::I32]);
        $fn->const(2);
        $fn->else_($l3);
        $fn->const(1);
        $fn->end($l3);
        $fn->end($l2);
        $fn->end($l1);

        $mod->commit($fn);
    }
}