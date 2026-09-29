<?php

namespace app\service;

/**
 * 桌宠养成核心服务
 * ------------------------------------------------------------
 * 负责：
 *   1. 单文件 JSON 存档的读写（runtime/pet/save.json）；
 *   2. 时间衰减（settle）与数值裁剪；
 *   3. 等级 / 形态 / 经验公式推导（与 wasm 侧保持同一套公式）；
 *   4. 动作（喂养 / 抚摸 / 陪玩 / 睡觉）结算；
 *   5. 物品目录（食物 / 玩具 / 装扮）、商店购买与穿戴、图鉴数据；
 *   6. 小游戏结算奖励。
 *
 * 公式约定（wasm 侧使用同样公式）：
 *   expNeed($level) = 100 + $level * 50
 *   累计 exp 逐级扣减得到 level 与 expIntoLevel
 *   stage: >=20 -> 4, >=10 -> 3, >=5 -> 2, 否则 1
 */
class PetService
{
    /** 形态名称（1~4） */
    public const STAGE_NAMES = [1 => '幼生期', 2 => '成长期', 3 => '成熟期', 4 => '完全体'];

    /** 状态数值上下限 */
    private const STAT_MIN = 0;
    private const STAT_MAX = 100;

    /** 小游戏分数上限 */
    private const MINIGAME_SCORE_MAX = 300;

    /* ============================================================
     * 存档读写
     * ============================================================ */

    /**
     * 存档目录：runtime/pet
     */
    private static function saveDir(): string
    {
        return runtime_path() . '/pet';
    }

    /**
     * 存档文件路径：runtime/pet/save.json
     */
    private static function savePath(): string
    {
        return self::saveDir() . '/save.json';
    }

    /**
     * 确保存档目录存在
     */
    private static function ensureDir(): void
    {
        $dir = self::saveDir();
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
    }

    /**
     * 全新默认存档
     *
     * @return array
     */
    public static function defaultState(): array
    {
        $now = time();
        return [
            'name' => '小bny',
            'hunger' => 80,
            'mood' => 80,
            'energy' => 80,
            'exp' => 0,
            'coins' => 100,
            'bag' => ['food_kibble' => 5],
            'owned' => [],
            'equipped' => '',
            'createdAt' => $now,
            'lastSeen' => $now,
        ];
    }

    /**
     * 读取存档；文件缺失或损坏时回落到默认存档
     *
     * @return array
     */
    private static function load(): array
    {
        $path = self::savePath();
        if (!is_file($path)) {
            $state = self::defaultState();
            self::save($state);
            return $state;
        }

        $raw = @file_get_contents($path);
        $data = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($data)) {
            $state = self::defaultState();
            self::save($state);
            return $state;
        }

