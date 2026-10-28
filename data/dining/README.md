# 食堂数据(data/dining)

三级估算的第二级:学校食堂的官方菜品营养。目前只有芝加哥大学(`uchicago/`)。

| 文件 | 内容 |
| --- | --- |
| `uchicago/halls.json` | 可选的食堂(Baker / Bartlett / Woodlawn / Cathey):slug、别名、Dine On Campus location id。客户端和服务端都读它 |
| `uchicago/catalog.json` | 菜品库:640 道食堂菜,每道一行 `{id, name, portion, kcal, protein_g}`,来自 Dine On Campus 的官方每份营养。只在服务端读,随 prompt 一起(作为第二个缓存块)传给模型 |

## 它是什么、不是什么

- **是**菜品库:本学期在四个食堂菜单上出现过的菜,每份的官方份量 / 热量 / 蛋白质。模型负责判断"盘子里是库里哪几道、各几份",算术由代码做,标 `dining_menu` + 中置信度 + ±20%。
- **不是**每日菜单:不记录哪天哪个食堂有哪道菜。原因见下。
- 2026-10-28 抽查了 4 道菜(Scrambled Eggs、Meatless Vegetarian Sausage Patty、Maple Smoked Beef and Pork Sausage、Tater Tots),份量 / 热量 / 蛋白质与网站自己的营养面板完全一致。

## 为什么是快照、为什么没有每日菜单

- `apiv4.dineoncampus.com` 在 Cloudflare 后面,非浏览器客户端直接 403,也没有给其他域名的 CORS。所以 Vercel 服务端和 PWA 都不能实时拉,只能像 `chains.json` 一样把数据放进仓库。
- 在浏览器里直接请求它的 API,单个菜品对象(名字 / 份量 / 营养)是准的,但"某天某档口有哪些菜"的列表被打乱了(混进其他日期和食堂的菜)。这是网站自己的请求签名才能拿到的部分,我们不绕,所以只保留菜品对象。
- 四个食堂里 Cathey 整周菜单为空;Bartlett 里一个贝果 / 咖啡零售品牌的 72 行没有蛋白质数据,去掉了。

## 怎么刷新

1. 浏览器打开 dineoncampus.com/uchicago → What's On The Menu,随便点开一个食堂。
2. 在同一页面的控制台里按 halls.json 的 location id,对一周的日期逐个请求 `/locations/{id}/periods/?date=YYYY-MM-DD` 和 `/locations/{id}/menu?date=...&period=...`,把 `period.categories[].items[]` 里的 `{mrnFull, name, portion, nutrients[Calories, Protein (g)]}` 收起来,按 `mrnFull` 去重。
3. 去掉 `Protein (g)` 为空的行,写成 `catalog.json` 的格式,更新 `_meta.pulled_on`,再随机点开几道菜和网站的营养面板对一遍。
4. `npm test` 里有一条用 Scrambled Eggs(210 kcal / 14 g)做锚的测试,数据变了会提醒。

换学校:Dine On Campus 覆盖全美几百所学校,只换 `halls.json` 和 `catalog.json`,代码不用动。
