# IOTA Rebased 私有網路 + IoT 監控平台

使用 Docker Compose 快速部署包含 IOTA 區塊鏈節點、MQTT Broker、Node-RED 與 Grafana 的完整 IoT 上鏈環境。

---

## 架構概覽

```
┌─────────────────────────────────────────────────────────────────┐
│                        iota-net (172.30.0.0/16)                 │
│                                                                   │
│  IoT 設備 ──MQTT TCP:1883──► mosquitto ◄──WebSocket:9883──► 瀏覽器│
│                                 │                                 │
│                     ┌───────────┤                                 │
│                     ▼           ▼                                 │
│              iota-mqtt-bridge  nodered:1880                       │
│                     │           │                                 │
│                     └───────────┼──► fullnode:9000 (JSON-RPC/WS) │
│                                 │        │                        │
│                          validator1 ◄───► validator2             │
│                                          │                        │
│                                     indexer:9001                  │
│                                          │                        │
│                                     postgres:5432                 │
│                                                                   │
│  prometheus:9090 ◄── [所有節點 :9184 metrics]                     │
│       │                                                           │
│       ▼                                                           │
│  grafana:3001 ⭐  (主要 WebUI 監控儀表板)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 服務清單

| 服務 | 映像 | 對外 Port | 說明 |
|------|------|-----------|------|
| `validator1` | `iotaledger/iota-node:mainnet` | 8180, 8184/udp | IOTA 驗證者節點 1 |
| `validator2` | `iotaledger/iota-node:mainnet` | 8280, 8284/udp | IOTA 驗證者節點 2 |
| `fullnode` | `iotaledger/iota-node:mainnet` | **9000** | 主要 JSON-RPC / WebSocket |
| `postgres` | `postgres:15-alpine` | 5432 | Indexer 資料庫 |
| `indexer` | `iotaledger/iota-indexer:mainnet` | 9001 | IOTA 索引器 |
| `mosquitto` | `eclipse-mosquitto:2` | **1883** (TCP), 9883 (WS) | MQTT Broker |
| `nodered` | `nodered/node-red:latest` | **1880** | IoT 流程引擎 |
| `iota-mqtt-bridge` | 自訂 `node:20-alpine` | 9185 (metrics) | MQTT→IOTA 鏈寫入 Bridge |
| `prometheus` | `prom/prometheus:latest` | 9090 | 指標收集 |
| `grafana` | `grafana/grafana:latest` | **3001** ⭐ | 監控儀表板 |

---

## 快速啟動

### 前置需求

- Docker >= 24.0 與 Docker Compose v2
- `iota` CLI（用於 genesis 引導）
- `jq`（JSON 工具）

### Step 1：安裝 iota CLI

```bash
# 官方安裝腳本
curl -fsSL https://get.iota.org | sh
# 或從 GitHub Releases 下載二進位檔案
# https://github.com/iotaledger/iota/releases

# 確認安裝
iota --version
```

### Step 2：產生 Genesis

```bash
cd iota-localnet
bash scripts/bootstrap-genesis.sh
```

此腳本將：
- 為 validator1 與 validator2 各產生三把金鑰（authority/protocol/network）
- 產生 `genesis/genesis.blob`（鏈啟動必需）

> ⚠️ **注意**：genesis.blob 一旦產生請勿刪除，否則需重新執行此步驟並清除所有節點資料庫。

### Step 3：初始化 MQTT 使用者

```bash
bash scripts/mqtt-init.sh
```

預設密碼（可透過環境變數覆寫）：
- `iot` / `iot_device_2026`
- `bridge` / `bridge_secret`
- `nodered` / `nodered_secret`
- `admin` / `admin_secret`

```bash
# 自訂密碼範例
MQTT_IOT_PASS=my_iot_pw MQTT_ADMIN_PASS=my_admin_pw bash scripts/mqtt-init.sh
```

完成後需更新 `docker-compose.yml` 中 `iota-mqtt-bridge` 的 `MQTT_PASS` 與 Grafana MQTT datasource 密碼。

### Step 4：設定 IOTA Bridge 私鑰（可選）

若要讓 `iota-mqtt-bridge` 實際提交交易，需提供已有 IOTA 代幣的帳戶私鑰：

```bash
# 產生新帳戶
iota keytool generate ed25519

