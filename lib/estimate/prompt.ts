import type Anthropic from "@anthropic-ai/sdk";
import { chainsForPrompt } from "./chains";
import { catalogForPrompt, findHall } from "./dining";
import type { EstimateInput } from "./schema";

// PROMPT_VERSION is logged by the eval script so each iteration is traceable in eval/log.md.
// v2 (2026-10-28): user = 在校大学生; dining-hall menu tier (dining_match); unverified chains
// are no longer presented as official.
export const PROMPT_VERSION = "v2";

const RULES = `你是「蛋白钱包」的营养与消费解析器。用户是美国校园里生活费有限、想增肌的在校大学生,会给你一句话、一张餐食照片、一张餐厅小票,或一张买菜小票。任务:识别吃了什么、花了多少钱,并给出热量和蛋白质的**区间**估算。

## 输出
只返回符合给定 schema 的 JSON,不要任何解释文字。

## 核心规则
1. 诚实的模糊:永远输出区间,禁止单点值(low 必须明显小于 high)。区间宽度与置信度挂钩,相对宽度 = (high - low) / 中点:
   - high(连锁餐、有官方数据):约 15%-25%
   - medium(菜名明确但份量/做法不确定;食堂菜单匹配):约 30%-50%
   - low(纯目测、家常菜、自助餐):约 50%-80%
   宁宽勿窄:不确定就拉宽区间、调低置信度,不要假装精确。
2. 禁止猜测金额:只有当输入里明确出现价格(文字里的数字、小票上的金额)时才填 amount_usd,否则一律 null。餐食照片通常没有价格,就填 null。
3. 三级估算:
   a. 先匹配连锁:如果能确定商家是下方参考表里的连锁(文字提到、小票商家名、照片里的包装或 logo),把 chain_match.merchant 填成参考表里 merchant 的原文,components 填参考表里 name 的原文和数量 qty。组合餐拆成组件,例如 Chipotle 鸡肉碗 = Chicken + White Rice + Black Beans + Fresh Tomato Salsa + Cheese + Romaine Lettuce;配料不明时按最常见搭配,并在 basis 里说明假设。Subway footlong = 对应 6-inch 项 qty 2。表里 kcal 为 0 的行只是价格参考,不能当组件。
      匹配了连锁也仍要按参考表填 kcal/protein 区间,代码会用官方数据复核。
   b. 再匹配食堂菜品库:如果系统提示里附了「食堂菜品库」且用户消息说明这餐在某食堂,把盘子里的每道菜单独作为一个 item,dining_match.hall 填食堂名,items[].name 填菜品库里菜名的**原文**(含括号里的份量),qty 填份数(以菜品库标注的一份份量为单位,可用小数,例如半份 0.5、两勺 2)。看不出是库里哪道菜、或库里没有的,该 item 的 dining_match 填 null,按目测估算。份数是目测的,所以 confidence 最高 medium。
   c. 都匹配不上时 chain_match 和 dining_match 都填 null,按食物类型和份量目测给宽区间、低置信度。家常菜/食堂菜在 basis 里写明"目测估算"。
   没有食堂菜品库时 dining_match 一律 null。
4. 多菜品:小票上每道菜单独一项(items 数组),饮料、小食也各一项;税和小费不作为 item,但 total_usd 填小票总额。一句话里提到多样食物也拆成多项。
5. 识别失败:照片看不清、不是食物、小票无法读取时,error 填一句中文原因,items 留空,绝不编造。
6. 买菜小票(grocery):只解析 merchant、total_usd、grocery_ingredients(食材清单),items 留空,不做营养估算。其他类型 grocery_ingredients 填 null。
7. 文案:meal_name 用简短中文(可保留品牌或菜名原文),basis 一句中文说明依据,例如"Chipotle 官方营养表,按鸡肉+白米+黑豆估算"、"Baker 食堂菜单:炒蛋两份 + 火鸡培根三片"或"家常炒菜目测,份量约一盘"。merchant 填商家名原文(食堂填食堂名),不确定则 null。

## 连锁参考表(每份;标 [未核实] 的连锁数据来自记忆,代码会降级为中置信度)
`;

/** The hall this request is about, or null (receipts/grocery never use the dining tier). */
export function diningHall(input: EstimateInput) {
  if (input.type === "receipt" || input.type === "grocery") return null;
  return findHall(input.dining_hall);
}

/**
 * System prompt: rules + chains table (always), plus the dining catalog when the
 * request is about a dining hall. Both blocks are stable text, so each gets its
 * own cache breakpoint and is read from cache after the first call.
 */
export function systemBlocks(input?: EstimateInput): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: RULES + chainsForPrompt(), cache_control: { type: "ephemeral" } },
  ];
  if (input && diningHall(input)) {
    blocks.push({ type: "text", text: catalogForPrompt(), cache_control: { type: "ephemeral" } });
  }
  return blocks;
}

export function userContent(input: EstimateInput): Anthropic.ContentBlockParam[] {
  const hall = diningHall(input);
  const dining = hall ? `这餐吃的是学校食堂:${hall.name}(${hall.short})。请用系统提示里的食堂菜品库做 dining_match。` : null;
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (dining) blocks.push({ type: "text", text: dining });
  if (input.type === "text") {
    blocks.push({ type: "text", text: `用户输入:「${input.content}」` });
    return blocks;
  }
  const image: Anthropic.ImageBlockParam = {
    type: "image",
    source: {
      type: "base64",
      media_type: input.media_type ?? "image/jpeg",
      data: input.content,
    },
  };
  const text =
    input.type === "photo"
      ? dining
        ? "这是用户在这家食堂打的餐盘照片。按菜品库逐道识别并估份数;照片里没有价格,amount_usd 填 null。"
        : "这是用户的餐食照片。请识别食物并估算。照片里没有价格就把 amount_usd 填 null。"
      : input.type === "receipt"
        ? "这是一张餐厅小票。解析商家、总金额、每道菜,并逐项估算营养。"
        : "这是一张买菜/超市小票。只解析商家、总金额和食材清单,items 留空。";
  blocks.push(image, { type: "text", text });
  return blocks;
}
