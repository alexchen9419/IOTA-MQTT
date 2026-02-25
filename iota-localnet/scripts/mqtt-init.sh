#!/usr/bin/env bash
# scripts/mqtt-init.sh — 初始化 Mosquitto MQTT 使用者及密碼檔
# 用法: bash scripts/mqtt-init.sh
# 說明: 此腳本需在 Mosquitto 容器啟動前執行（或透過臨時容器執行）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PASSWD_FILE="$ROOT_DIR/mqtt/config/passwd"

echo "===== MQTT 使用者初始化 ====="
echo "密碼檔位置: $PASSWD_FILE"
echo ""

# 確認 mosquitto_passwd 工具存在
if ! command -v mosquitto_passwd &>/dev/null; then
  echo "[INFO] 系統未安裝 mosquitto_passwd，改用 Docker 容器執行..."
  USE_DOCKER=true
else
  USE_DOCKER=false
fi

# ── 設定密碼（可根據實際環境修改） ────────────────────────────────────────
IOT_PASSWORD="${MQTT_IOT_PASS:-iot_device_2026}"
BRIDGE_PASSWORD="${MQTT_BRIDGE_PASS:-bridge_secret}"
NODERED_PASSWORD="${MQTT_NODERED_PASS:-nodered_secret}"
ADMIN_PASSWORD="${MQTT_ADMIN_PASS:-admin_secret}"

echo "建立使用者（密碼可透過環境變數覆寫）:"
echo "  MQTT_IOT_PASS      → iot 帳號"
echo "  MQTT_BRIDGE_PASS   → bridge 帳號"
echo "  MQTT_NODERED_PASS  → nodered 帳號"
echo "  MQTT_ADMIN_PASS    → admin 帳號"
echo ""

create_passwd_entry() {
  local user="$1"
  local pass="$2"
  local passwd_file="$3"

  if [[ "$USE_DOCKER" == "true" ]]; then
    # 使用 eclipse-mosquitto 容器中的工具
    if [[ ! -f "$passwd_file" ]]; then
      # 建立初始使用者（-c 建立新檔案）
      docker run --rm \
        -v "$(dirname "$passwd_file"):/tmp/mqtt" \
        eclipse-mosquitto:2 \
        mosquitto_passwd -b -c "/tmp/mqtt/passwd" "$user" "$pass"
      return
    else
      docker run --rm \
        -v "$(dirname "$passwd_file"):/tmp/mqtt" \
        eclipse-mosquitto:2 \
        mosquitto_passwd -b "/tmp/mqtt/passwd" "$user" "$pass"
      return
    fi
  fi

  # 本機工具
  if [[ ! -f "$passwd_file" ]]; then
    mosquitto_passwd -b -c "$passwd_file" "$user" "$pass"
  else
    mosquitto_passwd -b "$passwd_file" "$user" "$pass"
  fi
}

# ── 建立各使用者 ────────────────────────────────────────────────────────────
echo "[1/4] 建立 iot 使用者..."
create_passwd_entry "iot" "$IOT_PASSWORD" "$PASSWD_FILE"
echo "  iot ✓"

echo "[2/4] 建立 bridge 使用者..."
create_passwd_entry "bridge" "$BRIDGE_PASSWORD" "$PASSWD_FILE"
echo "  bridge ✓"

echo "[3/4] 建立 nodered 使用者..."
create_passwd_entry "nodered" "$NODERED_PASSWORD" "$PASSWD_FILE"
echo "  nodered ✓"

echo "[4/4] 建立 admin 使用者..."
create_passwd_entry "admin" "$ADMIN_PASSWORD" "$PASSWD_FILE"
echo "  admin ✓"

echo ""
echo "✅ MQTT 使用者初始化完成！密碼檔: $PASSWD_FILE"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MQTT 帳號資訊（請妥善保管）:"
echo "  iot        密碼: $IOT_PASSWORD"
echo "  bridge     密碼: $BRIDGE_PASSWORD"
echo "  nodered    密碼: $NODERED_PASSWORD"
echo "  admin      密碼: $ADMIN_PASSWORD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "請將以上密碼填入 docker-compose.yml 中對應的環境變數："
echo "  iota-mqtt-bridge: MQTT_PASS=bridge_secret"
echo "  grafana:  MQTT datasource password=admin_secret"
echo ""
echo "下一步: docker compose up -d"
