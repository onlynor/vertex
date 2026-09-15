# VERTEX 跃界

**AI Football Performance Analysis** — 面向体育老师的足球训练视频分析系统。

上传学生的训练视频，系统调用多模态大模型自动识别训练项目（颠球、运球、传接球、射门等），生成动作表现、存在问题和改进建议，视频与报告都会保存下来供随时回放。评价表也能一键交给 AI：结合视频分析、老师已填的内容和这个班以前的记录，把星级、文字记录和评语整张表填出来，老师过目改几处就能导出。

![demo](assets/demo.svg)

技术栈：React + TypeScript + Vite + Tailwind / Go + Gin + GORM / MySQL

---

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Go | 1.27+ | 后端 |
| Bun | 1.3+ | 前端 |
| MySQL | 8.0+ | 数据库 |
| ffmpeg | 近期版本 | **必需**，用于视频抽帧和时长检测 |

```bash
# ffmpeg 没装的话视频分析会直接失败
sudo apt install ffmpeg     # Ubuntu/Debian
brew install ffmpeg         # macOS
```

还需要一个**支持视觉输入**的大模型 API Key（任何 OpenAI 兼容接口均可）。

---

## 快速开始

```bash
# 1. 配置
cp .env.example .env
#    填入 API_KEY / base_url / model / DB_PASSWORD / APP_SECRET

# 2. 建库（表结构启动时自动创建）
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS football_ai \
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3. 后端
cd backend && go run ./cmd/server

# 4. 前端（另开一个终端）
cd frontend && bun install && bun run dev
```

打开 http://localhost:5173，默认账号 `admin` / `admin123`。

生产构建：

```bash
cd frontend && bun run build              # 产物在 frontend/dist
cd backend  && go build -o server ./cmd/server
```

---

## Docker 部署

不用装 Go、Bun 和 MySQL，一条命令跑起全套（MySQL + 后端 + 前端）：

```bash
cp .env.example .env      # 至少填 API_KEY、DB_PASSWORD、APP_SECRET
docker compose up -d --build
docker compose ps         # 三个服务都是 healthy 就绪
```

打开 `http://服务器地址:8080/`，用 `.env` 里的管理员账号登录。

> 构建镜像时默认走国内镜像源（Go 模块用 `goproxy.cn`、Alpine 包用阿里云、npm 包用 `npmmirror.com`），国内服务器构建更快更稳；海外服务器改用官方源见下文「构建镜像的下载源」。

| 常用命令 | 作用 |
|---|---|
| `docker compose logs -f backend` | 看后端日志（分析失败、AI 报错都在这里） |
| `docker compose restart backend` | 改完 `.env` 后重启生效 |
| `docker compose up -d --build` | 拉了新代码后重新构建 |
| `docker compose down` | 停止（数据保留在数据卷里） |
| `docker compose down -v` | 停止并**删除数据库和视频**，谨慎 |

- 默认对外端口是 `8080`（避开很多机器上已经占了 80 端口的系统级 nginx）；要换成别的端口就在 `.env` 里改 `WEB_PORT`，再访问 `http://服务器地址:改成的端口/`
- `TZ` 默认 `Asia/Shanghai`：评价表、训练报告按本地日期统计，时区不对日期会错一天
- 数据放在两个数据卷里：`vertex_mysql_data`（数据库）、`vertex_video_data`（训练视频），容器重建不会丢
- 备份数据库：`docker compose exec mysql mysqldump -uroot -p"$DB_PASSWORD" football_ai > backup.sql`
- ffmpeg 已经装在后端镜像里，宿主机不用另外装
- 后端健康检查是 `GET /api/health`（公开接口，会 ping 一次数据库），前端等后端 healthy 之后才启动

> 这套编排已经在本机用真实 Docker 环境跑通验证过（三个服务健康、上传视频能存能放能出报告），构建和启动如果报错还是把日志发出来。

