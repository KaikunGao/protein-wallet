# 蛋白钱包 ProteinWallet

给在健身房练、想增肌、生活费有限的大学生和年轻人:蛋白粉一天一勺只补得上需求的两成,剩下的七八成得从三餐来,而同样一克蛋白在三餐内部差 10 倍(鸡蛋约 9 分,食堂 25-50,外卖约 100)。拍一张餐食、外卖订单或小票,同时记下花销和营养(热量 / 蛋白质区间),回答一个问题:
**在每月 2000 元左右的生活费里,每一块钱换到了多少克蛋白质。**

- 主线调整(2026-11-04,见 PRD):从"记下吃了什么"转为"预算内吃什么"。吃之前的决策功能里,下一顿卡片(`lib/next-meal.ts`)和拍菜单做决策(`/api/menu`、`lib/estimate/menu.ts`、`lib/menu-rank.ts`:模型读菜名价格并拆蛋白来源,代码查 `data/ingredients.json` / `data/street.json` 算数并按 分/g 排序)已上线,拍过的菜单会存成"常去的地方"(IndexedDB v2 的 `menus` 表),首页每天把存过的菜和记过的餐一起按 分/g 排,不用再拍;存过的地方可以生成分享链接(`lib/menu-share.ts`,菜单压缩后放在链接尾部,不经服务器,导入时逐项校验),新用户首页带一份内置起步清单(`data/starter.json`,参考价,只在冷启动时补位);首屏有"先看示例"(`data/demo-orders.json`:13 张真实外卖订单经应用自己的小票流程解析,`lib/demo.ts`),小票和订单截图的菜价按实付合计分摊(`allocateToPaid`);拍营养成分表尚未实现;两张食材表是参考数据,未逐行核对《中国食物成分表》;现有的记录和周报保留,成为决策的数据来源
- 核心指标:蛋白质单价 **分/g**
- 设计哲学:诚实的模糊,所有估算都是「区间 + 置信度 + 依据」,永不假装精确
- 三级估算:先匹配连锁官方营养表(`data/chains.json`),再匹配学校食堂官方菜品库(`data/dining/`),都匹配不上才让模型目测;算术一律由代码完成
- 2026-11-04 起只做国内:货币只有人民币,界面里没有美元、餐卡 meal plan 和芝大食堂选择;`data/chains.json`(美国连锁)和 `data/dining/`(芝大食堂库)作为 v1 的数据层和三级估算的机制保留,国内连锁官方表和国内高校食堂菜品库按 PRD「国内版」排期替换
- 不做:生成饮食建议(只允许纯代码对官方数据排序)、热量警告、评判性文案、微量营养素、社交(见 PRD Non-goals)
- 补剂与决策(2026-11-04):蛋白粉一键预设(设置里照标签填一次,首页一键记一勺,来源 `label`)、周报里补剂单列一行不进食物排名(`lib/supplement.ts`)、周报一键问题记 `decision_changed` 事件
- 记录留存三件套(2026-11-04):日结模式(一句话记一天,`batch` 请求 + prompt v4)、常吃清单(首页最近 30 天按次数取 5 条一键复记)、即时回报(保存后显示本周 分/g 排名 + 差额换算成自己历史里最便宜的食物,`lib/feedback.ts`)

产品需求文档见仓库上一级目录的 PRD。每次更新的内容、原因和简历可用的素材都记在 [CHANGELOG.md](CHANGELOG.md)。

## 技术栈

Next.js 16 (App Router) + TypeScript + Tailwind v4 · Anthropic API(`@anthropic-ai/sdk`,结构化输出 + zod 校验)· IndexedDB(`idb`,单用户本地存储)· PWA(manifest + 图标)

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入 ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

没有 key 时可以在 `.env.local` 里设 `ESTIMATE_MOCK=1`,路由会返回固定的假估算,用来跑通界面。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `npm run build` | 开发 / 生产构建 |
| `npm test` | 离线单元测试:估算后处理(连锁匹配、区间宽度规则、金额守卫)+ 周报手算对照 + 保存后即时回报手算对照 + 下一顿卡片手算对照 + 拍菜单(查表、后处理、排序)+ 分享链接与起步清单 + 实付分摊与示例数据 |
| `npm run eval` | 评测脚本,见 [eval/README.md](eval/README.md) |
| `npm run lint` | ESLint |

## 目录

