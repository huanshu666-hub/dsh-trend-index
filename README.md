# DSH GitHub 趋势索引

给 DeepSeek Harness 插件市场用的第三方索引源（format 1）。

在 DSH 里 **插件 → 发现 → 添加索引源**，粘贴：

```
https://raw.githubusercontent.com/<你的用户名>/dsh-trend-index/main/index.json
```

## 它比官方目录多了什么

官方 `dsh-plugin-catalog` 只收 npm 可安装的条目（3993 个），
且在 `scripts/lib/market-index.mjs` 里明确写道：format 1 要求每个 Git 版本
配一个 commit SHA，而他们不记录 SHA，于是整个 GitHub-only 的一半被放弃。

本索引补上了这一半：用 `github.com/{owner}/{repo}/commits.atom`
（不消耗 REST API 配额）解析 commit SHA，把 GitHub 托管的插件也纳入。

| | 官方目录 | 本索引 |
|---|---|---|
| 插件数 | 3993 | 4557 |
| 排序依据 | 无（`sortKeys` 为空） | 热度分 / star / 下载量 / 上架天数 |
| 标签 | 无 | new / fresh / hot / rising / popular / npm / gitonly / risky |

## 热度分怎么算

纯粹按 star 排序会混进蹭 topic 的无关项目（曾出现 8 万 star 的无关仓库）。
本索引用动量而非绝对量：

```
score = stars*0.6 + downloads*0.15 + freshness*60 + min(stars/age, 400)*2
```

其中 freshness 按上架天数分档（≤7 天 3 分、≤30 天 2 分、≤90 天 1 分）。

## 质量门槛

仅 GitHub 托管的条目要求 **≥5 star**。实测该区间 86% 的仓库不足 5 star，
保留它们只会重复现有目录「凑数多」的老问题。

## 数据来源

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的公开目录（每日刷新），本项目只做重排序、补 SHA、加热度元数据。
