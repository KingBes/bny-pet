<?php

namespace app\process;

use Kingbes\PebView\Window;
use Kingbes\PebView\WindowHint;
use Kingbes\PebView\Toast;
use Kingbes\PebView\Dialog;
use Kingbes\PebView\DialogLevel;
use Kingbes\PebView\DialogBtn;

/**
 * 桌宠窗口进程类
 *
 * 说明：vendor 中的 Kingbes\PebView\process\PebView 在 onWorkerStart() 内把 $win 作为局部变量使用，
 * 并没有将其暴露给 pebview.php 配置中的 bind 回调，因此配置里的托盘菜单、绑定回调无法引用窗口对象。
 * 为了在项目中新增 petHide/petQuit/petNotify/petConfirm 等 JS→PHP 桥接函数（这些回调必须持有窗口对象），
 * 这里重新实现了一遍窗口的创建与装配流程，并自行持有 $win 实例。
 * 除新增桥接与注释外，其余流程与 vendor 版本保持一致，vendor 目录不做任何修改。
 */
class PetWindow
{
    /**
     * 获取窗口导航地址（将 0.0.0.0 替换为 127.0.0.1，保证本机可访问）
     *
     * @return string
     */
    private function getNaviget(): string
    {
        $webman = config("process.webman.listen");
        return str_replace('0.0.0.0', '127.0.0.1', $webman);
    }

    /**
     * 读取桌面悬浮模式配置（缺失或非法时使用安全默认值）
     *
     * @return array{enabled: bool, size: array{0:int,1:int}, expandSize: array{0:int,1:int}, alwaysOnTop: bool, clickThrough: bool, dragBarHeight: int}
     */
    private function desktopConfig(): array
    {
        $raw = config("plugin.kingbes.pebview.pebview")["desktop"] ?? [];
        if (!is_array($raw)) {
            $raw = [];
        }
        // 尺寸必须是两个正整数，否则回退各自的默认值
        $readSize = function ($value, array $fallback): array {
            if (
                !is_array($value) || !isset($value[0], $value[1])
                || !is_int($value[0]) || !is_int($value[1])
                || $value[0] <= 0 || $value[1] <= 0
            ) {
                return $fallback;
            }
            return [$value[0], $value[1]];
        };
        $dragBarHeight = $raw["dragBarHeight"] ?? null;
        if (!is_int($dragBarHeight) || $dragBarHeight <= 0) {
            $dragBarHeight = 24;
        }
        return [
            "enabled" => ($raw["enabled"] ?? false) === true,
            // 收起态：贴合宠物本体（宽度不得小于 Windows 的 SM_CXMINTRACK=136，否则被系统钳制）
            "size" => $readSize($raw["size"] ?? null, [136, 168]),
            // 展开态：点击宠物弹出操作浮层时临时放大
            "expandSize" => $readSize($raw["expandSize"] ?? null, [360, 300]),
            "alwaysOnTop" => array_key_exists("alwaysOnTop", $raw) ? (bool) $raw["alwaysOnTop"] : true,
            "clickThrough" => (bool) ($raw["clickThrough"] ?? false),
            "dragBarHeight" => $dragBarHeight,
        ];
    }

    /**
     * 取 user32 的 FFI 绑定（读窗口矩形与设窗口尺寸共用）
     *
     * @return \FFI
     */
    private static function user32(): \FFI
    {
        static $user32 = null;
        if ($user32 === null) {
            $user32 = \FFI::cdef(
                "struct RECT{int left; int top; int right; int bottom;};"
                . "int GetWindowRect(void* hWnd, struct RECT* lpRect);"
                . "int SetWindowPos(void* hWnd, void* insertAfter, int x, int y, int cx, int cy, unsigned int flags);",
                "user32.dll"
            );
        }
        return $user32;
    }

    /**
     * 取本窗口的 HWND（Window 的 $pv 是 private，用反射取出交给官方 FFI 转换）
     *
     * @return \FFI\CData|null
     */
    private function windowHandle(Window $win)
    {
        $ref = new \ReflectionProperty(Window::class, 'pv');
        $ref->setAccessible(true);
        $h = Window::ffi()->webview_get_window($ref->getValue($win));
        return (\FFI::isNull($h)) ? null : $h;
    }