# 取得私鑰（base64 格式）並填入 docker-compose.yml
# IOTA_PRIVATE_KEY=<your_base64_private_key>
```

> 若不填入私鑰，Bridge 將以「模擬模式」運行（收訊息但不上鏈）。

### Step 5：啟動所有服務

```bash
docker compose up -d
```

首次啟動因需下載映像約需 5-15 分鐘，可用以下指令觀察進度：

```bash
docker compose logs -f
```

---

## 存取各服務

| 服務 | URL | 帳號/密碼 |
|------|-----|----------|
| **Grafana 監控儀表板** | http://localhost:3001 | admin / admin |
| **Node-RED 流程編輯器** | http://localhost:1880 | — |
| **IOTA JSON-RPC** | http://localhost:9000 | — |
| **MQTT Broker (TCP)** | mqtt://localhost:1883 | iot / iot_device_2026 |
| **MQTT Broker (WebSocket)** | ws://localhost:9883 | iot / iot_device_2026 |
| **Prometheus** | http://localhost:9090 | — |
| **IOTA Indexer API** | http://localhost:9001 | — |

---

## 驗證

### 確認 IOTA 鏈正常運行

```bash
curl -s -X POST http://localhost:9000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"iota_getTotalTransactionBlocks","params":[]}' \
  | jq .
# → {"jsonrpc":"2.0","id":1,"result":"<數字>"}
```

### 確認所有容器運行中

```bash
docker compose ps
# 所有服務 STATUS 應為 running (healthy)
```

### 測試 MQTT + IoT 上鏈流程

```bash
# 發送感測資料（模擬 IoT 設備）
mosquitto_pub \
  -h localhost -p 1883 \
  -u iot -P iot_device_2026 \
  -t home/devices/light01/state \
  -m '{"power":"on","brightness":80,"temperature":25.3}' \
  -q 1

# 訂閱 tx_digest 回傳（在另一個終端機）
mosquitto_sub \
  -h localhost -p 1883 \
  -u iot -P iot_device_2026 \
  -t home/devices/light01/tx_digest
# → {"txDigest":"<IOTA tx hash>","status":"confirmed","timestamp":"..."}
```

### 確認 Grafana 儀表板

1. 開啟 http://localhost:3001
2. 登入 admin / admin
3. 進入 **IOTA Localnet 總覽** 儀表板
4. 確認 validator1、validator2、fullnode 狀態燈號為綠色

### 確認 Node-RED 流程

1. 開啟 http://localhost:1880
2. 確認三條 flow 的節點呈 **綠色 connected** 狀態：
   - `home/devices/+/state` → MQTT in 節點
   - `POST /api/device/:id/command` → HTTP in 節點
   - WebSocket IOTA Full Node → WebSocket in 節點

---

## MQTT Topic 設計

```
home/
├── devices/
│   └── {device_id}/
│       ├── state      ← 設備 publish 感測資料（iot 帳號）
│       ├── tx_digest  ← Bridge publish IOTA 交易確認
│       └── command    ← Node-RED publish 控制指令
├── broadcast/         ← 廣播訊息（所有設備訂閱）
├── bridge/
│   └── status        ← Bridge 上線/離線狀態（retained）
├── nodered/
│   └── status        ← Node-RED 上線/離線狀態
└── iota/
    └── events        ← IOTA 鏈上事件（Flow 3 廣播）
```

---

## Node-RED Flow 說明

### Flow 1：設備狀態上鏈

```
[MQTT in] home/devices/+/state
    → [Function] 驗證 & 擷取 device_id
    → [Function] 組裝 IOTA Move transaction payload
    → [HTTP Request] POST http://fullnode:9000
    → [Function] 擷取 tx_digest
    → [MQTT out] home/devices/{device_id}/tx_digest
```

### Flow 2：設備控制

```
[HTTP in] POST /api/device/:id/command
    → [Function] 驗證指令（白名單: power_on/off, set_brightness 等）
    → [MQTT out] home/devices/{device_id}/command
       + [HTTP Response] 202 Accepted
```

### Flow 3：IOTA 事件監聽

```
[WebSocket in] ws://fullnode:9000
    → [Function] 解析 Checkpoint 事件
    → [Switch] 過濾 home_iot / HomeDevice 相關交易
    → [Function] 格式化廣播訊息
    → [MQTT out] home/iota/events
```

> **提示**：Flow 1 的 IOTA 交易提交功能在 `iota-mqtt-bridge` 容器中已獨立實作。Node-RED 中的 Flow 1 作為備援並提供視覺化監控，可在 Node-RED 中停用以避免重複上鏈。

---

## 常用指令

```bash
# 查看所有服務日誌
docker compose logs -f

# 查看特定服務日誌
docker compose logs -f fullnode
docker compose logs -f iota-mqtt-bridge

