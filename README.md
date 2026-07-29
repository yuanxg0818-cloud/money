# 盘前 · AI 投研 H5

这是 A 股盘前研究助手的 EdgeOne Makers 部署版。页面仅分析沪深主板股票与 ETF，支持：

- 点击时重新获取主要指数、主板与 ETF 行情和财经快讯；
- 查看上涨潜力 Top 10、评分因子、价格条件、入选理由与风险；
- 手工录入或通过截图识别持仓；
- 在独立持仓诊断区逐只获得持有、加仓、减仓或卖出条件；
- 默认使用服务端托管的 Moonshot API 与 `kimi-k2.6`，也允许用户临时切换到自己的模型 Key；
- 仅在当前浏览器保存持仓及风险偏好；
- 通过服务端代理调用独立的 Python 行情分析引擎。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

默认打开 `http://localhost:3000`。点击生成时，页面先用公开行情和财经快讯建立事实层，再调用用户已测试连接的模型进行结构化综合研判。未连接模型、实时源校验失败或模型调用失败时，不生成买卖建议，也不会用规则或演示数据静默替代。

## 环境变量

在 EdgeOne Makers 的生产环境变量中按需配置：

```dotenv
# Python 分析引擎的公网 HTTPS 地址
ANALYTICS_API_BASE_URL=https://your-engine.example.com

# 上述地址允许访问的主机名，多个域名用逗号分隔
ANALYTICS_ALLOWED_HOSTS=your-engine.example.com

# 必须与分析引擎中的同名变量一致
ANALYTICS_SHARED_SECRET=use-a-long-random-secret

# 允许用户在 H5 中填写的模型 API 主机名
LLM_ALLOWED_HOSTS=api.openai.com,api.moonshot.cn

# 默认 Kimi 服务端密钥，只能配置在 EdgeOne 环境变量中
MOONSHOT_API_KEY=replace-with-a-rotated-key

# 可选；不填写时默认 kimi-k2.6
MOONSHOT_MODEL=kimi-k2.6
```

不要将真实 Key 写入 `.env.example`、Git、网页源码或 URL。

## 数据与密钥边界

- 默认 Kimi Key 只保存在 EdgeOne 的加密环境变量中，不写入网页、GitHub 或浏览器。
- 用户自行填写的模型 Key 默认只存在当前页面内存；可选择保存在当前标签页的 `sessionStorage`。
- 用户 Key 只随“连接测试”“截图识别”或“生成综合建议”请求发送给本站服务端，再临时转发到用户配置的模型 API。
- 服务端不记录用户 Key；持仓与风险设置仅保存在当前浏览器。
- 自定义模型地址必须是 HTTPS，且主机名必须加入服务端白名单，以避免 SSRF。
- Moonshot 使用 `https://api.moonshot.cn/v1`，持仓截图识别建议选择 `kimi-k2.6`。
- 持仓截图会发送给用户选择的模型服务商，页面会在上传区明确提示。
- 生成综合建议时，最新行情摘要、技术与风险因子、财经快讯以及用户录入的持仓会发送给用户选择的模型服务商。
- 持仓诊断默认不发送证券代码。用户单独确认后，站点仅把证券代码临时发送给东方财富公开行情接口查询实时价格，不发送数量、成本、资金或账户信息。

## 构建

```bash
npm run build
npm test
```

## EdgeOne Makers 部署

1. 将本分支推送到 EdgeOne 可访问的 GitHub、GitLab 或 Gitee 仓库。
2. 在 Makers 创建 Next.js 项目，生产分支选择 `main`。
3. `edgeone.json` 已固定 `.next` 全栈输出目录、Node.js 22.17.1、广州 Cloud Functions 与 120 秒超时，避免项目被误判为纯静态站点。
4. 在生产环境配置 `MOONSHOT_API_KEY`、`MOONSHOT_MODEL=kimi-k2.6` 和 `LLM_ALLOWED_HOSTS=api.openai.com,api.moonshot.cn`；按需配置高级分析引擎的三个环境变量。
5. 部署完成后绑定已备案的自定义域名。

## 推荐部署拓扑

1. 本目录部署到 EdgeOne Makers，承载 H5 与安全代理层。
2. `../a_share_copilot` 用其 `Dockerfile` 部署到支持长期运行 Python 容器的平台。
3. 在 H5 侧配置分析引擎地址、主机白名单和共享密钥。
4. 自定义域名放在 H5 前面；Python 引擎无需直接暴露给浏览器。

分析引擎必须保持 `DATA_MODE=live`、`ALLOW_DEMO_FALLBACK=false`，以免数据源失败时生成看似真实的演示交易建议。
