# mqtt/bridge/Dockerfile
# IOTA-MQTT Bridge 容器映像
# Base: node:20-alpine（輕量）

FROM node:20-alpine

# 安全性：不以 root 運行
RUN addgroup -S bridge && adduser -S bridge -G bridge

WORKDIR /app

# 先複製 package 檔案以利 Docker layer 快取
COPY package.json ./

# 安裝生產依賴（跳過 devDependencies）
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 複製應用程式原始碼
COPY index.js ./

# 切換至非特權使用者
USER bridge

# 暴露 Prometheus metrics 端口
EXPOSE 9185

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:9185/health || exit 1

# 啟動
CMD ["node", "index.js"]
