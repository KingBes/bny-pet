<?php

namespace app\process;

use Kingbes\PebView\Window;

class BnyPet
{
    /** 等待 webman 的 HTTP 服务就绪的最长秒数 */
    private const READY_TIMEOUT = 30;

    /**
     * 取出 webman 的监听地址，并换成可用作客户端连接的形式
     *
     * @return string 例如 http://127.0.0.1:8787
     * @throws \RuntimeException 配置缺失或不是非空字符串时抛出
     */
    private function getNaviget(): string
    {
        $listen = config("process.webman.listen");
        if (!is_string($listen) || $listen === '') {
            throw new \RuntimeException(
                'PebView 进程取不到 webman 的监听地址(config("process.webman.listen")),'
                    . '请确认 webman 进程名与配置路径一致。'
            );
        }
        // 0.0.0.0 不能作为客户端连接地址，换成 127.0.0.1
        return str_replace('0.0.0.0', '127.0.0.1', $listen);
    }

    public function onWorkerStart()
    {
        // 定义状态文件路径
        $status_file = runtime_path() . DIRECTORY_SEPARATOR . '/windows/status_file';

        // 等 webman 的 HTTP 服务就绪后再开窗，避免窗口加载到一个还没起来的服务。
        // 必须带超时：地址写错时原来的 while(1) 会静默死循环，既不报错也没有日志。
        $naviget = $this->getNaviget();
        $deadline = time() + self::READY_TIMEOUT;
        while (true) {
            if (@fopen($naviget, 'r')) {
                break;
            }
            if (time() >= $deadline) {
                throw new \RuntimeException(
                    "等待 {$naviget} 就绪超时（" . self::READY_TIMEOUT . ' 秒）,PebView 窗口未启动。'
                );
            }
            sleep(1);
        }
        $config = config("plugin.kingbes.pebview.pebview");
        $this->run($config);
        // 判断是否windows系统
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
            file_put_contents($status_file, '0');
        } else {
            posix_kill(posix_getppid(), SIGINT);
        }
    }

    public function run(array $data): void
    {
        $win = new Window($data["debug"]);
        if (trim($data["init"]) !== "") {
            $win->init($data["init"]);
        }
        $win->setTitle($data["title"]) // 设置窗口标题
            ->setSize($data["size"][0], $data["size"][1], $data["size"][2]) // 设置窗口大小
            ->setIcon($data["icon"]) // 设置窗口图标
            ->setCloseCallback($data["closeCallback"]) // 设置关闭回调
            ->tray($data["tray"]["icon"]) // 设置托盘图标
            ->trayMenu($data["tray"]["menu"]); // 设置托盘菜单

        $win->setTransparent(true); // 设置窗口透明度
        $win->setCustomTitlebar(36, 0);
        // 拖动js
        $win->bind("tbBeginDrag", function (int $x, int $y)  use ($win) {
            $win->beginDrag($x, $y);
            return true;
        });
        // 是否穿透
        $win->bind("clickThrough", function (bool $isClickThrough) use ($win) {
            $win->setClickThrough($isClickThrough);
        });
        // 绑定js事件
        foreach ($data["bind"] as $bind) {
            $win->bind($bind["name"], $bind["cb"]);
        }
        $win->navigate($this->getNaviget())
            ->run()
            ->destroy();
    }
}
