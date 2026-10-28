# 30 张照片评测集:拍摄清单

目的:**先测量,再决定要不要动模型。** 现在评测集里只有文字样本和 1 张合成小票,"拍照准确率不高"还是一个猜测。
拍完这 30 张,`npm run eval -- --only photo` 跑出来的命中率和区间宽度,才是拍照这条链路的基线。

## 拍法(每张都一样)

- 手机正常高度、约 45° 俯拍,整盘入镜,不用摆盘。这就是用户会拍的角度,别拍得比用户好。
- 连锁:拍餐 + 拍小票各一张(小票那张进 receipt 集)。食堂:拍餐盘一张,**打菜时按官方份量打**(一勺 = 菜单上的 1/2 cup,两片培根就是两片),当场记下每样几份。
- 文件放 `eval/samples/photos/`(已 gitignore),文件名 = 下表 id + `.jpg`。
- 真值写进 `truth.json`,`truth_source` 写清算式。

## 清单

### 连锁(12 张,`set: "chain"`,官方营养计算器为真值)

| id | 怎么点 |
| --- | --- |
| photo-chipotle-chicken-bowl | Chicken + White Rice + Black Beans + Fresh Tomato Salsa + Cheese + Lettuce |
| photo-chipotle-steak-bowl | Steak + Brown Rice + Pinto Beans + Sour Cream + Guac |
| photo-chipotle-chicken-burrito | 标准鸡肉卷饼 |
| photo-chipotle-chips-guac | Chips & Guacamole 单独一份 |
| photo-mcd-big-mac-fries | Big Mac + 中薯 |
| photo-mcd-nuggets-10 | 10 块麦乐鸡 |
| photo-mcd-qpc | Quarter Pounder with Cheese |
| photo-shake-shack-shackburger | ShackBurger 单层 + 薯条 |
| photo-shake-shack-chicken | Chicken Shack |
| photo-sweetgreen-harvest-bowl | Harvest Bowl 不改配料 |
| photo-sweetgreen-chicken-pesto | Chicken Pesto Parm |
| photo-kfc-2pc-combo | 2 块原味鸡 + 土豆泥 |

### 食堂(12 张,`set: "dining"`,`catalog.json` 官方每份数据为真值,`dining_hall` 必填)

| id | 食堂 | 打什么(按菜品库的一份打) |
| --- | --- | --- |
| photo-baker-breakfast-eggs | Baker | Scrambled Eggs 2 勺 + Bacon 3 片 + Tater Tots 1/2 cup |
| photo-baker-breakfast-oats | Baker | Oatmeal 1 ladle + Plain Greek Yogurt 1/2 cup + Banana |
| photo-baker-lunch-chicken | Baker | Grilled Herbed Chicken 3 oz ×2 + White Rice 1/2 cup + Steamed Broccoli |
| photo-baker-dinner-mixed | Baker | 当天主菜一份 + 两个配菜,各记份数 |
| photo-bartlett-breakfast | Bartlett | Eggs Your Way ×2 + Turkey Breakfast Sausage + Breakfast Potatoes |
| photo-bartlett-lunch-burger | Bartlett | Hamburger on Bun + French Fries 1/2 cup |
| photo-bartlett-lunch-bowl | Bartlett | Brown Rice + Soy Ginger Glazed Chicken Breast + Roasted Broccoli |
| photo-bartlett-dinner-pasta | Bartlett | Penne Pasta 1 cup + Marinara + Italian Meatballs ×3 |
| photo-woodlawn-lunch-salad | Woodlawn | Romaine Blend 2 cup + Grilled Chicken + Creamy Caesar 1 floz + Croutons |
| photo-woodlawn-dinner-meatloaf | Woodlawn | Turkey Meatloaf + Mashed Potatoes 3/4 cup + Roasted Brussels Sprouts |
| photo-woodlawn-pizza | Woodlawn | Pepperoni Pizza 2 片 |
| photo-dining-half-portions | 任一 | 故意只打半份(半勺蛋、一片培根),测份数估计 |

### 辅助(6 张,`set: "aux"`,USDA FoodData Central 相近条目人工算真值)

| id | 场景 |
| --- | --- |
| photo-aux-fried-rice | 中餐外卖炒饭一盒(称一下重量) |
| photo-aux-kungpao | 宫保鸡丁 + 米饭 |
| photo-aux-home-stirfry | 自炊番茄炒蛋 + 米饭(食材称重算) |
| photo-aux-home-chicken | 自炊烤鸡胸(生重称过)+ 蔬菜 |
| photo-aux-ramen | 一碗拉面 |
| photo-aux-pizza-slice | 披萨一片(非连锁) |

## 跑完以后看什么

1. 蛋白质区间命中率:chain / dining / aux 分开看。PRD 目标 ≥ 85%,dining 第一次跑大概率到不了,那就是真实基线。
2. 误差来自哪里:逐条看 `eval/results/*.json`,分成"认错菜"(dining_match 为 null 或匹配错)和"份数估错"(匹配对了但 qty 偏)。预期大头在份数。
3. 份数误差的修法按投入产出排:份量追问(一勺还是两勺)→ 把自己拍的 5-10 张带真值照片放进 prompt 当锚点 → 按类别算系统偏差做校正。爬图训模型不在这条线上。
