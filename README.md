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

## 可视化控制台

索引里每个插件都有四股力量（star、下载量、新鲜度、动量）加权成的热度分，
但一个数字说不清它为什么排在那个位置。控制台把每一行拆开画：

- **榜首十二条** —— 每条记录的热度条是四个成分堆叠，比例差异就是排名差异的来源
- **配方的代价** —— 公式四项在 4557 条真实语料上实际产生了什么形状（长尾、集中度、秩相关）
- **二十三个分类** —— 按条目数的横条，npm 与仅 GitHub 双色
- **长尾的形状** —— 双对数散点，没有 star 也没有下载量的点堆在左轴与下轴上
- **全部条目** —— 可搜索（含中文）、可按列排序、可按分类与标签筛选的表

纯静态、零依赖、无构建步骤：

```bash
node dashboard/prep.mjs    # index.json → dashboard/data.json
node dashboard/serve.mjs   # http://127.0.0.1:4321/
```

必须走 HTTP 打开（`file://` 会被浏览器拦住 `fetch`）。

想在线上看：Actions 每次构建都会重新生成 `data.json`，并与 `index.html`
一起发到 `data` 分支根目录。所以只需在仓库设置里做一次性操作——
Settings → Pages → Source 选 `data` 分支根目录。没开这一步时整站不存在，
不影响 DSH 读 `index.json`。

## 数据来源

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
的公开目录（每日刷新），本项目只做重排序、补 SHA、加热度元数据。

## 卡片上的指标

每个插件的描述开头带一行指标，因为 DSH 的插件卡片只渲染
`title / labels / description / meta`，而 `sortKeys` 仅用于排序下拉——不写进描述就看不见：

```
★ 3.7k · ⬇ 2.6M · 46天 | billion-context官方版：上下文压缩插件…
```

| 符号 | 含义 |
|---|---|
| ★ | GitHub star 数 |
| ⬇ | 近 30 天下载量 |
| 天 / d | 上架距今天数 |

数字按 k / M 缩写。中英双语各一份，天数单位随语言变化（天 / d）。
