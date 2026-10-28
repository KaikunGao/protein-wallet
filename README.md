# 蛋白钱包 ProteinWallet

给生活费有限、想增肌的在校大学生:拍一张餐食或小票照片,同时记下花销和营养(热量 / 蛋白质区间),回答一个问题:
**在有限的生活费里,每一美元换到了多少克蛋白质。**

- 核心指标:蛋白质单价 **¢/g**
- 设计哲学:诚实的模糊,所有估算都是「区间 + 置信度 + 依据」,永不假装精确
- 三级估算:先匹配连锁官方营养表(`data/chains.json`),再匹配学校食堂官方菜品库(`data/dining/`),都匹配不上才让模型目测;算术一律由代码完成
- v1 做美国校园(美元 + 美国连锁 + 芝大食堂);国内校园版在 roadmap
- 不做:饮食推荐、热量警告、评判性文案、微量营养素、社交(见 PRD Non-goals)

产品需求文档见仓库上一级目录的 PRD。

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
| `npm test` | 离线单元测试:估算后处理(连锁匹配、区间宽度规则、金额守卫)+ 周报手算对照 |
| `npm run eval` | 评测脚本,见 [eval/README.md](eval/README.md) |
| `npm run lint` | ESLint |

## 目录

```
app/            页面:/ 今日  /log 记录流  /weekly 周报  /settings 设置  /api/estimate 估算路由
components/     Onboarding、ConfirmCard(可编辑确认卡 + 一键份量修正)、MealEditor(改已保存记录)、ConfidenceBadge、BottomNav、VoiceButton(Web Speech API 语音输入,不支持的浏览器不显示)
lib/db.ts       IndexedDB:meals / settings / events,导出导入
lib/estimate/   schema(zod)、prompt、chains 匹配、estimate(调模型 + 后处理)、mock
lib/derive.ts   今日差额、周花销、¢/g;lib/weekly.ts 周报;lib/money.ts 货币(美元 / 人民币,只管符号和 ¢/g 或 分/g,不做汇率);lib/share-image.ts 周报分享图(canvas 1080×1350)
data/chains.json  17 家连锁营养数据;data_status 决定能不能标"官方":official 5 家(Chipotle / McDonald's / Shake Shack / Sweetgreen / KFC)、partial 3 家、unverified 9 家
data/dining/      芝大食堂:halls.json(4 个食堂)+ catalog.json(640 道菜的官方每份营养,Dine On Campus 快照),见 data/dining/README.md
eval/           评测集(samples/truth.json)、评测脚本(run.ts)、迭代日志(log.md)
docs/使用说明.md  给种子用户的一页说明
```

## 估算 API

`POST /api/estimate`,body `{ type: "text" | "photo" | "receipt" | "grocery", content, media_type?, dining_hall?, currency? }`,
照片类 `content` 为 base64(可带 `data:` 前缀);`dining_hall` 是食堂 slug(`data/dining/uchicago/halls.json`),只对 photo / text 生效;
`currency` 是 `USD` / `CNY`,决定 `amount_usd` / `total_usd` 字段里的币种(字段名沿用,不换算,见 `lib/money.ts`)。返回:

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
| 4.x | 种子用户 | 运营阶段,见 docs/使用说明.md |