### 构建镜像的下载源

`docker compose build` 默认走国内镜像下载依赖：

| 下载什么 | 默认（国内镜像） | 海外服务器改成 |
|---|---|---|
| Go 模块 `GOPROXY` | `goproxy.cn`（备用 `proxy.golang.com.cn`） | `https://proxy.golang.org` |
| Go 校验和 `GOSUMDB` | `sum.golang.google.cn` | `sum.golang.org` |
| Alpine 系统包 `APK_MIRROR` | `mirrors.aliyun.com` | `dl-cdn.alpinelinux.org` |
| npm 包 `NPM_REGISTRY` | `registry.npmmirror.com` | `https://registry.npmjs.org` |

不在国内网络时，在 `.env` 里改成上表右列对应的值（`.env.example` 里已经写好这几行），再 `docker compose build` 重新构建即可，不用改 Dockerfile。`frontend/bun.lock` 按包名和版本号记录完整性哈希、不绑定具体源地址，换源不影响装到的版本。

`ffmpeg` 依赖上百个编解码库，第一次构建装这层要几分钟；这层在 `COPY` 源码之前，日常 `git pull` 改代码后重新构建本来就会走 Docker 的层缓存跳过它，不会每次都等。两个 Dockerfile 都用了 BuildKit 的 `--mount=type=cache`，把下载过的包缓存单独存在构建缓存里（不占镜像体积），即使触发这几层重建（换了基础镜像、改了这几行、或者 `--no-cache` 全量重建）也不用重新下载一遍——前提是 Docker 版本较新（22.06+ 默认已启用 BuildKit，一般不用另外配置）。

### 配合反代（Nginx / Caddy 等）

外面还有一层反代时，`.env` 里把 `WEB_HOST` 改成 `127.0.0.1`，容器只监听本机回环地址，端口不会绕过反代直接暴露在公网：

```bash
# .env
WEB_HOST=127.0.0.1
WEB_PORT=8080        # 随便选一个没被占用的端口，反代转发到这里
```

```bash
docker compose up -d      # 应用新的端口映射（改了 WEB_HOST/WEB_PORT 要重新 up，重启不够）
```

