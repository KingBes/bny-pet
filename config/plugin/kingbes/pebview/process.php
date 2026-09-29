<?php

return [
    "PebView" => [
        // 使用本项目自有的窗口进程类，以支持额外的 JS→PHP 桥接函数（petHide/petQuit/petNotify/petConfirm）
        "handler" => app\process\PetWindow::class,
    ],
];