    /**
     * 读取本窗口在屏幕上的真实左上角坐标（物理像素）
     *
     * 为什么不用 JS 的 window.screenX：实测该值是 stale 的 —— 窗口被 setPosition 移动后
     * 它仍返回窗口创建时的原生默认位，会把正确存档覆盖成错误值，还会把已恢复的窗口拽走。
     * GetWindowRect 读的是窗口当前真实矩形，不受此影响。
     *
     * @return array{x:int, y:int}|null 读取失败返回 null（调用方静默跳过，不影响窗口）
     */
    private function readWindowPos(Window $win): ?array
    {
        if (PHP_OS_FAMILY !== 'Windows') {
            return null;
        }
        try {
            $h = $this->windowHandle($win);
            if ($h === null) {
                return null;
            }
            $user32 = self::user32();
            $rect = $user32->new("struct RECT");
            if ($user32->GetWindowRect($h, \FFI::addr($rect)) === 0) {
                return null;
            }
            return ['x' => (int) $rect->left, 'y' => (int) $rect->top];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * 用 Win32 直接设置窗口外框尺寸（无边框状态下外框即客户区）
     *
     * 为什么不用 Window::setSize：实测 webview_set_size 在 setCustomTitlebar 之后
     * 仍按「标准系统边框 + 标题栏」给目标尺寸加补偿，配置 128×168 会得到 144×207
     * （+16 宽 / +39 高），且补偿量在启动期与运行期还不一致。直接 SetWindowPos 最确定。
     *
     * @param int|null $x 目标左上角；null 表示不移动（SWP_NOMOVE）
     * @param int|null $y 同上
     * @return bool 失败返回 false（调用方保留官方 setSize 的结果）
     */
    private function setWindowOuterSize(Window $win, int $w, int $h, ?int $x = null, ?int $y = null): bool
    {
        if (PHP_OS_FAMILY !== 'Windows' || $w <= 0 || $h <= 0) {
            return false;
        }
        try {
            $user32 = self::user32();
            $ptr = $this->windowHandle($win);
            if ($ptr === null) {
                return false;
            }
            // SWP_NOMOVE(0x0002) | SWP_NOZORDER(0x0004) | SWP_NOACTIVATE(0x0010)
            // NOZORDER：不碰 Z 序，保住当前的置顶状态
            $flags = 0x0004 | 0x0010;
            if ($x === null || $y === null) {
                $flags |= 0x0002;
                $x = 0;
                $y = 0;
            }
            return $user32->SetWindowPos($ptr, null, $x, $y, $w, $h, $flags) !== 0;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * 工作进程启动回调
     *
     * @return void
     */
    public function onWorkerStart(): void
    {
        // 定义状态文件路径（Windows 下用于通知 launcher 退出全部进程）
        $status_file = runtime_path() . DIRECTORY_SEPARATOR . '/windows/status_file';
        // 等待 webman HTTP 服务可访问
        $naviget = $this->getNaviget();
        while (1) {
            if (@fopen($naviget, 'r')) {
                break;
            }
            sleep(1);
        }
        // PebView 依赖 FFI 加载底层动态库；未开启 ffi 扩展时直接跳过原生窗口，
        // 避免 worker 反复抛 "Class \"FFI\" not found" 并被 workerman 无限重启。
        // 此时 HTTP 服务与网页版游戏仍可正常使用。
        if (!extension_loaded('FFI')) {
            echo "[bnyPet] 未检测到 PHP ffi 扩展，已跳过原生窗口启动。", PHP_EOL;
            echo "[bnyPet] 如需桌宠原生窗口，请在 php.ini 中开启 extension=ffi 且设置 ffi.enable=true，然后重新执行 windows.bat。", PHP_EOL;
            echo "[bnyPet] 网页版游戏仍可通过 http://127.0.0.1:8787/pet 访问。", PHP_EOL;
            return;
        }
        $config = config("plugin.kingbes.pebview.pebview");
        // 桌面悬浮模式配置（已做安全默认值处理）
        $desktop = $this->desktopConfig();
        // 官方环境变量：把 WebView2 默认背景色设为全透明，消除透明生效前的白闪。
        // 8 位 hex，alpha 在前；必须在创建窗口（WebView2 初始化）之前设置。
        putenv('WEBVIEW2_DEFAULT_BACKGROUND_COLOR=00000000');
        $win = new Window($config["debug"]);
        if (trim($config["init"]) !== "") {
            $win->init($config["init"]);
        }
        // 桌面模式下使用 desktop.size，未启用时维持原有尺寸
        $sizeW = $desktop["enabled"] ? $desktop["size"][0] : $config["size"][0];
        $sizeH = $desktop["enabled"] ? $desktop["size"][1] : $config["size"][1];
        $win->setTitle($config["title"])
            ->setSize($sizeW, $sizeH, WindowHint::Fixed)
            ->setIcon($config["icon"])
            ->setCloseCallback($config["closeCallback"]);
        if ($desktop["enabled"]) {
            // 1) 自定义标题栏 → Windows 上 WM_NCCALCSIZE 返回 0，窗口真正无边框（内容贴到窗口顶边）
            //    高度必须与前端 #pet-dragbar 一致；>0 才是启用，null/<=0 会退回系统标题栏
            try {
                $win->setCustomTitlebar($desktop["dragBarHeight"]);
            } catch (\RuntimeException $e) {
                echo "[bnyPet] 自定义标题栏不可用，已退回系统标题栏：", $e->getMessage(), PHP_EOL;
            }

            // 2) 透明背景（窗口层 + 渲染层）；需要较新的 WebView2 运行时
            try {
                $win->setTransparent(true);
            } catch (\RuntimeException $e) {
                echo "[bnyPet] 窗口透明不可用，将显示为不透明：", $e->getMessage(), PHP_EOL;
            }

            // 3) 置顶
            if ($desktop["alwaysOnTop"]) {
                try {
                    $win->setAlwaysOnTop(true);
                } catch (\RuntimeException $e) {
                    echo "[bnyPet] 窗口置顶不可用：", $e->getMessage(), PHP_EOL;
                }
            }

            // 4) 全部能力装配完之后再把外框钉到目标尺寸 —— 前面的透明 / 置顶会改窗口样式
            //    并触发窗口重算，在它们之前设的尺寸会被覆盖（实测收起态从 128 变成 136）。
            //    官方 setSize 在无边框状态下会按「标准边框 + 标题栏」给目标加补偿
            //    （实测 128×168 得到 144×207），故这里用 Win32 SetWindowPos；失败时静默
            //    保留上面那次 setSize 的结果。
            $this->setWindowOuterSize($win, $sizeW, $sizeH);
        }
        // 托盘菜单：底层只能追加不能更新，故一次性构造完整菜单数组
        $menu = $config["tray"]["menu"];
        if ($desktop["enabled"]) {
            $menu[] = [
                "text" => "开启点击穿透",
                "cb" => function ($win) {
                    try {
                        $win->setClickThrough(true);
                        echo "[bnyPet] 已开启整窗点击穿透（窗口不再接收鼠标事件，可从托盘菜单关闭）", PHP_EOL;
                    } catch (\RuntimeException $e) {
                        echo "[bnyPet] 开启点击穿透失败：", $e->getMessage(), PHP_EOL;
                    }
                },
            ];
            $menu[] = [
                "text" => "关闭点击穿透",
                "cb" => function ($win) {
                    try {
                        $win->setClickThrough(false);
                        echo "[bnyPet] 已关闭整窗点击穿透（窗口恢复接收鼠标事件）", PHP_EOL;
                    } catch (\RuntimeException $e) {
                        echo "[bnyPet] 关闭点击穿透失败：", $e->getMessage(), PHP_EOL;
                    }
                },
            ];
        }
        $win->tray($config["tray"]["icon"])
            ->trayMenu($menu);
        // 保留配置中的 bind 循环，方便后续通过 pebview.php 扩展绑定
        foreach ($config["bind"] as $bind) {
            $win->bind($bind["name"], $bind["cb"]);
        }
        // 新增的 JS→PHP 桥接函数
        // 注意：Window::bind() 的 PHP 实现仅在回调返回“真值”（非空字符串）时才会回写结果给 JS，
        // 否则 JS 侧 Promise 永不 resolve，因此每个回调都必须返回非空字符串。
        // 隐藏窗口
        $win->bind("petHide", function () use ($win) {
            $win->hide();
            return 'ok';
        });
        // 退出应用
        $win->bind("petQuit", function () use ($win) {
            $win->terminate();
            return 'ok';
        });
        // 系统通知
        $win->bind("petNotify", function (string $title = '', string $message = '') use ($win) {
            Toast::show('bnyPet', $title, $message);
            return 'ok';
        });
        // 确认对话框，返回 'yes' 表示用户点击了“是/确定”，'no' 表示其他
        $win->bind("petConfirm", function (string $message = '') use ($win) {
            $ok = Dialog::msg($message, DialogLevel::Warning, DialogBtn::YesNo);
            return $ok ? 'yes' : 'no';
        });
        // 拖动窗口：前端在拖动条 mousedown 时把 event.screenX / screenY 传进来
        $win->bind("petDrag", function (int $x = 0, int $y = 0) use ($win) {
            try {
                $win->beginDrag($x, $y);
            } catch (\RuntimeException $e) {
                echo "[bnyPet] 发起窗口拖动失败：", $e->getMessage(), PHP_EOL;
            }
            return 'ok';
        });
        // 读取上次保存的窗口位置；无记录或文件损坏时 x/y 为 null
        $win->bind("petGetPos", function () {
            $file = runtime_path() . DIRECTORY_SEPARATOR . 'pet' . DIRECTORY_SEPARATOR . 'window.json';
            if (!is_file($file)) {
                return ['x' => null, 'y' => null];
            }
            $data = json_decode((string) file_get_contents($file), true);
            if (!is_array($data) || !isset($data['x'], $data['y']) || !is_numeric($data['x']) || !is_numeric($data['y'])) {
                return ['x' => null, 'y' => null];
            }
            return ['x' => (int) $data['x'], 'y' => (int) $data['y']];
        });
        // 位置存档的最近一次写入值，避免 petSyncPos 重复写盘
        $lastSaved = null;
        // 保存并应用窗口位置（用于启动时恢复存档位置）
        $win->bind("petSetPos", function (int $x = 0, int $y = 0) use ($win, &$lastSaved) {
            $dir = runtime_path() . DIRECTORY_SEPARATOR . 'pet';
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }
            $lastSaved = ['x' => $x, 'y' => $y];
            file_put_contents(
                $dir . DIRECTORY_SEPARATOR . 'window.json',
                json_encode(['x' => $x, 'y' => $y], JSON_UNESCAPED_UNICODE)
            );
            try {
                $win->setPosition($x, $y);
            } catch (\RuntimeException $e) {
                echo "[bnyPet] 设置窗口位置失败：", $e->getMessage(), PHP_EOL;
            }
            return 'ok';
        });
        // 把窗口真实位置同步到存档（只写文件，绝不移动窗口 —— 否则会自己拽自己）
        // 前端每 500ms 调用一次：拖动由原生 beginDrag 完成，JS 拿不到拖动后的屏幕坐标，
        // 只能由 PHP 侧用 GetWindowRect 读真实矩形，拖动结束后下一次调用即写入最终位置
        $win->bind("petSyncPos", function () use ($win, &$lastSaved, $desktop) {
            if (!$desktop["enabled"]) {
                return 'skip';
            }
            $pos = $this->readWindowPos($win);
            if ($pos === null) {
                return 'skip';
            }
            if (
                $lastSaved !== null
                && $lastSaved['x'] === $pos['x'] && $lastSaved['y'] === $pos['y']
            ) {
                return 'same';
            }
            $lastSaved = $pos;
            $dir = runtime_path() . DIRECTORY_SEPARATOR . 'pet';
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }
            file_put_contents(
                $dir . DIRECTORY_SEPARATOR . 'window.json',
                json_encode($pos, JSON_UNESCAPED_UNICODE)
            );
            return 'ok';
        });
        // 点击宠物切换窗口尺寸：收起态贴合宠物本体，展开态放大容纳操作浮层。
        // setSize 后要把左上角钉回原处并钳制到屏幕内，否则窗口会向右下"长出去"
        // 屏幕右下角常驻时直接展开会有一截跑出可视区。屏幕尺寸由前端传入
        // （screen.availWidth/Height 是 CSS 像素，前端已按 devicePixelRatio 换算成物理像素）
        $win->bind("petSetPanel", function (bool $expand = false, int $availW = 0, int $availH = 0) use ($win, $desktop) {
            if (!$desktop["enabled"]) {
                return 'skip';
            }
            $target = $expand ? $desktop["expandSize"] : $desktop["size"];
            $origin = $this->readWindowPos($win);
            $x = $origin === null ? null : $origin["x"];
            $y = $origin === null ? null : $origin["y"];
            if ($availW > 0 && $x !== null) {
                $x = max(0, min($x, $availW - $target[0]));
            }
            if ($availH > 0 && $y !== null) {
                $y = max(0, min($y, $availH - $target[1]));
            }
            // 一次 SetWindowPos 同时改尺寸与位置，绕开官方 setSize 的边框补偿偏差
            if (!$this->setWindowOuterSize($win, $target[0], $target[1], $x, $y)) {
                // 降级：官方 setSize + setPosition（尺寸可能带边框补偿偏差，但至少可用）
                try {
                    $win->setSize($target[0], $target[1], WindowHint::Fixed);
                    if ($x !== null && $y !== null) {
                        $win->setPosition($x, $y);
                    }
                } catch (\RuntimeException $e) {
                    echo "[bnyPet] 切换窗口尺寸失败：", $e->getMessage(), PHP_EOL;
                    return 'fail';
                }
            }
            return 'ok';
        });
        // 桌面模式下走 /pet?mode=desktop，旧行为仍导航到根路径（靠 302 跳转）
        $win->navigate($desktop["enabled"] ? $naviget . '/pet?mode=desktop' : $naviget);
        // 初始穿透状态：配置为 true 时在 run() 之前开启一次，默认 false 不做任何事
        if ($desktop["enabled"] && $desktop["clickThrough"]) {
            try {
                $win->setClickThrough(true);
            } catch (\RuntimeException $e) {
                echo "[bnyPet] 初始开启点击穿透失败：", $e->getMessage(), PHP_EOL;
            }
        }
        $win->run()
            ->destroy();
        // 判断是否 windows 系统，通知 launcher 退出全部进程
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            file_put_contents($status_file, '0');
        } else {
            posix_kill(posix_getppid(), SIGINT);
        }
    }
}