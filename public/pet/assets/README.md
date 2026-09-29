# bnyPet 素材接入说明

## 总原则

- 素材统一放在本目录 `public/pet/assets/` 下，可再按子目录分类。
- 图片一律使用**透明背景 PNG**；文件名**英文小写 + 下划线**。
- **key = 文件名去掉扩展名**，例如 `ui/ui_coin.png` → key `ui_coin`；`pet/pet_stage2_idle_03.png` → key `pet_stage2_idle_03`。同名文件冲突时以路径更浅者（更靠近 assets 根目录）优先。
- 放入素材后**刷新页面即生效**（后端接口 `/pet/asset-list` 带 `Cache-Control: no-store`，不缓存清单）。
- **缺失一律自动回退**：前端有完整的代码绘制 / emoji 占位兜底，缺任何素材都不会报错、不会白屏。

## 放哪里 / 叫什么名字 / 尺寸 / 是否已接入渲染

| 目录 | 文件名（key） | 建议尺寸 | 渲染状态 |
| --- | --- | --- | --- |
| `public/` 根目录（不在 assets 内） | `favicon.ico` | 含 256/64/48/32/16 多尺寸的 `.ico` | 已接入（窗口与托盘图标；`pebview.php` 已引用，Linux 下用 `public/favicon.png`） |
| `ui/` | `ui_name`、`ui_coin`、`ui_hunger`、`ui_mood`、`ui_energy` | `32×32` | 已接入（顶部栏与状态条图标） |
| `food/` | `food_kibble`、`food_can`、`food_cake` | `64×64` | 已接入（商店 / 背包物品图标） |
| `toy/` | `toy_ball`、`toy_bell`、`toy_robot` | `64×64` | 已接入（商店 / 背包物品图标） |
| `skin/` | `skin_hat_straw`、`skin_ribbon`、`skin_hat_crown` | `128×128` | 已接入（装扮配饰；**锚点：图片底部中心对齐宠物头顶**） |
| `pet/` | 立绘 `pet_stage1` ~ `pet_stage4` | `256×256` | 已接入（**锚点：图片底部中心对齐宠物脚下的地面阴影**） |
| `pet/` | 逐帧序列 `pet_stage{N}_idle_01.png`、`_02`… | 单帧 `128×128` | 已接入（按文件名升序播放；**若提供 idle 序列则优先于立绘**） |
| `bg/` | `bg_room` | `360×220`（与 canvas 同尺寸） | 已接入（按 cover 铺满舞台） |
| `emotion/` | `emotion_happy`、`emotion_hungry`、`emotion_sleepy`、`emotion_angry` | `128×128` | **预留**：当前版本尚未接入渲染，放入不会报错但暂不显示 |
| `audio/` | 背景音乐 `bgm_main`（`.ogg`/`.mp3`）；音效 `sfx_feed`、`sfx_pet`、`sfx_happy`、`sfx_levelup`、`sfx_evolve`、`sfx_click`、`sfx_minigame_start`、`sfx_minigame_end` | — | **预留**：首版无音频，放入不会报错但暂不播放 |

## 最小可跑清单

- 什么都不放也能正常运行：只需 `public/favicon.ico` 即可拥有窗口 / 托盘图标。
- 想要有宠物形象：只需一张 `pet/pet_stage1.png`（幼生期立绘），或从 `pet/pet_stage1_idle_01.png` 开始的逐帧序列。

## 开发者信息（简短）

- 素材清单来源：`GET /pet/asset-list`，返回 `{ code:0, msg:'', data:{ files:{ key:url } } }`。
- 前端 API：
  - `PetAssets.resolve(key)`：同步返回该 key 的 URL，未加载 / 不存在返回 `null`。
  - `PetAssets.list(prefix)`：同步返回按文件名升序的 URL 数组，用于逐帧动画，无命中返回 `[]`。
  - `PetAssets.ready()`：返回清单加载完成（成功或失败）后的 Promise，永不 reject。
