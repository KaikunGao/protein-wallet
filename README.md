# 蛋白钱包 ProteinWallet

拍一张餐食或小票照片,同时记下花销和营养(热量 / 蛋白质区间),回答一个问题:
**在有限的生活费里,每一美元换到了多少克蛋白质。**

- 核心指标:蛋白质单价 **¢/g**
- 设计哲学:诚实的模糊,所有估算都是「区间 + 置信度 + 依据」,永不假装精确
- 两级估算:先匹配连锁官方营养表(`data/chains.json`,算术由代码完成),无匹配再让模型目测
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
components/     Onboarding、ConfirmCard(可编辑确认卡)、ConfidenceBadge、BottomNav
lib/db.ts       IndexedDB:meals / settings / events,导出导入
lib/estimate/   schema(zod)、prompt、chains 匹配、estimate(调模型 + 后处理)、mock
lib/derive.ts   今日差额、周花销、¢/g;lib/weekly.ts 周报
data/chains.json  16 家连锁营养数据(每家有 verified 字段标明验证状态;McDonald's / Shake Shack / Sweetgreen 为官方全量核对)
eval/           评测集(samples/truth.json)、评测脚本(run.ts)、迭代日志(log.md)
docs/使用说明.md  给种子用户的一页说明
```

## 估算 API

`POST /api/estimate`,body `{ type: "text" | "photo" | "receipt" | "grocery", content, media_type? }`,
照片类 `content` 为 base64(可带 `data:` 前缀)。返回:

```json
{ "ok": true, "kind": "meal", "merchant": "Chipotle", "total_usd": 11.5,
  "items": [{ "meal_name": "鸡肉碗", "amount_usd": 11.5, "kcal_low": 594, "kcal_high": 726,
              "protein_low_g": 46, "protein_high_g": 56, "confidence": "high",
              "basis": "Chipotle 官方营养表:Chicken + White Rice + ...", "source": "official_table" }] }
```

失败时 `{ ok: false, error, retryable }`。模型输出用 zod schema 校验,失败自动重试一次。
代码层的硬规则(`lib/estimate/estimate.ts`):官方匹配 ±10%;置信度对应最小相对宽度 high 15% / medium 30% / low 50%;
照片无连锁匹配强制 low;文字里没有数字就绝不报金额。

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
| 2.1 – 2.3 | chains.json、照片 / 小票 / 买菜小票分支 | 完成(模型真实调用待 key 验收) |
| 3.1 – 3.2 | 评测集结构 + 评测脚本 | 完成;30 份照片样本需人工采集 |
| 3.3 | 周报页 | 完成 |
| 4.x | 种子用户 | 运营阶段,见 docs/使用说明.md |
