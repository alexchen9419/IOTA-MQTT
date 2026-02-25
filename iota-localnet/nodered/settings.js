/**
 * nodered/settings.js — Node-RED 設定檔
 * 文件: https://nodered.org/docs/user-guide/runtime/configuration
 */
module.exports = {
    // ── 流程檔位置 ──────────────────────────────────────────────────────────
    flowFile: "flows.json",
    flowFilePretty: true,

    // ── 使用者資料目錄 ─────────────────────────────────────────────────────
    userDir: "/data",

    // ── HTTP 伺服器設定 ─────────────────────────────────────────────────────
    uiPort: process.env.PORT || 1880,

    // 管理 API（可限制存取） — 雛形環境不啟用驗證
    adminAuth: null,
    // 正式環境建議啟用:
    // adminAuth: {
    //     type: "credentials",
    //     users: [{ username: "admin", password: "<bcrypt_hash>", permissions: "*" }]
    // },

    // ── HTTP 靜態資源 ───────────────────────────────────────────────────────
    httpStatic: "/data/public",

    // ── 功能節點 (Function node) 設定 ─────────────────────────────────────
    functionGlobalContext: {
        // 全域變數：注入 IOTA Full Node RPC URL
        iotaRpcUrl: process.env.IOTA_RPC_URL || "http://fullnode:9000",
        mqttBroker: process.env.MQTT_HOST || "mosquitto",
    },

    // 關閉 Function 節點的外部模組限制（讓 flows.json 可 require npm 套件）
    functionExternalModules: true,

    // ── 節點目錄 ────────────────────────────────────────────────────────────
    nodesDir: "/data/nodes",

    // ── 日誌設定 ────────────────────────────────────────────────────────────
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: true,
        },
    },

    // ── 編輯器設定 ──────────────────────────────────────────────────────────
    editorTheme: {
        page: {
            title: "IOTA IoT Node-RED",
        },
        header: {
            title: "IOTA IoT Flow Engine",
        },
        projects: {
            enabled: false,
        },
        palette: {
            // 自動安裝的 npm 套件
            // 放在 /data/package.json 中定義
        },
    },

    // ── 訊息佇列 ────────────────────────────────────────────────────────────
    // 防止高頻 IoT 訊息壓垮 Node-RED
    nodeMessageBufferMaxLength: 1000,
};