```
app/            页面:/ 今日  /log 记录流  /weekly 周报  /settings 设置  /api/estimate 估算路由
components/     Onboarding、ConfirmCard(可编辑确认卡 + 一键份量修正)、MealEditor(改已保存记录)、ConfidenceBadge、BottomNav、VoiceButton(Web Speech API 语音输入,不支持的浏览器不显示)
lib/db.ts       IndexedDB:meals / settings / events,导出导入
lib/estimate/   schema(zod)、prompt、chains 匹配、estimate(调模型 + 后处理)、mock
lib/derive.ts   今日差额、周花销、分/g;lib/weekly.ts 周报;lib/feedback.ts 保存后即时回报(本周排名 + 差额换算);lib/supplement.ts 蛋白粉预设与补剂判定;lib/next-meal.ts 下一顿卡片(今天可花金额 + 按 分/g 排序);lib/menu-rank.ts 菜单排序(浏览器里算);lib/estimate/menu.ts 菜单解析(服务端);lib/money.ts 货币(只有人民币,¥ 和 分/g;字段名 amount_usd 等沿用,含义是元);lib/share-image.ts 周报分享图(canvas 1080×1350)
data/chains.json  17 家连锁营养数据;data_status 决定能不能标"官方":official 5 家(Chipotle / McDonald's / Shake Shack / Sweetgreen / KFC)、partial 3 家、unverified 9 家
data/dining/      芝大食堂:halls.json(4 个食堂)+ catalog.json(640 道菜的官方每份营养,Dine On Campus 快照),见 data/dining/README.md
eval/           评测集(samples/truth.json)、评测脚本(run.ts)、迭代日志(log.md)
docs/使用说明.md  给种子用户的一页说明
```

## 估算 API

`POST /api/estimate`,body `{ type: "text" | "photo" | "receipt" | "grocery", content, media_type?, dining_hall?, currency? }`,
照片类 `content` 为 base64(可带 `data:` 前缀);`dining_hall` 是食堂 slug(`data/dining/uchicago/halls.json`),只对 photo / text 生效;
`currency` 只接受 `CNY`(`amount_usd` / `total_usd` 字段名沿用,值是元,见 `lib/money.ts`);`dining_hall` 目前客户端不再发送,国内食堂菜品库建好后再启用。返回:

```json
{ "ok": true, "kind": "meal", "merchant": "Chipotle", "total_usd": 11.5,
  "items": [{ "meal_name": "鸡肉碗", "amount_usd": 11.5, "kcal_low": 594, "kcal_high": 726,
              "protein_low_g": 46, "protein_high_g": 56, "confidence": "high",
              "basis": "Chipotle 官方营养表:Chicken + White Rice + ...", "source": "official_table",
              "portion": { "unit": "份", "assumed": 1, "unsure": false } }] }
```

失败时 `{ ok: false, error, retryable }`。模型输出用 zod schema 校验,失败自动重试一次。

`source` 一共五档,对应界面上的标签:

| source | 什么时候 | 置信度 / 区间 | 标签 |
| --- | --- | --- | --- |
| `official_table` | 匹配到 `data_status: official` 的连锁 | high,±10% | 官方数据 |
| `reference_table` | 匹配到 partial / unverified 的连锁 | medium,±15% | 参考数据·未核实 |
| `dining_menu` | 请求带 `dining_hall`,模型把每道菜对到菜品库 | medium,±20%(每份数据官方,份数目测) | 食堂菜单 |
| `visual_estimate` / `text_estimate` | 都匹配不上 | 照片强制 low;文字最高 medium | 目测估算 |

其他硬规则(`lib/estimate/estimate.ts`):置信度对应最小相对宽度 high 15% / medium 30% / low 50%;文字里没有数字就绝不报金额。
食堂菜品库只在带 `dining_hall` 的请求里作为第二个缓存的 system 块发给模型(约 8k token,命中缓存后很便宜)。

## 部署到 Vercel

1. 把仓库推到 GitHub,在 Vercel 里 Import。
2. 环境变量加 `ANTHROPIC_API_KEY`(不要加 `ESTIMATE_MOCK`)。
3. 部署后用手机浏览器打开,iOS Safari「分享 → 添加到主屏幕」,Android Chrome「安装应用」。

## 数据

全部数据只在浏览器的 IndexedDB 里,没有账号。设置页可导出 / 导入 JSON(含 meals、settings、events 埋点)。

## 实施进度

| Step | 内容 | 状态 |
| --- | --- | --- |
| 1.1 – 1.6 | 项目初始化、数据层、引导、估算 API、文字记录流、今日页 | 完成 |
| 2.1 – 2.3 | chains.json、照片 / 小票 / 买菜小票分支 | 完成;2026-10-28 起 9 家未核实连锁降级为"参考数据" |
| 2.4 | 芝大食堂菜品库 + 记录时选食堂(第三级数据源) | 完成 2026-10-28;菜品库是手动快照,刷新方法见 data/dining/README.md |
| 3.1 – 3.2 | 评测集结构 + 评测脚本 | 完成;30 张照片按 eval/samples/PLAN.md 采集,拍完才有拍照基线 |
| 3.3 | 周报页 | 完成 |
| 2.5 | 语音输入、货币选择、份量追问(模型给 portion,确认卡一键 ×0.5/1/1.5/2)、再来一份、记录可编辑、餐卡算每次刷卡单价、周报分享图、整体视觉重做 | 完成 2026-10-28 |
| 国内 | 人民币唯一货币、麦当劳中国官方表 76 行、日结模式 / 常吃清单 / 即时回报、蛋白粉预设 / 补剂单列 / decision_changed | 完成 2026-11-04 |
| 4.x | 种子用户 | 运营阶段,见 docs/使用说明.md |
