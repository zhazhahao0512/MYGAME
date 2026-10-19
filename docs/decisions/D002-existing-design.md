# D002 · 已有有效设计决定登记

状态：已定稿登记，2026-10-19（北京时间）。这是一份已有确认的定位索引，不新增游戏行为。依据为 PROGRESS H01–H25、R001–R015；以其中明确确认项为准，建议/暂定值保留原限定。

开工读取以下既有权威记录，不以摘要代替正文：

- [当前约定与实现边界](../PROGRESS.md#当前约定与实现边界)：产品、技术、流程、装备、经济、交互和部署约定；相应正文见 [README](../../README.md)、[FRAMEWORK](../FRAMEWORK.md)、[COMBAT](../COMBAT.md)。COMBAT 描述现行实现，不能覆盖新设计。
- [快捷说明/反馈/手机横屏](../UI-INTERACTION-DESIGN.md)：R007 已确认实施，历史验证与限制见 PROGRESS R007。
- [精准与闪避设计](../ACCURACY-DESIGN.md)：R010–R013 已确认命中 = 精准 + 技能（招式）修正 − 闪避 − 距离惩罚；不另加命中保底、精准上限、距离惩罚上限。概率数学边界不等于属性上限。
- [伤害分类与选敌](../TARGET-SELECTION.md)的“已确认的基础规则”和“伤害之间的关系”：R013–R014 确认所有伤害可闪避，技能默认不可暴击除非特别指定，真实/破魔交互。选敌候选和参考不是定稿。

替代关系：R012 加减公式替代早期比值设计提案；R013 取消额外命中保底和距离惩罚上限建议；R014 确认真实/破魔交互。独立闪避上限未据此取消，见 [Q001](../open-questions.md#q001)。

实现证据：在 `8a9f849` 核对 `src/battle.js` 的 `hitChance` 与伤害快照：仍为专注/移速比值，技能默认必中、不暴击，可配置覆盖；仅按 magic 与非 magic 分流。新精准/闪避、全伤害可闪避及四类伤害未实施，不能将局部相符的技能默认不暴击误写为整套设计已实现。此后认领提交仅改文档。

未定稿的选敌、锁敌和出怪备选继续见 [LOCKING-DESIGN](../LOCKING-DESIGN.md)、[FOUNDATION-NEXT](../FOUNDATION-NEXT.md)、[open-questions](../open-questions.md)；保留 [TARGETING-DESIGN](../TARGETING-DESIGN.md) 的历史替代标注。