反代（如宿主机上的 Nginx）转发到 `127.0.0.1:8000` 即可，域名和 HTTPS 证书都在反代这一层处理：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;
    # ssl_certificate / ssl_certificate_key 按证书实际路径填

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 上传大视频、AI 一键评价可能要等较久
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        client_max_body_size 120m;
    }
}
```

容器内部的 `frontend/nginx.conf` 已经处理了 `/api` 转发和视频流式回放，反代这一层只需要原样透传，不用重复配置这些细节。

---

## 配置项

根目录 `.env` 是唯一配置入口。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `API_KEY` | — | 大模型 API Key |
| `base_url` | — | OpenAI 兼容接口地址 |
| `model` | — | 模型名称 |
| `DB_USER` / `DB_PASSWORD` | `root` / — | MySQL 账号密码 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `127.0.0.1` / `3306` / `football_ai` | MySQL 连接 |
| `APP_SECRET` | **必填** | JWT 签名 + 字段加密主密钥 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | 初始管理员账号 |
| `VIDEO_STORE_DIR` | `./data/videos` | 视频保存目录 |
| `VIDEO_STORE_MAX_GB` | `20` | 视频保留上限，超出按最旧淘汰 |
| `VIDEO_TMP_DIR` / `PORT` | `./tmp` / `8080` | 抽帧临时目录、后端端口 |
| `WEB_PORT` | `8080` | 仅 docker compose：网站对外端口 |
| `WEB_HOST` | `0.0.0.0` | 仅 docker compose：监听地址，配合反代时改成 `127.0.0.1` |
| `GOPROXY` / `GOSUMDB` / `APK_MIRROR` / `NPM_REGISTRY` | 国内镜像 | 仅构建镜像时用，见「构建镜像的下载源」 |
| `TZ` | `Asia/Shanghai` | 仅 docker compose：时区，影响按日期的统计 |

> ⚠️ **`APP_SECRET` 换掉后已存的报告、封面图和 API Key 将无法解密**，它们用这个密钥派生的 AES-256-GCM 加密存储。
>
> `.env` 含明文密码，已在 `.gitignore` 中排除，不要提交。

`API_KEY` / `base_url` / `model` 只是首次启动的兜底值，登录后在「设置」页填的配置会加密存库，之后以数据库为准。

---

## 大模型配置

登录后进入「设置 → AI 模型配置」，填好后点「测试连接」验证。

| 服务商 | base_url |
|---|---|
| DeepSeek | `https://api.deepseek.com/` |
| 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/v3/` |
| Kimi（Moonshot） | `https://api.moonshot.cn/v1/` |
| 通义千问（百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1/` |

**必须选支持视觉输入的模型**，纯文本模型无法分析视频。

后端用 ffmpeg 从视频中按时间均匀抽取最多 12 帧（宽 640px）发给模型，而不是直接发视频——各家对视频输入的支持差异很大，图片输入才是所有视觉模型的通用能力，这样换模型才真的不用改代码。

---

## 使用

**账号**：登录页可切「注册」。用户名 6~12 位字母或数字；密码 6~12 位且必须同时含字母和数字。

**首页**：进来先看「功能星图」——每个亮点是一个功能，虚线是数据流向，鼠标移上去看说明，点一下直接进入；右上角「打开数据大屏」是给会议室、校园大屏用的全屏页面。

**学生**：「学生管理」按班级管理，左边是班级列表，可单个添加，也可批量导入 Excel / CSV。班级名称会自动统一写法，详见下文「分班管理」。
- 支持列：姓名（必填）、学号、性别、年龄、班级、位置（前锋 / 中场 / 后卫 / 门将）；**列顺序随意**，按表头名匹配
- 弹窗内可下载模板
- 单行出错不影响其他行，完成后显示新增 / 更新 / 跳过数量和出错行号
- 重复导入不会产生重复数据：学号相同则更新，学号为空时按「姓名 + 班级」匹配

**分析视频**：「视频分析」选学生 → 上传 → 开始分析。训练项目不用选，AI 自己识别。

| 项目 | 限制 |
|---|---|
| 格式 | MP4 / MOV / AVI / WebM |
| 大小 | ≤ 100MB |
| 时长 | 1~60 秒（建议 20~30 秒） |

> AVI 浏览器无法预览，上传页会显示占位卡片，但不影响分析——时长由服务端 ffprobe 校验。

**报告**：「训练报告」可按班级、学生、状态筛选，原视频可直接回放，右上角导出 CSV 或 Excel（选了学生就只导出该学生）；单份报告在详情页导出 PDF。

**球员能力**：结果页左下角的「本次能力分析」展示这一次视频的六维能力；左侧导航「球员能力」汇总学生历次训练和课堂评价，形成长期画像。详见下文。

**智能评价**：左侧导航「智能评价」→ 新建评价表 → 选类型和班级，学生自动带入 → 点「AI 一键评价」，星级、文字记录、评语和课堂总评一次填好，老师过目改几处即可。详见下文。

**数据大屏**：左侧导航最下方或首页右上角进入，全屏展示全校数据：班级星图、近 14 天趋势、表现等级分布、本周之星、精彩瞬间，每分钟自动刷新，右上角可一键全屏。

---

## 分班管理

班级不用单独维护，学生档案里填了班级，班级就出现了。

- **写法自动统一**：「二年级一班」「2年级（1）班」「二年级 1 班」保存时都会写成「2年级1班」，同一个班的学生不会被分成两个班；幼儿园的小班、中班、大班和认不出的写法（如「初一3班」）保持原样。添加、修改、Excel 导入都会统一。
- **老数据一键统一**：升级前存的写法不一致时，「学生管理」顶部会提示，例如「三年级二班 → 3年级2班（2 人）」，点一下全部改好，相关评价表一起改。
- **班级改名**：班级列表里点铅笔图标改名，全班学生和评价表一起改。
- **各模块通用**：训练报告、智能评价用班级标签筛选；视频分析、球员能力先选班级再选学生。

---

## 球员能力

**数据关系**：学生 → 多次训练视频 → 视频分析结果 → 每次能力评分 → 球员能力历史 → 图表。计算全部在前端完成（`frontend/src/lib/abilities.ts`），复用现有接口，没有新增后端服务，也没有改动视频分析接口。

**六维指标**按学生的场上位置选择，在「学生管理」或「球员能力」页设置，未设置时按中场展示：

| 位置 | 六维能力 |
|---|---|
| 前锋 | 射门、运球、速度、控球、传球、进攻 |
| 中场 | 传球、控球、运球、速度、射门、配合 |
| 后卫 | 防守、速度、传球、控球、运球、配合 |
| 门将 | 扑救、反应、手控球、脚下、出击、位置 |

- **结果页「本次能力分析」**：只反映这一次视频的表现，不代表长期能力
- **「球员能力」页**：综合能力与能力雷达取最近 3 次训练的平均；能力变化按训练先后逐项展示；训练表现统计包括各项平均评分（训练态度、团队纪律和当前位置的三项专项）、出勤、表现等级占比、本课亮点与需改进

**数据来源**（每张卡片都标了来源，页面底部有完整字段表）：

| 指标 | 字段 | 状态 |
|---|---|---|
| 表现等级、本课亮点、需改进 | `report.level` / `report.highlights` / `report.issues` | 已接入 |
| 训练时间、训练次数、场上位置 | `video.created_at` / `student.position` | 已接入 |
| 训练态度 / 团队纪律 / 位置专项三项 | 智能评价（常规、期中、期末、赛事评价，1~5 星） | 已接入；该学生没有记录时为**示例数据** |
| 出勤 | 常规评价的出勤情况 | 已接入 |
| 本课亮点 / 需改进 | 视频分析 + 常规、期中评价的亮点、待提高 | 已接入 |
| 六维能力分 | `report.abilities.<能力键>` | **示例数据** |

AI 目前还没有输出分项能力分，所以能力分由真实的综合表现星级和训练项目**推算**成示例值：同一条视频结果固定，结果页与球员能力页一致，界面标注「示例数据」。历史不足 4 次时会在前面补示例训练，图上用空心点区分。未识别到训练内容的视频不计入能力统计。

**接入真实能力分**：在提示词和报告里增加 `abilities` 字段（0~100，键名 `shooting` `dribbling` `speed` `control` `passing` `attack` `teamwork` `defense` `saving` `reaction` `handling` `footwork` `rushing` `positioning`）。前端检测到本位置六项齐全时自动改用真实值，页面无需改动。

---

## 智能评价

五种评价表，定义只在 `backend/internal/evaluation/schema.go` 维护一份，前端从接口读取：

| 类型 | 什么时候用 | 评价项 |
|---|---|---|
| 常规评价 | 日常训练 | 出勤情况、训练态度、团队纪律（全队通用）+ 位置专项；本次亮点、需改进 |
| 分层评价 | 颠球、脚内侧传球等专项练习 | 成绩、达到层级（按达标线自动判断）、动作规范、下一步练法 |
| 期中评价 | 学期中段 | 基础专项技术、体能水平、位置配合意识 + 位置专项；阶段亮点、待提高 |
| 期末评价 | 学期总评 | 位置专项技术、战术理解、成长进步、学期等级、教师寄语 |
| 赛事评价 | 比赛专用 | 本场位置、赛场作风、临场发挥、赛场贡献、进球、助攻 + 位置专项；赛后记录 |

**位置专项**按学生的场上位置嵌进常规、期中、期末、赛事四种表，每个位置看三项：

| 位置 | 看什么 |
|---|---|
| 前锋 | 射门、运球突破、进攻跑位 |
| 中场 | 传球、控球、配合意识 |
| 后卫 | 防守抢断、回追速度、补位配合 |
| 门将 | 扑救、手控球、出击 |

每一项都带观察要点（鼠标移到项目名上可见），视频分析也会按学生的位置重点看这些动作。

**分层评价**自带适合小学生的练习项目和默认达标线，建表时可以改，也能自定义项目：

| 项目 | 怎么测 | 基础层 / 提高层 / 挑战层 |
|---|---|---|
| 颠球 | 连续颠球次数 | ≥5 / ≥10 / ≥20 次 |
| 脚内侧传球 | 10 次中传进目标区的次数 | ≥4 / ≥6 / ≥8 次 |
| 脚内侧停球 | 10 次中停稳的次数 | ≥4 / ≥6 / ≥8 次 |
| 运球绕桩 | 绕完全程用时（越少越好） | ≤20 / ≤16 / ≤12 秒 |
| 脚背正面射门 | 10 次中射进的次数 | ≥3 / ≥5 / ≥7 次 |
| 脚底拉球 | 30 秒内交替拉球次数 | ≥15 / ≥25 / ≥35 次 |

填完成绩自动判断达到哪一层，老师也能手动改。

**和视频分析怎么配合**

- 常规评价：显示这名学生最近一次视频分析，「从视频预填」可把亮点、问题填进空着的亮点和需改进
- 期中、期末：表头填统计区间的开始日期（默认按学期推算），区间内的视频可直接回看
- 期末：区间内第一段和最后一段视频并排显示（期初 → 期末），「按视频对比预填」按表现变化给「成长进步」一个建议星级
- 赛事：只看比赛当天的录像，「从比赛录像预填」把亮点填进赛后记录

**AI 一键评价**

表格右上角「AI 一键评价」，整张表交给 AI 填，不用先打分：

- **AI 依据什么**：这名学生在相应时间范围内的视频分析结论（期末是期初、期末两段对比，赛事是比赛当天录像）、老师已经填的内容、同班最近几张评价表里这名学生的记录。三样都没有的学生会跳过，并提示先上传视频或先手动打几项分——没有材料就不编。
- **AI 填什么**：星级、位置专项、选项类（如学期等级）、文字记录和评语，一次填完。
- **AI 不填什么**：出勤情况、测评成绩、进球、助攻这类客观事实，只能老师录入；分层评价的层级仍按成绩自动判断。
- **两种范围**：「只补空着的地方」不动老师填过的内容；「全部重填」连已填的一起覆盖。可以勾「顺便写一段课堂总评」。
- **看得出是谁填的**：AI 填的格子是淡紫色、文字项带「AI」角标，老师改一下就变成自己填的，标记自动消失。
- **单独填一行**：每行右边的 ✳ 按钮只补这一名学生，适合补漏。
- 生成过程按每 3 人一批，可随时停止；结果随自动保存落库。

**其他**

- 新建时选班级，该班学生自动加入；也可以单独添加、移除学生
- 改动自动保存（停止输入 0.8 秒后），离开页面时会把最后的改动发出去
- **批量打分**：一次给全班某一项打同一个星级或同一个选项（如全班「出勤」），可选只填空白或全部覆盖
- **从视频预填**：不调用 AI，直接把视频分析里的亮点、问题原文填进空着的文字项
- **AI 生成评语**：只写评语、不动打分，参考老师的打分、文字记录和相应的视频分析结论，每人 60~150 字（按类型）；标注「AI 生成」或「老师填写」
- **课堂总评**：AI 根据全班统计写整体情况、做得好的、要加强的和接下来的教学建议
- 常规、期中、期末、赛事评价的星级会自动进入该学生「球员能力」页的训练表现统计
- **旧版评价表**：升级前建的评价表会变成「旧版」类型（如「技能评价（旧版）」），字段和数据原样保留，可以查看、修改和导出，但不能再新建

评语与总评用的是设置页里同一个模型，只发文字、不发图片。

---

## 导出

| 模块 | 格式 | 内容 |
|---|---|---|
| 训练报告 | Excel / CSV | 报告列表，按当前的班级、学生筛选导出 |
| 训练报告（单份） | PDF | 训练画面、综合表现、亮点、问题、建议、本次能力雷达 |
| 球员能力 | Excel | 能力概览、历次训练、课堂评价三个工作表，示例数据逐行标注来源 |
| 球员能力 | PDF | 能力档案：综合能力、雷达、能力变化、训练表现统计 |
| 智能评价 | Excel | 逐人评价（星级、次数为数字，可再统计）+ 班级统计和课堂总评 |
| 智能评价 | PDF | 横版评价表、学生评语、课堂总评 |

- **Excel** 用于存档和再统计（学号按文本写入，不会丢前导零）；CSV 只保留在训练报告，方便导入其他系统
- **PDF** 用于打印和发给家长：点「导出 PDF」会打开浏览器打印窗口，目标选「另存为 PDF」即可，默认文件名已填好，A4 版式。用浏览器打印而不是在前端生成 PDF，文字是矢量的，中文字体也不用另外打包

---

## 接口

除标注公开外均需 `Authorization: Bearer <token>`。

```
GET    /api/health                              健康检查（公开，容器编排用）
POST   /api/auth/login                          登录（公开）
POST   /api/auth/register                       注册（公开）
GET    /api/auth/me                             当前账号
POST   /api/auth/password                       修改密码

