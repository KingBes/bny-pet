<?php

use Kingbes\PebView\WindowHint;

return [
    "debug" => true, // 是否开启调试模式
    "init" => "", // 初始化js代码(会在window.onload之前加载js代码)
    "title" => "bnyPet 桌宠", // 窗口标题
    "size" => [400, 560, WindowHint::Fixed], // 窗口大小（小型宠物窗，固定尺寸）
    "icon" => base_path() . "/public/favicon.ico", // 窗口图标
    "closeCallback" => function ($win) { // 窗口关闭回调：关闭窗口即隐藏到托盘
        $win->hide();
    },
    "tray" => [ // 系统托盘
        "icon" => base_path() . "/public/favicon." . (PHP_OS_FAMILY === "Linux" ? "png" : "ico"), // 系统托盘图标
        "menu" => [ // 系统托盘菜单
            [
                "text" => "显示窗口", // 菜单名称
                "cb" => function ($win) { // 菜单回调
                    $win->show();
                }
            ],
            [
                "text" => "隐藏窗口", // 菜单名称
                "cb" => function ($win) { // 菜单回调
                    $win->hide();
                }
            ],
            [
                "text" => "退出应用", // 菜单名称
                "cb" => function ($win) { // 菜单回调
                    $win->terminate();
                }
            ]
        ]
    ],
    // 桌面悬浮模式：透明背景 + 无边框 + 置顶 + 可拖动 + 托盘切换点击穿透
    "desktop" => [
        "enabled" => true,              // 是否启用桌面悬浮模式（false 时退回旧行为：系统标题栏 + 不透明 + 不置顶）
        "size" => [100, 100],           // 收起态窗口尺寸：贴合宠物本体（stage4 最大约 96×130 + 顶部 24px 拖动条 + 边距）。
                                         // 宽度下限是 Windows 的 SM_CXMINTRACK=136，写更小会被系统钳到 136
        "expandSize" => [360, 300],     // 展开态窗口尺寸：点击宠物弹出操作浮层时临时放大，宠物占上部、浮层贴底部
        "alwaysOnTop" => true,          // 是否置顶
        "clickThrough" => false,        // 初始是否开启整窗点击穿透（托盘菜单可随时切换）
        "dragBarHeight" => 24,          // 自定义标题栏高度（px），必须与前端 #pet-dragbar 一致
    ],
    "bind" => [], // 绑定js事件（桥接函数已在 app\process\PetWindow 中实现，故此处留空）
];