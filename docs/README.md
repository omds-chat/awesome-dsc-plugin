# 文档索引

> 本文是本仓库全部文档的索引入口。只回答「有哪些文档、各自负责什么、什么时候该读哪一份、冲突时听谁的」,不复述任何文档正文;具体规则以各文档自身为准。

## 一、文档主表

| 文档 | 职责一句话 | 主要内容 | 什么时候需要读 | 主要读者 |
|:---:|:---:|:---:|:---:|:---:|
| [README.md](../README.md) | 合集对外的中文门面 | 定位与收录范围、能拿到什么、三类读者的最小可用步骤、分发结构与仓库目录概览、跨域访问、许可 | 第一次了解本合集、判断某个插件为什么不在收录里 | 用户、贡献者 |
| [README.en-US.md](../README.en-US.md) | 上一行的英文版本 | 与 README.md 对应的英文叙述,标题集合与顺序一一对应 | 需要英文说明或对外沟通时 | 用户、贡献者 |
| [catalog/README.md](../catalog/README.md) | 收录登记的唯一入口说明 | 登记目录结构、author.json、author_pub.pem 与 plugin.json 的字段与提交流程、收录后处理、下架与 removed.json | 提交收录、修改登记、撤回或下架插件时 | 贡献者 |
| [.github/bundle-layout.README.md](../.github/bundle-layout.README.md) | 插件树结构说明 | plugins/ 三层目录的必需文件、versions.json 结构、meta.json 字段与命名规则 | 核对插件树布局、确认某层该有哪些文件、改版本元数据字段 | 维护者、贡献者 |
| [docs/maintenance.md](maintenance.md) | 维护者操作手册 | 仓库结构、证书位置、pages 包结构与必需文件、清单覆盖范围、revision 语义、pages 包校验规则与校验语义、收录与构建流水线、异常上报、自查脚本、本地校验与复现、离线联调 npm 校验 | 改流水线、复现构建、排查发布失败、跑自查脚本 | 维护者 |
| [docs/design/signing.md](design/signing.md) | 签名体系设计 | 三个签名角色、证书链与曲线硬约束、签什么、签名与验签命令及 DER 取舍、作者自签名、申请 EEC、私钥管理 | 改签名约定、核对签名命令、申请或更换 EEC、判断某个签名归谁 | 维护者、Agent |
| [docs/design/collection-pipeline.md](design/collection-pipeline.md) | 流水线机制与取舍的设计说明 | catalog 驱动模型、三层清单职责与 revision 语义、清单入库与 ci-memory 分支、证书位置、异常剔除、站点关系、与内部合集的差异、已否决方案、未定稿项 | 判断「为什么这样定」「这样改会不会破坏既有取舍」、评估机制变更的影响面 | 维护者、Agent |
| [docs/design/pages-artifacts.md](design/pages-artifacts.md) | pages 包逐文件职责说明 | 市场取件顺序、每个文件的生成者、消费者、签名归属、随发布是否更新与体积增长来源 | 判断某个文件能不能当作插件信息入口、调整产物清单与签名归属 | 维护者、Agent |
| [schemas/README.md](../schemas/README.md) | JSON Schema 索引 | 六份 schema 的约束对象与要点、约束范围、结构合法与收录通过的区别 | 改字段、加校验、判断某份 JSON 结构是否合法 | 维护者、Agent |
| [site/README.md](../site/README.md) | 站点工程说明 | 合集设置的唯一位置、页面读取顺序与逐级回落、构建与展示约定 | 改站点、排查页面数据缺失或显示异常 | 维护者 |
| [scripts/README.md](../scripts/README.md) | 脚本目录说明 | scripts/ 与 scripts/lib/ 的逐文件职责 | 找某个脚本、改脚本前确认职责边界 | 维护者、Agent |
| [docs/README.md](README.md) | 本索引 | 文档主表、冲突时的优先级、文档分层、维护约定 | 找文档、判断该读哪一份、新增或删除文档时 | Agent、维护者 |

## 二、冲突时以谁为准