GET    /api/students                            列表（?keyword=）
POST   /api/students                            新增
PUT    /api/students/:id                        修改
DELETE /api/students/:id                        删除
POST   /api/students/import                     批量导入（字段名 file）
GET    /api/students/import-template?format=    下载模板（csv|xlsx）

POST   /api/videos/analyze                      上传并分析（video、student_id）
GET    /api/videos                              记录列表（?status= &student_id= &class_name= &limit=）
GET    /api/videos/:id                          单条详情（含报告）
GET    /api/videos/:id/thumb                    封面图
GET    /api/videos/:id/file?token=              视频流（支持 Range）
DELETE /api/videos/:id                          删除记录及视频
GET    /api/reports/export?format=              导出报告（csv|xlsx，可加 &student_id= 或 &class_name=）
GET    /api/stats/overview                      首页统计
GET    /api/stats/screen                        数据大屏汇总

GET    /api/evaluations/schema                  五种评价表的字段定义
GET    /api/evaluations                         评价表列表
POST   /api/evaluations                         新建（kind、class_name、title、lesson_date、teacher_name）
GET    /api/evaluations/:id                     详情（含每名学生的评价、评语、最近一次视频分析）
PUT    /api/evaluations/:id                     整表保存
DELETE /api/evaluations/:id                     删除
POST   /api/evaluations/:id/fill                AI 一键评价：整行评价+评语（student_ids 每次最多 8 人、overwrite）
POST   /api/evaluations/:id/comments            AI 生成评语（student_ids，每次最多 10 人）
POST   /api/evaluations/:id/summary             AI 生成课堂总评
GET    /api/students/:id/evaluations            该学生的全部评价记录

