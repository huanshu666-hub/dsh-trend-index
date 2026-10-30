# 更新与自动化

## 自动（推荐，已配置）

```.github/workflows/refresh.yml``` 每天 UTC 18:00 自动跑一次：

1. 取回 `data` 分支上的 `shas.json`（commit SHA 增量缓存）
2. 抓 awesome-dsh-plugin 目录 + 补 GitHub-only 条目的 commit SHA
3. 校验插件数没有异常缩水（低于上版 90% 就中止，保留旧版）
4. 跑 `dashboard/prep.mjs` 把 `index.json` 摊平成 `data.json`
5. 把 `index.json` / `data.json` / `index.html` 以**单个提交**强推到 `data` 分支

所以 raw 地址指向 `data` 而不是 `main`：

```
https://raw.githubusercontent.com/huanshu666-hub/dsh-trend-index/data/index.json
```

`main` 存代码，`data` 每天被覆盖重写 —— 这样仓库不会因为每天一次 4.6MB 提交而膨胀到 GB 级。

## 手动

想立刻刷新，在 Actions 页面点 **Run workflow** 即可。

## 本地跑

```bash
cd D:/技能/dsh-trend-index
MAX_GIT=4000 node build.mjs
```

- 首次约 20 分钟（3625 个仓库逐个取 commit SHA）
- 之后快很多：`shas.json` 缓存 24 小时内的解析结果
- 抓取用 `commits.atom`，**不消耗 GitHub REST 配额**

控制台数据随时可以单独重建（不联网、几百毫秒）：

```bash
node dashboard/prep.mjs
node dashboard/serve.mjs   # http://127.0.0.1:4321/
```
