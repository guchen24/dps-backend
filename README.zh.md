# dps-backend

DeepSeek Harness 的 Host、Web UI 构建链和 Docker 后端部署仓库。由于
`dsh web` 需要从同一个 pnpm workspace 组装 Host、Typert、Client 和 Vite
产物，本仓库保留官方 Harness 的源码布局。

## Docker 部署

```powershell
cd docker
Copy-Item .env.example .env
# 编辑 .env，填写 DEEPSEEK_API_KEY
docker compose up -d --build
```

服务只监听 `http://127.0.0.1:3080`。API Key 只保存在被 Git 忽略的
`docker/.env` 中，不会进入镜像源码、Web UI 或桌面 EXE。配套的 Tauri
薄壳仓库是：
https://github.com/guchen24/dps-frontend

## 源码开发

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm dsh web --no-open
```

`backend/` 提供源码开发入口，`docker/` 是唯一支持的本机 Docker 部署入口。

## 上游

本仓库基于 MIT 许可的
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 进行二开。
上游提交和升级规则见 [`UPSTREAMS.md`](UPSTREAMS.md)。

## 许可证

[MIT](LICENSE)