GET    /api/classes                             班级列表（人数、男女、建议写法）
POST   /api/classes/normalize                   把已有班级统一成标准写法
PUT    /api/classes/rename                      班级改名（学生和评价表一起改）
POST   /api/export/xlsx                         把表格数据生成 Excel（球员能力、智能评价导出用）

GET    /api/settings/llm                        读取模型配置（Key 为掩码）
PUT    /api/settings/llm                        保存模型配置
POST   /api/settings/llm/test                   测试连通性
```

视频播放接口用 URL 查询参数传 token 而非请求头——`<video>` 标签无法自定义请求头，改成下载 blob 又会丢掉流式播放和拖动进度条。其余接口一律走请求头。

---

## 数据与安全

- **加密存储**：训练报告正文、封面图（含学生人像）、课堂评价与评语、大模型 API Key 均以 AES-256-GCM 加密后存入 MySQL
- **密码**：bcrypt 哈希
- **视频保留**：默认长期保留在 `VIDEO_STORE_DIR`；超过容量上限时按最旧优先淘汰，被淘汰的记录标记为「视频已清理」，报告仍保留

---

## 目录结构

```
backend/
  cmd/server/          入口与路由
  internal/
    ai/                模型适配层（OpenAI 兼容）与提示词
    auth/              JWT、密码哈希、鉴权中间件
    classes/           班级名称统一与排序
    crypto/            AES-256-GCM 加解密
    db/                连接、自动迁移、初始化管理员
    evaluation/        评价表字段定义、校验、一键评价与评语提示词
    handler/           HTTP 接口
    model/             数据表结构
    service/           分析流程编排
    settings/          模型配置读写
    video/             校验、存储、抽帧、时长探测
  data/videos/         训练视频（自动创建）
