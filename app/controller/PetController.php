<?php

namespace app\controller;

use support\Request;
use app\service\PetService;
use app\service\WasmService;

/**
 * 桌宠游戏控制器
 *
 * index() 渲染游戏页骨架；其余接口以统一 JSON 结构
 * {code, msg, data} 返回养成 / 商店 / 图鉴 / 小游戏等业务数据，
 * 具体业务逻辑集中在 app\service\PetService。
 */
class PetController
{
    /**
     * 渲染桌宠游戏主页面
     *
     * @param Request $request
     * @return \support\Response
     */
    public function index(Request $request)
    {
        return view('pet/index');
    }

    /**
     * 读取当前状态：GET /pet/state
     *
     * @param Request $request
     * @return \support\Response
     */
    public function state(Request $request)
    {
        return json(['code' => 0, 'msg' => '', 'data' => PetService::state()]);
    }

    /**
     * 执行动作：POST /pet/action {type}
     *
     * @param Request $request
     * @return \support\Response
     */
    public function action(Request $request)
    {
        $type = (string)$this->input($request, 'type', '');
        return json(PetService::applyAction($type));
    }

    /**
     * 物品总览：GET /pet/items
     *
     * @param Request $request
     * @return \support\Response
     */
    public function items(Request $request)
    {
        return json(['code' => 0, 'msg' => '', 'data' => PetService::items()]);
    }

    /**
     * 商店 / 穿戴：POST /pet/shop {action, item}
     *
     * @param Request $request
     * @return \support\Response
     */
    public function shop(Request $request)
    {
        $action = (string)$this->input($request, 'action', '');
        $item = (string)$this->input($request, 'item', '');
        return json(PetService::shop($action, $item));
    }

    /**
     * 小游戏结算：POST /pet/minigame {score}
     *
     * @param Request $request
     * @return \support\Response
     */
    public function minigame(Request $request)
    {
        $score = (int)$this->input($request, 'score', 0);
        return json(PetService::finishMinigame($score));
    }

    /**
     * 重置存档：POST /pet/reset
     *
     * @param Request $request
     * @return \support\Response
     */
    public function reset(Request $request)
    {
        $result = PetService::reset();
        return json(['code' => 0, 'msg' => '', 'data' => ['state' => $result['state']]]);
    }

    /**
     * 素材清单：GET /pet/asset-list
     *
     * 递归扫描 public/pet/assets 下的图片 / 音频文件，返回统一结构
     * { code:0, msg:'', data:{ files:{ key:url } } }，供前端
     * public/pet/assets.js 建立 key -> URL 映射。目录不存在时返回空清单。
     * key 为文件名去掉扩展名；同名冲突以路径更浅者（更靠近 assets 根目录）优先。
     * URL 统一使用正斜杠，并对每一段做 rawurlencode。
     *
     * @param Request $request
     * @return \support\Response
     */
    public function assetList(Request $request)
    {
        $root = public_path('pet/assets');
        $files = [];

        if (is_dir($root)) {
            $allowed = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'ogg', 'mp3', 'wav'];
            $found = [];
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $file) {
                if (!$file->isFile()) {
                    continue;
                }
                if (!in_array(strtolower($file->getExtension()), $allowed, true)) {
                    continue;
                }
                $found[] = $file->getPathname();
            }

            // 路径更浅者优先，其次按路径升序，保证 key 冲突时结果确定
            usort($found, function ($a, $b) use ($root) {
                $ra = str_replace('\\', '/', substr($a, strlen($root)));
                $rb = str_replace('\\', '/', substr($b, strlen($root)));
                $da = substr_count($ra, '/');
                $db = substr_count($rb, '/');
                if ($da === $db) {
                    return strcmp($a, $b);
                }
                return $da < $db ? -1 : 1;
            });

            foreach ($found as $path) {
                $key = pathinfo($path, PATHINFO_FILENAME);
                if (isset($files[$key])) {
                    continue;
                }
                $rel = ltrim(str_replace('\\', '/', substr($path, strlen($root))), '/');
                $segments = array_map('rawurlencode', explode('/', $rel));
                $files[$key] = '/pet/assets/' . implode('/', $segments);
            }
        }

        $payload = [
            'code' => 0,
            'msg' => '',
            'data' => ['files' => (object)$files],
        ];
        return response(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'no-store',
        ]);
    }

    /**
     * 宠物核心 wasm 模块：GET /pet/wasm
     *
     * 由 WasmService 现场生成的 .wasm 二进制（不落盘），
     * 前端 public/pet/wasm.js 会 fetch 此接口并 instantiate。
     *
     * @param Request $request
     * @return \support\Response
     */
    public function wasm(Request $request)
    {
        return response(WasmService::petCoreBytes(), 200, [
            'Content-Type' => 'application/wasm',
            'Cache-Control' => 'no-store',
        ]);
    }

    /**
     * 兼容读取请求参数：优先 post()，再回退到 JSON 原始请求体
     *
     * @param Request $request
     * @param string $key 参数名
     * @param mixed $default 缺省值
     * @return mixed
     */
    private function input(Request $request, string $key, mixed $default = null): mixed
    {
        $value = $request->post($key);
        if ($value === null) {
            $raw = json_decode((string)$request->rawBody(), true);
            if (is_array($raw) && array_key_exists($key, $raw)) {
                $value = $raw[$key];
            }
        }
        return $value === null ? $default : $value;
    }
}