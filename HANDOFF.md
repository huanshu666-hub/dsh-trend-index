# 交接文档：DSH GitHub 趋势索引

> 最后更新：2026-10-31
> 维护者操作只需读「日常运维」和「故障排查」两节。

---

## 这是什么

给 DeepSeek Harness（DSH）用的**第三方插件市场索引源**（format 1）。

DSH 0.2.1 起支持「插件市场索引」：一个 JSON 文档，把自己塞进 `Plugins → 发现 → 添加索引源`，就能像官方市场一样浏览和安装插件。

本项目做的事，是在社区目录 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的数据之上再加工一层：

1. **补上官方放弃的那一半插件**。官方 `scripts/lib/market-index.mjs` 里有句注释写明：「The GitHub-only half of the list cannot be expressed yet — format 1 wants a commit SHA per Git version, and this repository records none.」即 format 1 要求每个 Git 版本配一个 40 位 commit SHA，他们不记录 SHA，于是 3700+ 个只在 GitHub 上发布的插件被整体丢弃。本项目用 `commits.atom`（**不消耗 GitHub REST 配额**，实测 874 次抓取配额消耗为 0）解析 SHA，把这部分补回来。
2. **加热度信号**。官方索引的 `metadata.sortKeys` 是空的、`labels` 是空的，所以 DSH 里只能按分类浏览，无法排序。本项目输出 4 个排序键 + 8 类标签。

## 当前状态

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/huanshu666-hub/dsh-trend-index |
| 插件数 | 4557（npm 3993 + GitHub-only 564） |
| 索引体积 | 4.59MB（gzip 后约 1.4MB） |
| 拉取耗时 | 395ms（中位，VPN 关闭状态下实测） |
| 更新频率 | 每天 UTC 18:00（北京 02:00）自动 |
| 最后构建 | 2026-10-30 17:43:15 UTC |

## 仓库结构

```
dsh-trend-index/
├── build.mjs                    生成器（唯一需要读懂的代码）
├── score-model.mjs              热度分单一事实源，build.mjs 与 dashboard 共用
├── index.json                   构建产物（4.7MB，会随构建变化）
├── shas.json                    commit SHA 缓存（3613 条，必须提交）
├── README.md                    仓库说明
├── UPDATE.md                    更新方式
├── HANDOFF.md                   本文件
├── dashboard/                   可视化控制台（纯静态，无构建步骤）
│   ├── index.html               单文件页面，样式与脚本都在里面
│   ├── prep.mjs                 index.json → data.json（图表专用扁平结构）
│   ├── data.json                prep.mjs 的产物，2.2MB（已 .gitignore，本地生成）
│   └── serve.mjs                零依赖本地静态服务器
├── .gitignore                   忽略 catalog.json（9.7MB 的中间缓存）
└── .github/workflows/refresh.yml  每日自动构建
```

## 双分支设计（重要）

| 分支 | 内容 | 更新方式 |
|---|---|---|
| `main` | 代码、文档、工作流 | 正常提交 |
| `data` | **只有 index.json / shas.json / README.md** | **每天强制覆盖成单个提交** |

**为什么分开**：`index.json` 有 4.6MB。若每天往 main 提交一次，一年后仓库历史约 1.6GB，clone 会变得极慢。`data` 分支每天 `git push --force` 重写为单提交，raw 地址永远只暴露最新版，仓库体积恒定。

**DSH 读的就是 data 分支**：

```
https://raw.githubusercontent.com/huanshu666-hub/dsh-trend-index/data/index.json
```

## DSH 侧配置

文件：`~/.dsh/profiles/desktop/cordis.patch.yml`

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    fetchTimeoutMs: 60000
    indexes:
      - https://raw.githubusercontent.com/huanshu666-hub/dsh-trend-index/data/index.json
      - https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

第一项是本项目产出，第二项是官方目录（作为兜底）。

> `fetchTimeoutMs` 默认 15000。改成 60000 是为了给 4.6MB 索引留余量（实测中位 395ms，但首次 DNS 冷启动曾见到 1.9s）。

---

## 日常运维

### 正常情况下：什么都不用做

GitHub Actions 每天自动跑。你的电脑关机、DSH 没开、VPN 关着，都不影响。

### 想立刻更新

方式一：GitHub 网页 → Actions → `refresh index` → **Run workflow**

方式二：本地跑（需要先开着 VPN，见下方网络约束）

```bash
cd <repo-dir>
MAX_GIT=4000 node build.mjs
git add -A && git commit -m "refresh" && git push
```

- 首次约 20 分钟（要全量抓 3625 个仓库的 SHA）
- 之后几分钟（`shas.json` 缓存 24 小时内的解析结果）

### 想调整排序权重

改 `score-model.mjs`——**这是权重的唯一出处**，`build.mjs` 和 `dashboard/prep.mjs` 都 import 它。不要在 `build.mjs` 里再写一份内联实现：两份实现一旦分叉，控制台画出来的分解就不再能解释索引里的分数。

```js
export const WEIGHTS = { stars: 0.6, downloads: 0.15, freshnessWeight: 60, momentumWeight: 2, momentumCap: 400 };
// freshness 分档：≤7 天 3 分、≤30 天 2 分、≤90 天 1 分、更早 0 分
// 总分 = stars*0.6 + downloads*0.15 + freshness*60 + min(stars/age, 400)*2
```

`decompose()` 返回四个成分，控制台的堆叠条直接画它——所以调完权重，页面上的「为什么它排这里」会自动跟着变。

改完 push 到 main 就会自动触发重建（工作流监听 `build.mjs`、`score-model.mjs`、`dashboard/**` 和 workflow 文件本身）。

### 想调整 GitHub-only 条目的门槛

