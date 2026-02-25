/**
 * mqtt/bridge/index.js
 * IOTA-MQTT Bridge — MQTT → IOTA Rebased 鏈寫入服務
 *
 * 功能:
 *   1. 訂閱 Mosquitto `home/devices/+/state` 主題
 *   2. 將每筆感測資料用 IOTA SDK programmableTransaction 寫入鏈
 *   3. 暴露 Prometheus metrics（/metrics port 9185）
 *
 * 環境變數:
 *   MQTT_HOST       Mosquitto hostname（預設 mosquitto）
 *   MQTT_PORT       MQTT TCP port（預設 1883）
 *   MQTT_USER       MQTT 使用者名稱（預設 bridge）
 *   MQTT_PASS       MQTT 密碼
 *   IOTA_RPC_URL    IOTA Full Node RPC URL（預設 http://fullnode:9000）
 *   IOTA_PRIVATE_KEY IOTA 簽名私鑰（Ed25519，Base64 格式）
 *   LOG_LEVEL       日誌等級（info/debug/warn/error）
 */

'use strict';

const mqtt = require('mqtt');
const { IotaClient, getFullnodeUrl } = require('@iota/iota-sdk/client');
const { Ed25519Keypair } = require('@iota/iota-sdk/keypairs/ed25519');
const { Transaction } = require('@iota/iota-sdk/transactions');
const http = require('http');
const { Registry, Counter, Gauge, Histogram } = require('prom-client');

// ── 設定 ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  mqtt: {
    host:   process.env.MQTT_HOST  || 'mosquitto',
    port:   parseInt(process.env.MQTT_PORT  || '1883', 10),
    user:   process.env.MQTT_USER  || 'bridge',
    pass:   process.env.MQTT_PASS  || '',
    clientId: `iota-mqtt-bridge-${Math.random().toString(16).slice(2, 8)}`,
    subscribeTopic: 'home/devices/+/state',
  },
  iota: {
    rpcUrl:     process.env.IOTA_RPC_URL     || 'http://fullnode:9000',
    privateKey: process.env.IOTA_PRIVATE_KEY || '',
    // Move package ID（home_iot::record 模組，部署後填入）
    packageId:  process.env.IOTA_PACKAGE_ID  || '0x0000000000000000000000000000000000000000000000000000000000000000',
  },
  metrics: {
    port: parseInt(process.env.METRICS_PORT || '9185', 10),
  },
  log: {
    level: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  },
};

// ── 日誌工具 ──────────────────────────────────────────────────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[CONFIG.log.level] ?? LEVELS.info;
const log = {
  debug: (...a) => currentLevel <= 0 && console.debug('[DEBUG]', new Date().toISOString(), ...a),
  info:  (...a) => currentLevel <= 1 && console.info ('[INFO] ', new Date().toISOString(), ...a),
  warn:  (...a) => currentLevel <= 2 && console.warn ('[WARN] ', new Date().toISOString(), ...a),
  error: (...a) => currentLevel <= 3 && console.error('[ERROR]', new Date().toISOString(), ...a),
};

// ── Prometheus Metrics ────────────────────────────────────────────────────────
const registry = new Registry();
registry.setDefaultLabels({ service: 'iota-mqtt-bridge' });

const metrics = {
  mqttMessages: new Counter({
    name: 'iota_mqtt_bridge_mqtt_messages_total',
    help: '從 MQTT 接收的訊息總數',
    labelNames: ['device_id'],
    registers: [registry],
  }),
  txSuccess: new Counter({
    name: 'iota_mqtt_bridge_transactions_total',
    help: '成功提交至 IOTA 鏈的交易總數',
    labelNames: ['device_id'],
    registers: [registry],
  }),
  txErrors: new Counter({
    name: 'iota_mqtt_bridge_transaction_errors_total',
    help: '提交 IOTA 交易失敗次數',
    labelNames: ['device_id', 'reason'],
    registers: [registry],
  }),
  txDuration: new Histogram({
    name: 'iota_mqtt_bridge_transaction_duration_seconds',
    help: 'IOTA 交易提交耗時（秒）',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  }),
  mqttConnected: new Gauge({
    name: 'iota_mqtt_bridge_mqtt_connected',
    help: 'MQTT 連線狀態（1=已連線，0=斷線）',
    registers: [registry],
  }),
};

// ── IOTA Client + Keypair 初始化 ──────────────────────────────────────────────
let iotaClient;
let keypair;

function initIota() {
  iotaClient = new IotaClient({ url: CONFIG.iota.rpcUrl });
  log.info('IOTA Client 已初始化:', CONFIG.iota.rpcUrl);

  if (CONFIG.iota.privateKey) {
    try {
      // Base64 格式私鑰（32 bytes）
      const keyBytes = Buffer.from(CONFIG.iota.privateKey, 'base64');
      keypair = Ed25519Keypair.fromSecretKey(keyBytes);
      log.info('IOTA Keypair 已載入，地址:', keypair.getPublicKey().toIotaAddress());
    } catch (e) {
      log.error('載入 IOTA 私鑰失敗，將以唯讀模式運行:', e.message);
      keypair = null;
    }
  } else {
    log.warn('未設定 IOTA_PRIVATE_KEY，交易提交功能停用（僅記錄日誌）');
    keypair = null;
  }
}

