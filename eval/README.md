# 评测集 (eval/samples)

`truth.json` 是样本清单,每条样本一个对象:

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识,也是日志里的行名 |
| `type` | `text` / `photo` / `receipt` / `grocery` |
| `set` | `chain`(连锁,官方营养表为 ground truth)、`dining`(食堂,`data/dining/uchicago/catalog.json` 官方每份数据为 ground truth)或 `aux`(中餐/家常菜,USDA 相近条目人工标注) |
| `dining_hall` | 仅 `dining`:食堂 slug(见 `data/dining/uchicago/halls.json`),会随请求一起发给估算函数 |
| `content` | 仅 `text`:一句话输入 |
| `file` | 仅照片类:`eval/samples/` 下的图片文件名(jpg/png/webp,会原样上传) |
| `merchant` | 真实商家名,无则 `null` |
| `kcal`, `protein_g` | 真实值(整份餐食合计) |
| `amount_usd` | 真实金额,输入里没有价格就填 `null` |
| `items_count` | 仅 `receipt`:小票上属于用户的菜品数 |
| `truth_source` | 真值来源(官网页面 / USDA 条目 + 算式) |

## 怎么建 30 份照片样本

拍摄清单和拍法见 [PLAN.md](samples/PLAN.md):12 张连锁、12 张食堂、6 张辅助。照片放 `eval/samples/photos/`(已 gitignore),文件名写到 `file` 字段。

- 连锁:在官网营养计算器里查出这份餐的真实 kcal / protein。
- 食堂:打菜时按菜品库的一份打,真值 = 各份官方数据相加(`catalog.json`)。
- 中餐/家常菜:用 USDA FoodData Central 找最接近的条目,按份量算出真值,`set` 填 `aux`。

当前自带的 16 条 chain `text` 样本以 `chains.json` 作真值、4 条 dining `text` 样本以 `catalog.json` 作真值,只能检验"匹配 + 算术"链路,不能代替照片集。注意 9 家凭记忆录入的连锁(`data_status: unverified`)的 text 样本,真值和参考表同源,命中只说明算术对,不说明数据对。

## 运行

```bash
npm run eval                 # 跑全部样本(需要 ANTHROPIC_API_KEY)
npm run eval -- --only text  # 只跑某种 type
npm run eval -- --set dining # 只跑某个 set(chain / dining / aux)
npm run eval -- --log "v2: 收窄 high 置信度宽度"   # 结果追加到 eval/log.md
npm run eval -- --from eval/results/<file>.json    # 用缓存结果重算指标,不调 API
ESTIMATE_MOCK=1 npm run eval # 用 mock 跑通流程(指标无意义)
```

每次运行都会把原始结果存到 `eval/results/`,方便事后对比。