`MIN_GIT_STARS`，默认 5。实测该区间 86% 的仓库不足 5 star，那些是纯凑数项目，保留只会重演官方目录「凑数太多」的老问题。

---

## 网络约束（务必知道）

这台机器上两个 GitHub 域名的可达性**完全不同**：

| 域名 | 用途 | VPN 关闭 | VPN 开启 |
|---|---|---|---|
| `raw.githubusercontent.com` | **DSH 读索引** | ✅ 可用（5/5 成功，中位 395ms） | ✅ 可用 |
| `github.com` | 网页、`git push` | ❌ TCP 超时 | ✅ 需走代理 |

**结论：日常使用不需要 VPN，只有 `git push` 需要。**

git 已配置：

```bash
http.https://github.com/.proxy = http://127.0.0.1:7892
```

⚠️ 这个端口是写死的。如果代理软件换端口，或换了另一台机器，`git push` 会失败。排查见下节。

## 故障排查

### 症状：DSH「发现」页看不到这个索引源

按顺序查：

1. 在浏览器打开 `https://raw.githubusercontent.com/huanshu666-hub/dsh-trend-index/data/index.json`
   - 打不开 → 网络问题（但此域名通常不需要 VPN，可能是本地 DNS）
   - 打得开 → 继续
2. 检查 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `plugin-market` 的 `indexes` 是否正确
3. 重启 DSH，让它重读配置

### 症状：索引里插件数突然大幅减少

Actions 里有护栏：新构建低于上一版 90% 会中止不发布。若真发生了，说明上游目录本身出了问题。手动去 `awesome-dsh-plugin.com/plugins.json` 确认 `count` 字段。

### 症状：git push 失败 `Failed to connect`

```bash
# 1. 查代理端口是否还是 7892
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | findstr ProxyServer

# 2. 端口变了就改配置
cd <repo-dir>
git config "http.https://github.com/.proxy" "http://127.0.0.1:<新端口>"

# 3. 或者临时清空走直连（仅当能直连时）
git config --unset "http.https://github.com/.proxy"
```

### 症状：Actions 运行失败

去 GitHub → Actions → 点开失败的 run 看日志。常见原因：

- `shas.json` 读不到（data 分支不存在时会兜底成 `{}`，不会失败，只是变慢）
- 上游目录 404 或格式变化

### 症状：索引校验不通过

用官方解析器验：

```bash
# 解析器从 DSH 安装包里取
node -e "
const fs=require('fs');
const asar='<dsh-install>/resources/app.asar';
const fd=fs.openSync(asar,'r');
const b=Buffer.alloc(16); fs.readSync(fd,b,0,16,0);
const hs=b.readUInt32LE(12); const hb=Buffer.alloc(hs); fs.readSync(fd,hb,0,hs,16);
const h=JSON.parse(hb.toString('utf8'));
let n=h; for(const s of 'dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'.split('/')) n=n.files[s];
const out=Buffer.alloc(n.size); fs.readSync(fd,out,0,n.size,16+hs+Number(n.offset));
fs.writeFileSync('_parser.mjs', out);
"
# 注意：解析器依赖 semver，需在同目录 npm i semver 后使用
```

---

## 踩过的坑（避免重犯）

1. **未认证 GitHub REST API 只有 60 次/小时**。早期版本的生成器直接调 API 拿 stars，跑到一半 403 卡死。**现在完全不用 REST API 拿 star**——stars 直接从 awesome 目录的 `plugins.json` 读（该文件 96% 条目带 stars）。

2. **`git ls-remote` 走死代理**。曾有一百多次调用全部失败，原因是 `http.https://github.com/.proxy=http://127.0.0.1:18113` 指向一个已关闭的端口。已清理，现指向 7892。

3. **`categories` 格式写错**。format 1 要求 `{ <id>: { title: { en, zh } } }`，而上游给的裸文本是 `{ <id>: { en, zh } }`。自写的 self-check 没发现，用官方 `parseMarketIndex` 才暴露出 `$.metadata.categories.agi.title must be an object`。

4. **SemVer 必须恰好三段**。早期用日期推导版本号生成了 `2026.10.17.1`（四段），被格式拒绝。已改为 `YYYY.M.D`。

5. **纯 star 排序会引入无关项目**。用 `topic:dsh-plugin` 搜索时会混进蹭 topic 的明星仓库（picgo 27441★、nocobase 24790★、ruflo 80244★）。已加 DSH 相关性过滤（名称/描述/topic 必须真的指向 DSH），并改用「动量 + 新鲜度」而非绝对 star。

## 已知限制

- **索引无签名**。内容（包括 Git 条目的名称和版本）只是市场的声明，实际安装什么由包自己的 manifest 决定。
- **不检查包真实性**。校验器无法验证某个 name/version 是否真的对应上游包。
- **分页会变**。DSH 缓存 10 分钟，期间分页稳定；缓存被替换后需从第一页重来。
- **GitHub-only 条目的版本号是从上架日期推导的**（`YYYY.M.D`），不是上游真实版本。安装时走 commit SHA 锁定，所以不影响正确性。
- **不支持升级**。索引里标了 `update-available` 的已安装插件，升级仍需先卸载再装（这是 DSH 自身的限制）。

## 关键数据来源

| 数据 | 来源 | 备注 |
|---|---|---|
| 插件目录、stars、downloads、added、capabilities | `https://awesome-dsh-plugin.com/plugins.json` | 9.7MB，字段覆盖实测：added 100%、stars 96%、downloads 51% |
| commit SHA | `https://github.com/{owner}/{repo}/commits.atom` | **零 API 配额消耗** |
| 官方 format-1 校验规则 | DSH 内置 `@deepseek-ai/dsh-plugin-market-index` | 索引必须能过它的 `parseMarketIndex` |