// ── 主要業務邏輯：提交交易 ────────────────────────────────────────────────────
async function submitIotaTransaction(deviceId, sensorData, timestamp) {
  if (!keypair) {
    log.warn(`[${deviceId}] 無私鑰，跳過上鏈（模擬模式）`);
    return { digest: 'DRY_RUN_NO_KEY', status: 'skipped' };
  }

  const timer = metrics.txDuration.startTimer();

  try {
    const senderAddress = keypair.getPublicKey().toIotaAddress();

    // 建立 programmableTransaction（呼叫 home_iot::record::record_state）
    const tx = new Transaction();
    tx.moveCall({
      target: `${CONFIG.iota.packageId}::home_iot::record_state`,
      arguments: [
        tx.pure.string(deviceId),
        tx.pure.string(JSON.stringify(sensorData)),
        tx.pure.string(timestamp),
      ],
    });
    tx.setSender(senderAddress);
    tx.setGasBudget(10_000_000n);

    // 簽名並提交
    const result = await iotaClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });

    timer({ status: 'success' });
    metrics.txSuccess.labels(deviceId).inc();

    const digest = result.digest;
    log.info(`[${deviceId}] ✅ 交易已上鏈 digest: ${digest}`);
    return { digest, status: 'confirmed' };

  } catch (err) {
    timer({ status: 'error' });
    const reason = err.code || err.message?.split(':')[0] || 'unknown';
    metrics.txErrors.labels(deviceId, reason).inc();
    log.error(`[${deviceId}] ❌ 交易失敗:`, err.message);
    throw err;
  }
}

// ── MQTT 客戶端 ────────────────────────────────────────────────────────────────
function initMqtt() {
  const client = mqtt.connect({
    host:     CONFIG.mqtt.host,
    port:     CONFIG.mqtt.port,
    clientId: CONFIG.mqtt.clientId,
    username: CONFIG.mqtt.user,
    password: CONFIG.mqtt.pass,
    protocolVersion: 4,
    keepalive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    will: {
      topic:   'home/bridge/status',
      payload: 'offline',
      qos:     1,
      retain:  true,
    },
  });

  client.on('connect', () => {
    metrics.mqttConnected.set(1);
    log.info(`MQTT 已連線至 ${CONFIG.mqtt.host}:${CONFIG.mqtt.port}`);

    // 訂閱設備狀態主題
    client.subscribe(CONFIG.mqtt.subscribeTopic, { qos: 1 }, (err) => {
      if (err) {
        log.error('訂閱失敗:', err.message);
      } else {
        log.info(`已訂閱: ${CONFIG.mqtt.subscribeTopic}`);
      }
    });

    // 發布上線狀態
    client.publish('home/bridge/status', 'online', { qos: 1, retain: true });
  });

  client.on('reconnect', () => log.info('MQTT 重新連線中...'));
  client.on('disconnect', () => { metrics.mqttConnected.set(0); log.warn('MQTT 已斷線'); });
  client.on('error', (err) => { metrics.mqttConnected.set(0); log.error('MQTT 錯誤:', err.message); });

  client.on('message', async (topic, payloadBuf) => {
    // 擷取 device_id（topic: home/devices/{device_id}/state）
    const parts = topic.split('/');
    const deviceId = parts[2] || 'unknown';

    let sensorData;
    try {
      sensorData = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      sensorData = { raw: payloadBuf.toString('utf8') };
    }

    metrics.mqttMessages.labels(deviceId).inc();
    log.debug(`[${deviceId}] 收到訊息:`, JSON.stringify(sensorData));

    const timestamp = new Date().toISOString();

    try {
      const result = await submitIotaTransaction(deviceId, sensorData, timestamp);
      // 將 tx_digest 發布回設備
      client.publish(
        `home/devices/${deviceId}/tx_digest`,
        JSON.stringify({ txDigest: result.digest, status: result.status, timestamp }),
        { qos: 1 }
      );
    } catch (err) {
      // 發布錯誤通知
      client.publish(
        `home/devices/${deviceId}/tx_digest`,
        JSON.stringify({ error: err.message, status: 'failed', timestamp }),
        { qos: 1 }
      );
    }
  });

  return client;
}

// ── Prometheus HTTP 端點（/metrics） ─────────────────────────────────────────
function startMetricsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } else if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(CONFIG.metrics.port, () => {
    log.info(`Prometheus metrics 可用: http://localhost:${CONFIG.metrics.port}/metrics`);
  });
}

// ── 主程式 ────────────────────────────────────────────────────────────────────
async function main() {
  log.info('=== IOTA-MQTT Bridge 啟動 ===');
  log.info('IOTA RPC:', CONFIG.iota.rpcUrl);
  log.info('MQTT:', `${CONFIG.mqtt.host}:${CONFIG.mqtt.port}`);

  initIota();
  initMqtt();
  startMetricsServer();

  // 優雅關閉
  process.on('SIGTERM', () => {
    log.info('收到 SIGTERM，正在關閉...');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    log.info('收到 SIGINT，正在關閉...');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