# 重啟特定服務
docker compose restart grafana

# 停止所有服務（保留資料）
docker compose stop

# 完全清除（包含 volumes，⚠️ 會刪除鏈上資料！）
docker compose down -v

# 重新建置 Bridge 映像
docker compose build iota-mqtt-bridge

# 查看 Prometheus metrics
curl -s http://localhost:9090/metrics | grep iota_
```

---

## 部署 home_iot Move 模組（進階）

若要讓 `iota-mqtt-bridge` 實際呼叫自訂 Move 模組，需先部署：

```bash
# 1. 建立 Move 套件
mkdir -p move/home_iot/sources
cat > move/home_iot/Move.toml << 'EOF'
[package]
name = "home_iot"
version = "0.0.1"
edition = "2024.beta"

[dependencies]
Iota = { git = "https://github.com/iotaledger/iota", subdir = "crates/iota-framework/packages/iota-framework", rev = "mainnet" }

[addresses]
home_iot = "0x0"
EOF

# 2. 建立 Move 模組原始碼
cat > move/home_iot/sources/record.move << 'EOF'
module home_iot::home_iot {
    use iota::event;
    use std::string::String;

    public struct IotRecord has copy, drop {
        device_id: String,
        data: String,
        timestamp: String,
        submitter: address,
    }

    public entry fun record_state(
        device_id: String,
        data: String,
        timestamp: String,
        ctx: &mut iota::tx_context::TxContext
    ) {
        let record = IotRecord {
            device_id,
            data,
            timestamp,
            submitter: iota::tx_context::sender(ctx),
        };
        event::emit(record);
    }
}
EOF

# 3. 部署至私有網路
iota client publish move/home_iot --gas-budget 50000000

# 4. 將輸出的 Package ID 填入 docker-compose.yml
# IOTA_PACKAGE_ID=0x<your_package_id>
```

---

## 故障排查

### genesis-init 容器退出異常

```
[genesis-init] ERROR: /genesis/genesis.blob 不存在！
```

**解決**：執行 `bash scripts/bootstrap-genesis.sh`

### Validator 無法互相 P2P 連接

確認 `validator.yaml` 中的 `peer-id` 已填入對方的 network public key（十六進位），這需要從 bootstrap-genesis.sh 產生的金鑰中擷取。

### MQTT 認證失敗

確認 `mqtt/config/passwd` 檔案已存在（執行 `bash scripts/mqtt-init.sh`），且密碼與 docker-compose.yml 中設定的一致。

### Grafana MQTT datasource 無法連線

Mosquitto 的 WebSocket 端口在容器內為 `:9001`，但對外對映至 `:9883`。Grafana 在 `iota-net` 內部存取時應使用 `ws://mosquitto:9001`（已在 datasources.yml 設定）。

---

## 目錄結構

```
iota-localnet/
├── docker-compose.yml          主要 Compose 設定
├── genesis/
│   ├── genesis.blob            鏈啟動 genesis（由腳本產生）
│   ├── v1.info                 validator1 資訊
│   └── v2.info                 validator2 資訊
├── scripts/
│   ├── bootstrap-genesis.sh    Genesis 引導腳本
│   └── mqtt-init.sh            MQTT 使用者初始化腳本
├── validator1/
│   ├── config/validator.yaml   驗證者 1 設定
│   └── key-pairs/              驗證者 1 金鑰
├── validator2/
│   ├── config/validator.yaml   驗證者 2 設定
│   └── key-pairs/              驗證者 2 金鑰
├── fullnode/
│   └── config/fullnode.yaml    Full Node 設定
├── monitoring/
│   ├── prometheus.yml          Prometheus 抓取設定
│   └── grafana/
│       ├── dashboards/
│       │   └── iota-overview.json  監控儀表板
│       └── provisioning/
│           ├── datasources.yml     資料來源（Prometheus + MQTT）
│           └── dashboards.yml      儀表板自動載入設定
├── mqtt/
│   ├── config/
│   │   ├── mosquitto.conf      MQTT Broker 設定
│   │   ├── acl.conf            MQTT ACL 存取控制
│   │   └── passwd              MQTT 使用者密碼（由腳本產生）
│   └── bridge/
│       ├── index.js            MQTT→IOTA Bridge 主程式
│       ├── package.json        Node.js 依賴
│       └── Dockerfile          Bridge 容器映像
└── nodered/
    ├── settings.js             Node-RED 設定
    └── flows.json              IoT 流程定義（3 條 flow）
```