frontend/
  src/pages/           登录、首页、视频分析、分析结果、报告、球员能力、智能评价、学生、设置、数据大屏
  src/components/      布局、UI 组件、品牌与足球图形；FeatureGalaxy 为首页星图，print/ 为 PDF 版式
  src/lib/             接口封装、视频校验、球员能力数据（abilities.ts）、评价表工具（evaluation.ts）、班级工具（classes.ts）
  src/store/           登录状态
assets/                设计稿与素材
data/test/             测试视频
```

---

## 常见问题

**分析失败，提示「AI分析失败」** — 到「设置」页点「测试连接」定位。常见原因：Key 无效、余额不足、`base_url` 填错、模型不支持图像输入。

**提示「视频处理失败」** — 多半是 ffmpeg 没装或不在 PATH，执行 `ffmpeg -version` 确认。

**启动报「APP_SECRET 未设置」** — `.env` 里补一段随机字符串。

**启动报「数据库初始化失败」** — 检查 MySQL 是否启动、账号密码是否正确、库是否已创建。

**标签页图标还是旧的** — favicon 缓存很顽固，硬刷新一次（Ctrl+Shift+R）。

**上传大文件返回 413** — Nginx 部署时检查 `client_max_body_size`（当前 120m）。

**报告说「画面中没有足球」** — 这通常是对的。实测中一段学生做抬膝动作但球始终不在画面里的视频，模型如实指出了。拍摄时让人和球都完整入镜。

---

## 能力边界

以下是**有意的取舍**，不是待修的缺陷：

- **不做精确计数和打分**。综合表现是「优秀 / 良好 / 一般 / 待提升」四档定性判断。模型无法从抽样画面精确测量触球次数或技术分，提示词中明确禁止编造这类数字。
- **球员能力的 0~100 分目前是示例数据**，由综合表现星级和训练项目推算，只用于搭好图表结构。以后接入 AI 输出，也只是模型根据抽样画面给出的估计，不是测量值，不宜作为正式成绩依据。
- **AI 结论仅供参考**，最终判断以老师现场观察为准。AI 评语和一键评价只依据老师的记录、视频分析结论和以往评价来写，发出前请老师过目。
- **一键评价填出来的是 AI 的判断，不是测量结果**。视频分析看的是技术动作，训练态度、团队纪律这类看不出来的项目，AI 没有依据时给中间档；界面上淡紫色标出所有 AI 填的格子，就是为了让老师一眼找到需要改的地方。
- **抽帧分析而非逐帧**，最多 12 帧，间隔按时长自适应——准确度与调用成本的平衡点。
