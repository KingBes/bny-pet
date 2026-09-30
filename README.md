# BnyPet 兔子桌宠物

> 兔子桌宠物是一个基于 webman 框架的项目，用于模拟一个兔子的宠物。

## 环境要求

- PHP >= 8.2
- PHP-FFI: *
- Windows x86_64: webview2
- Linux x86_64/arm64: GTK+3
- MacOS x86_64/arm64: Cocoa

## 安装

```sh
git clone https://github.com/KingBes/bny-pet.git
cd bny-pet
composer install

# 启动项目
php start.php start # linux/macos
php ./vendor/kingbes/pebview/windows.php # windows
```