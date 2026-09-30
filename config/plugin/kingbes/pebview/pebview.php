<?php

use Kingbes\PebView\WindowHint;

return [
    "debug" => true, // 是否开启调试模式
    "init" => "", // 初始化js代码(会在window.onload之前加载js代码)
    "title" => "PebView", // 窗口标题
    "size" => [400, 420, WindowHint::None], // 窗口大小
    "icon" => base_path() . "/public/favicon.ico", // 窗口图标
    "closeCallback" => function ($win) { // 窗口关闭回调
        $win->hide();
    },
    "tray" => [ // 系统托盘
        "icon" => base_path() . "/public/favicon." . (PHP_OS_FAMILY === "Linux" ? "png" : "ico"), // 系统托盘图标
        "menu" => [ // 系统托盘菜单
            [
                "text" => "顶置窗口", // 菜单名称
                "cb" => function ($win) { // 菜单回调
                    $win->setAlwaysOnTop(true);
                }
            ],
            [
                "text" => "取消顶置", // 菜单名称
                "cb" => function ($win) { // 菜单回调
                    $win->setAlwaysOnTop(false);
                }
            ],
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
    "bind" => [ // 绑定js事件
    ]
];
