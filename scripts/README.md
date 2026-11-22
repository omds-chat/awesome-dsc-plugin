# 脚本目录

`scripts/` 下是本仓库的校验与构建脚本,全部零依赖:只使用 Node 内置模块,密码学只调用 `openssl` 命令行,不做任何自实现。自查脚本的用法、输出 JSON 字段与退出码见 [../docs/maintenance.md](../docs/maintenance.md) 第九节;脚本清单的顶层职责见仓库根 [README.md](../README.md)。

```text
scripts/
├── pki.mjs                             OpenSSL PKI 封装,只调用命令行不做密码学
├── build-from-catalog.mjs              按 catalog 组装 pages 包,CI 主入口
├── build-collection.mjs                对已构建的合集目录重签或重新生成三层清单
├── verify-catalog.mjs                  仓库级校验:catalog/ 与 certs/ 的结构与证书材料
├── verify-collection.mjs               pages 包的结构、清单、签名与产物网络扫描校验
├── verify-catalog-consistency.mjs      pages 包的收录信息交叉校验
├── verify-bundle.mjs                   把上面两条 pages 包校验合成一个入口
├── check-syntax.mjs                    全部脚本与站点源码的语法自检
├── report-build-anomalies.mjs          把剔除的插件上报到本仓库 Issue,失败不阻塞发布
├── check-authors.mjs                   自查:作者目录名合法性与大小写不敏感唯一性
├── check-plugins.mjs                   自查:插件名规则与同名插件全局唯一性
├── check-versions.mjs                  自查:versions.json 与 plugins/ 树一致
├── check-manifests.mjs                 自查:三层清单覆盖与哈希,含清单签名
├── check-certs.mjs                     自查:certs/ 的终端签名证书与签发链
├── check-removed.mjs                   自查:removed.json 结构与「已下架却仍有登记」的矛盾
├── check-site.mjs                      自查:site/ 设置与 catalog/ 的一致性
├── check-all.mjs                       自查汇总入口:一次跑完全部检查,输出一个总 JSON
├── preflight.mjs                       发版前预检:一次跑完 catalog、清单、签名占位、npm 包名与产物扫描
├── summarize.mjs                       把管道传入的多个检查结果合并成一个总 JSON
└── lib/
    ├── catalog.mjs                     读取 catalog 登记并按 base_url 拉取版本与产物
    ├── catalog-checks.mjs              catalog/ 与 certs/ 的仓库级检查
    ├── catalog-index.mjs               生成 catalog/index.json 与 catalog/anomalies.json
    ├── check-report.mjs                自查脚本的公共输出约定:结果结构、JSON 输出与退出码
    ├── check-suite.mjs                 自查检查项定义,复用上述模块
    ├── ci-memory.mjs                   ci-memory 分支上三层清单的镜像:读回与写回
    ├── collection-meta.mjs             合集元数据 site/meta.json 的规则
    ├── collection-verify.mjs           三层清单与签名的校验逻辑
    ├── consistency-verify.mjs          pages 包的收录信息交叉校验
    ├── env.mjs                         极简 .env 读取与 npm registry 地址解析
    ├── layer-manifests.mjs             按层生成并签名三层清单
    ├── npm-package-check.mjs           npm 包名强校验:登记包名与插件名一致且 registry 上存在
    ├── plugin-network-scan.mjs         plugin.js 的网络自建静态扫描(收录侧契约,命中只警告)
    └── preflight-comment.mjs           预检报告的 PR 评论文本生成(固定标记在脚本内)
```

脚本只读自己的输入、按需产出 `dist/pages`,不改写 `catalog/` 与 `certs/`;校验语义与合集模板仓库 [dsc-plugin-set-template](https://github.com/omds-chat/dsc-plugin-set-template) 保持一致,修改脚本前先改模板再同步本仓库。
