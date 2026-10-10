# 评测集 (eval/samples)

`truth.json` 是样本清单,每条样本一个对象:

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识,也是日志里的行名 |
| `type` | `text` / `photo` / `receipt` / `grocery` |
| `set` | `chain`(连锁,官方营养表为 ground truth)或 `aux`(食堂/中餐,USDA 相近条目人工标注) |
| `content` | 仅 `text`:一句话输入 |
| `file` | 仅照片类:`eval/samples/` 下的图片文件名(jpg/png/webp,会原样上传) |
| `merchant` | 真实商家名,无则 `null` |
| `kcal`, `protein_g` | 真实值(整份餐食合计) |
| `amount_usd` | 真实金额,输入里没有价格就填 `null` |
| `items_count` | 仅 `receipt`:小票上属于用户的菜品数 |
| `truth_source` | 真值来源(官网页面 / USDA 条目 + 算式) |

## 怎么建 30 份照片样本

1. 去 Chipotle / McDonald's 等连锁点一份**配料明确**的餐,拍一张餐食照 + 一张小票照。
2. 在官网营养计算器里查出这份餐的真实 kcal / protein,写进 `truth.json`。
3. 图片放进 `eval/samples/`,文件名写到 `file` 字段。
4. 食堂/中餐:用 USDA FoodData Central 找最接近的条目,按份量算出真值,`set` 填 `aux`。

当前自带的 16 条 `text` 样本以 `chains.json` 作真值,只能检验"匹配 + 算术"链路,不能代替照片集。

## 运行

```bash
npm run eval                 # 跑全部样本(需要 ANTHROPIC_API_KEY)
npm run eval -- --only text  # 只跑某种 type
npm run eval -- --log "v2: 收窄 high 置信度宽度"   # 结果追加到 eval/log.md
npm run eval -- --from eval/results/<file>.json    # 用缓存结果重算指标,不调 API
ESTIMATE_MOCK=1 npm run eval # 用 mock 跑通流程(指标无意义)
```

每次运行都会把原始结果存到 `eval/results/`,方便事后对比。