优先级从高到低:

| 优先级 | 来源 | 说明 |
|:---:|:---:|:---:|
| 1 | `schemas/` 的 JSON Schema 与 `scripts/` 的实际行为 | 可执行事实:结构合不合法、构建与校验实际做什么,只以这里为准 |
| 2 | 各领域文档 | 对外规范叙述与操作判据:catalog/README.md(收录登记)、.github/bundle-layout.README.md(插件树)、docs/maintenance.md(校验与流水线)、docs/design/signing.md(签名约定)、site/README.md(站点)、schemas/README.md(schema 索引)。领域内的规则以该领域的文档为准;README.md 与 README.en-US.md 是互为译本的面门叙述,不新增规则,冲突时以中文版为准 |
| 3 | `docs/design/` 下的设计文档 | 解释机制与取舍:与上两层冲突时以脚本与领域文档为准,并回改设计文档 |

几条配套规则:

- 两份设计文档的分工是「逐文件事实」与「机制取舍」:某个文件由谁生成、谁读、谁签,以 pages-artifacts.md 为准(它贴近脚本);层与层之间的取舍、被否决的方案与未定项,以 collection-pipeline.md 为准。同一事实两处冲突时按此分工取一侧,再回改另一侧。
- 领域文档与脚本冲突时以脚本为准并回改文档;领域文档与设计文档冲突时以领域文档为准并回改设计文档。
- 规范来源在上游时以上游为准:合集骨架与命名规则跟随模板仓库 `dsc-plugin-set-template`,字段语义跟随分发规范;本仓库的副本不反过来定义规范。

## 三、文档分层

| 层 | 文档 | 面向谁 | 读它的前提 |
|:---:|:---:|:---:|:---:|
| 对外文档 | README.md、README.en-US.md、catalog/README.md | 用户与投稿作者 | 不需要先读设计文档:收录范围、登记规则与分发结构在这三份里自足 |
| 维护者文档 | docs/maintenance.md、.github/bundle-layout.README.md、schemas/README.md、site/README.md、scripts/README.md、docs/design/ 下三份 | 改流水线、字段、站点与产物的维护者 | 先读过对外文档,再按本次改动对象选一份 |
| Agent 执行文档 | 本索引、`schemas/` 的 JSON 与 `scripts/` 的实际行为 | Agent | 从本索引找入口:结构与合法性读 schema,实际行为读脚本,取舍读设计文档 |

- 设计文档不写执行步骤,也不重复字段表:执行依据是脚本与 schema,设计文档只解释为什么这样定、边界在哪里。
- 本索引自身属于 Agent 执行文档:Agent 开工前先按主表定位应读的文档,不必逐份通读。

## 四、维护约定

- 新增或删除任何文档,同一次改动内更新本索引主表;文档改名或移动时,同时修正所有引用它的链接。
- README.md 与 README.en-US.md 必须同步:两版的标题集合与顺序一一对应。核对方法:`grep -c '^#' README.md` 与 `grep -c '^#' README.en-US.md` 的标题总数相等,且 `grep -n '^#'` 并排比对出的两版标题层级序列逐项对应;增删、改名或移动章节时,同一次改动内同步另一版。
- 机制变更当轮更新对应文档,不留到下一轮:改字段同步 schemas/README.md;改清单覆盖范围、签名归属或逐文件职责同步 docs/design/pages-artifacts.md;改 revision 语义、清单归档或层间取舍同步 docs/design/collection-pipeline.md 第二节;改签名约定、证书链或签名命令同步 docs/design/signing.md;改流水线步骤、校验规则或自查脚本同步 docs/maintenance.md。
- 文档与代码冲突时先按第二节判定以谁为准,再回改文档;不允许同一事实在两处各留一种说法。
- 双语只覆盖 README.md 与 README.en-US.md,其余文档以中文维护;docs/maintenance.md 等维护者文档新增英文版时,按上一条的核对方法同步登记。
- 本索引与设计文档只描述机制、边界与读者入口,不写时间戳、不写进度、不写时间计划。