        return self::normalize($data);
    }

    /**
     * 归一化存档字段（类型纠正 + 缺省补齐），保证后续运算安全
     *
     * @param array $data
     * @return array
     */
    private static function normalize(array $data): array
    {
        $state = array_merge(self::defaultState(), $data);

        $state['name'] = (string)$state['name'];
        $state['hunger'] = self::clamp((int)$state['hunger']);
        $state['mood'] = self::clamp((int)$state['mood']);
        $state['energy'] = self::clamp((int)$state['energy']);
        $state['exp'] = max(0, (int)$state['exp']);
        $state['coins'] = max(0, (int)$state['coins']);
        $state['bag'] = is_array($state['bag']) ? $state['bag'] : [];
        $state['owned'] = is_array($state['owned']) ? $state['owned'] : [];
        $state['equipped'] = is_string($state['equipped']) ? $state['equipped'] : '';
        $state['createdAt'] = (int)$state['createdAt'];
        $state['lastSeen'] = (int)$state['lastSeen'];

        return $state;
    }

    /**
     * 写盘
     *
     * @param array $state
     */
    private static function save(array $state): void
    {
        self::ensureDir();
        $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($json !== false) {
            file_put_contents(self::savePath(), $json);
        }
    }

    /* ============================================================
     * 数值 / 公式工具
     * ============================================================ */

    /**
     * 数值裁剪到 0..100
     *
     * @param int $value
     * @return int
     */
    private static function clamp(int $value): int
    {
        if ($value < self::STAT_MIN) {
            return self::STAT_MIN;
        }
        if ($value > self::STAT_MAX) {
            return self::STAT_MAX;
        }
        return $value;
    }

    /**
     * 从 $level 升到 $level+1 所需经验
     *
     * @param int $level
     * @return int
     */
    public static function expNeed(int $level): int
    {
        return 100 + $level * 50;
    }

    /**
     * 由累计经验推导 [等级, 当前等级内经验]
     *
     * @param int $exp 累计经验
     * @return array{0:int,1:int}
     */
    private static function levelInfo(int $exp): array
    {
        if ($exp < 0) {
            $exp = 0;
        }
        $level = 1;
        $rest = $exp;
        while ($rest >= self::expNeed($level)) {
            $rest -= self::expNeed($level);
            $level++;
        }
        return [$level, $rest];
    }

    /**
     * 由等级推导形态（1~4）
     *
     * @param int $level
     * @return int
     */
    public static function stageOf(int $level): int
    {
        if ($level >= 20) {
            return 4;
        }
        if ($level >= 10) {
            return 3;
        }
        if ($level >= 5) {
            return 2;
        }
        return 1;
    }

    /**
     * 构建对外输出的状态数组（补充 level / stage / expNeed 等派生字段）
     *
     * @param array $s 原始存档
     * @return array
     */
    private static function buildState(array $s): array
    {
        [$level, $expInto] = self::levelInfo((int)$s['exp']);
        $stage = self::stageOf($level);

        return [
            'name' => (string)$s['name'],
            'coins' => (int)$s['coins'],
            'level' => $level,
            'stage' => $stage,
            'stageName' => self::STAGE_NAMES[$stage],
            'hunger' => self::clamp((int)$s['hunger']),
            'mood' => self::clamp((int)$s['mood']),
            'energy' => self::clamp((int)$s['energy']),
            'exp' => $expInto,
            'expNeed' => self::expNeed($level),
            'expIntoLevel' => $expInto,
            'expTotal' => (int)$s['exp'],
            'bag' => $s['bag'],
            'owned' => $s['owned'],
            'equipped' => (string)$s['equipped'],
            'createdAt' => (int)$s['createdAt'],
            'lastSeen' => (int)$s['lastSeen'],
        ];
    }

    /* ============================================================
     * 物品目录
     * ============================================================ */

    /**
     * 食物目录（可重复购买）
     *
     * @return array
     */
    public static function catalogFoods(): array
    {
        return [
            ['id' => 'food_kibble', 'name' => '普通干粮', 'price' => 10, 'hunger' => 20, 'mood' => 0, 'exp' => 5],
            ['id' => 'food_can', 'name' => '香甜罐头', 'price' => 25, 'hunger' => 35, 'mood' => 5, 'exp' => 10],
            ['id' => 'food_cake', 'name' => '奶油蛋糕', 'price' => 40, 'hunger' => 25, 'mood' => 18, 'exp' => 15],
        ];
    }

    /**
     * 玩具目录（永久拥有）
     *
     * @return array
     */
    public static function catalogToys(): array
    {
        return [
            ['id' => 'toy_ball', 'name' => '小皮球', 'price' => 50, 'mood' => 6, 'exp' => 8],
            ['id' => 'toy_bell', 'name' => '铃铛', 'price' => 90, 'mood' => 10, 'exp' => 12],
            ['id' => 'toy_robot', 'name' => '小机器人', 'price' => 160, 'mood' => 16, 'exp' => 20],
        ];
    }

    /**
     * 装扮目录（永久拥有，可穿戴）
     *
     * @return array
     */
    public static function catalogSkins(): array
    {
        return [
            ['id' => 'skin_hat_straw', 'name' => '草帽', 'price' => 80],
            ['id' => 'skin_ribbon', 'name' => '蝴蝶结', 'price' => 120],
            ['id' => 'skin_hat_crown', 'name' => '王冠', 'price' => 200],
        ];
    }

    /**
     * 按 id 查食物定义
     *
     * @param string $id
     * @return array|null
     */
    private static function findFood(string $id): ?array
    {
        foreach (self::catalogFoods() as $item) {
            if ($item['id'] === $id) {
                return $item;
            }
        }
        return null;
    }

    /**
     * 按 id 查玩具定义
     *
     * @param string $id
     * @return array|null
     */
    private static function findToy(string $id): ?array
    {
        foreach (self::catalogToys() as $item) {
            if ($item['id'] === $id) {
                return $item;
            }
        }
        return null;
    }

    /**
     * 按 id 查装扮定义
     *
     * @param string $id
     * @return array|null
     */
    private static function findSkin(string $id): ?array
    {
        foreach (self::catalogSkins() as $item) {
            if ($item['id'] === $id) {
                return $item;
            }
        }
        return null;
    }

    /**
     * 取已拥有玩具中加成（mood）最高的一只
     *
     * @param array $s 原始存档
     * @return array|null
     */
    private static function bestToy(array $s): ?array
    {
        $best = null;
        foreach (self::catalogToys() as $toy) {
            if (empty($s['owned'][$toy['id']])) {
                continue;
            }
            if ($best === null || (int)$toy['mood'] > (int)$best['mood']) {
                $best = $toy;
            }
        }
        return $best;
    }

    /**
     * 组装物品总览（目录 + 存档持有信息）
     *
     * @param array $s 原始存档
     * @return array
     */
    private static function itemsFrom(array $s): array
    {
        return [
            'foods' => self::catalogFoods(),
            'toys' => self::catalogToys(),
            'skins' => self::catalogSkins(),
            'bag' => $s['bag'],
            'owned' => $s['owned'],
            'equipped' => (string)$s['equipped'],
            'coins' => (int)$s['coins'],
        ];
    }

    /* ============================================================
     * 时间衰减
     * ============================================================ */

    /**
     * 依据 lastSeen 与当前时间进行自然衰减并写盘。
     * 每次读取状态、执行动作前都应先调用。
     *
     * @param array $s 原始存档
     * @return array{0:array,1:string} [新存档, 离线文案]
     */
    public static function settle(array $s): array
    {
        $now = time();
        $sec = $now - (int)$s['lastSeen'];
        $offline = '';

        if ($sec > 0) {
            $s['hunger'] = self::clamp((int)$s['hunger'] - intdiv($sec, 60));
            $s['mood'] = self::clamp((int)$s['mood'] - intdiv($sec, 120));
            $s['energy'] = self::clamp((int)$s['energy'] - intdiv($sec, 90));

            if ($sec > 60) {
                $offline = '你离开了 ' . intdiv($sec, 60) . ' 分钟，宠物有些饿了。';
            }
        }

        $s['lastSeen'] = $now;
        self::save($s);

        return [$s, $offline];
    }

    /* ============================================================
     * 对外接口
     * ============================================================ */

    /**
     * 读取状态：GET /pet/state
     *
     * @return array{state:array,offline:string}
     */
    public static function state(): array
    {
        $s = self::load();
        [$s, $offline] = self::settle($s);
        return ['state' => self::buildState($s), 'offline' => $offline];
    }

    /**
     * 执行动作：POST /pet/action
     *
     * @param string $type feed | pet | play | sleep
     * @return array{code:int,msg:string,data:array}
     */
    public static function applyAction(string $type): array
    {
        $s = self::load();
        [$s] = self::settle($s);

        $beforeLevel = self::levelInfo((int)$s['exp'])[0];
        $beforeStage = self::stageOf($beforeLevel);

        $events = [];
        $code = 0;
        $msg = '';

        switch ($type) {
            case 'feed':
                $food = null;
                foreach (self::catalogFoods() as $candidate) {
                    if ((int)($s['bag'][$candidate['id']] ?? 0) > 0) {
                        $food = $candidate;
                        break;
                    }
                }
                if ($food === null) {
                    return self::response(1, '没有食物了，去商店买一些吧', $s, []);
                }
                $remain = (int)$s['bag'][$food['id']] - 1;
                if ($remain > 0) {
                    $s['bag'][$food['id']] = $remain;
                } else {
                    unset($s['bag'][$food['id']]);
                }
                $s['hunger'] = self::clamp((int)$s['hunger'] + (int)$food['hunger']);
                $s['mood'] = self::clamp((int)$s['mood'] + (int)$food['mood']);
                $s['exp'] = (int)$s['exp'] + (int)$food['exp'];
                $events[] = '你喂了宠物一份' . $food['name'];
                break;

            case 'pet':
                $s['mood'] = self::clamp((int)$s['mood'] + 8);
                $s['exp'] = (int)$s['exp'] + 3;
                $s['coins'] = (int)$s['coins'] + 1;
                $events[] = '你轻轻抚摸了宠物，它很开心';
                break;

            case 'play':
                if ((int)$s['energy'] < 15) {
                    return self::response(1, '体力不足，先让它睡一会儿吧', $s, []);
                }
                $toy = self::bestToy($s);
                $bonusMood = $toy !== null ? (int)$toy['mood'] : 0;
                $bonusExp = $toy !== null ? (int)$toy['exp'] : 0;
                $s['energy'] = self::clamp((int)$s['energy'] - 15);
                $s['mood'] = self::clamp((int)$s['mood'] + 12 + $bonusMood);
                $s['exp'] = (int)$s['exp'] + 15 + $bonusExp;
                $s['coins'] = (int)$s['coins'] + 3;
                $events[] = $toy !== null
                    ? '你陪宠物玩了' . $toy['name']
                    : '你陪宠物玩耍了一会儿';
                break;

            case 'sleep':
                $s['energy'] = self::clamp((int)$s['energy'] + 40);
                $s['hunger'] = self::clamp((int)$s['hunger'] - 5);
                $s['mood'] = self::clamp((int)$s['mood'] + 2);
                $events[] = '宠物美美地睡了一觉';
                break;

            default:
                return self::response(1, '未知的动作', $s, []);
        }

        // 升级 / 进化事件
        $afterLevel = self::levelInfo((int)$s['exp'])[0];
        $afterStage = self::stageOf($afterLevel);
        if ($afterLevel > $beforeLevel) {
            $events[] = '升级了！现在是 Lv.' . $afterLevel;
        }
        if ($afterStage !== $beforeStage) {
            $events[] = '进化了！形态变为 ' . self::STAGE_NAMES[$afterStage];
        }

        self::save($s);
        return self::response($code, $msg, $s, $events);
    }

    /**
     * 小游戏结算：POST /pet/minigame
     *
     * @param int $score 小游戏得分
     * @return array{code:int,msg:string,data:array}
     */
    public static function finishMinigame(int $score): array
    {
        if ($score < 0) {
            return ['code' => 1, 'msg' => '分数不合法', 'data' => []];
        }
        if ($score > self::MINIGAME_SCORE_MAX) {
            $score = self::MINIGAME_SCORE_MAX;
        }

        $s = self::load();
        [$s] = self::settle($s);

        $beforeLevel = self::levelInfo((int)$s['exp'])[0];
        $beforeStage = self::stageOf($beforeLevel);

        $rewardCoins = intdiv($score, 2);
        $s['coins'] = (int)$s['coins'] + $rewardCoins;
        $s['exp'] = (int)$s['exp'] + $score;
        $s['mood'] = self::clamp((int)$s['mood'] + 5);
        $s['energy'] = self::clamp((int)$s['energy'] - 10);

        $events = ['小游戏结束，得分 ' . $score . '，获得 ' . $rewardCoins . ' 金币'];

        $afterLevel = self::levelInfo((int)$s['exp'])[0];
        $afterStage = self::stageOf($afterLevel);
        if ($afterLevel > $beforeLevel) {
            $events[] = '升级了！现在是 Lv.' . $afterLevel;
        }
        if ($afterStage !== $beforeStage) {
            $events[] = '进化了！形态变为 ' . self::STAGE_NAMES[$afterStage];
        }

        self::save($s);

        return [
            'code' => 0,
            'msg' => '',
            'data' => [
                'state' => self::buildState($s),
                'events' => $events,
                'reward' => ['coins' => $rewardCoins, 'exp' => $score],
            ],
        ];
    }

    /**
     * 商店 / 穿戴：POST /pet/shop
     *
     * @param string $action buy | equip
     * @param string $item 物品 id；equip 时传 '' 表示卸下
     * @return array{code:int,msg:string,data:array}
     */
    public static function shop(string $action, string $item): array
    {
        $s = self::load();
        [$s] = self::settle($s);

        $code = 0;
        $msg = '';

        if ($action === 'buy') {
            $food = self::findFood($item);
            if ($food !== null) {
                // 食物可重复购买
                if ((int)$s['coins'] < (int)$food['price']) {
                    $code = 1;
                    $msg = '金币不足';
                } else {
                    $s['coins'] = (int)$s['coins'] - (int)$food['price'];
                    $s['bag'][$item] = (int)($s['bag'][$item] ?? 0) + 1;
                }
            } else {
                $def = self::findToy($item) ?? self::findSkin($item);
                if ($def === null) {
                    $code = 1;
                    $msg = '物品不存在';
                } elseif (!empty($s['owned'][$item])) {
                    $code = 1;
                    $msg = '已经拥有该物品';
                } elseif ((int)$s['coins'] < (int)$def['price']) {
                    $code = 1;
                    $msg = '金币不足';
                } else {
                    $s['coins'] = (int)$s['coins'] - (int)$def['price'];
                    $s['owned'][$item] = true;
                }
            }
        } elseif ($action === 'equip') {
            if ($item === '') {
                // 卸下装扮
                $s['equipped'] = '';
            } elseif (self::findSkin($item) === null || empty($s['owned'][$item])) {
                $code = 1;
                $msg = '尚未拥有该装扮';
            } else {
                $s['equipped'] = $item;
            }
        } else {
            $code = 1;
            $msg = '未知的操作';
        }

        if ($code === 0) {
            self::save($s);
        }

        return [
            'code' => $code,
            'msg' => $msg,
            'data' => [
                'state' => self::buildState($s),
                'items' => self::itemsFrom($s),
            ],
        ];
    }

    /**
     * 物品总览：GET /pet/items
     *
     * @return array
     */
    public static function items(): array
    {
        $s = self::load();
        [$s] = self::settle($s);
        return self::itemsFrom($s);
    }

    /**
     * 重置存档为默认值
     *
     * @return array{state:array}
     */
    public static function reset(): array
    {
        $s = self::defaultState();
        self::save($s);
        return ['state' => self::buildState($s)];
    }

    /**
     * 统一构造动作类响应体
     *
     * @param int $code
     * @param string $msg
     * @param array $s 原始存档
     * @param array $events 事件文案
     * @return array{code:int,msg:string,data:array}
     */
    private static function response(int $code, string $msg, array $s, array $events): array
    {
        return [
            'code' => $code,
            'msg' => $msg,
            'data' => [
                'state' => self::buildState($s),
                'events' => $events,
            ],
        ];
    }
}