#!/usr/bin/env bash
# bootstrap-genesis.sh — 為 IOTA 私有網路產生金鑰與 genesis.blob
# 執行前請確認 `iota` CLI 已安裝並在 PATH 中
# 用法: bash scripts/bootstrap-genesis.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

GENESIS_DIR="$ROOT_DIR/genesis"

echo "===== IOTA Private Network Genesis Bootstrap ====="
echo "Root: $ROOT_DIR"

# ── 確認 iota CLI 存在 ──────────────────────────────────────────────────────
if ! command -v iota &>/dev/null; then
  echo "[ERROR] 找不到 'iota' CLI，請先安裝："
  echo "  # 從 GitHub Releases 下載（Linux x86_64）:"
  echo "  curl -L -o /tmp/iota.tgz https://github.com/iotaledger/iota/releases/download/v1.17.2/iota-v1.17.2-linux-x86_64.tgz"
  echo "  tar -xzf /tmp/iota.tgz -C /tmp && sudo cp /tmp/iota /usr/local/bin/ && sudo chmod +x /usr/local/bin/iota"
  exit 1
fi
echo "[OK] iota CLI: $(iota --version)"

# ── 清理並建立 genesis 目錄 ─────────────────────────────────────────────────
echo ""
echo "[1/3] 準備 genesis 目錄..."
mkdir -p "$GENESIS_DIR"

# 若已存在 genesis.blob，先備份
if [[ -f "$GENESIS_DIR/genesis.blob" ]]; then
  BACKUP="$GENESIS_DIR/genesis.blob.backup.$(date +%Y%m%d%H%M%S)"
  mv "$GENESIS_DIR/genesis.blob" "$BACKUP"
  echo "  [備份] 已將舊 genesis.blob 備份至 $BACKUP"
fi

# ── 使用 iota genesis 一鍵產生 2 驗證者私有網路 ────────────────────────────
echo ""
echo "[2/3] 執行 iota genesis（2 個驗證者，本地私有網路）..."
echo "  工作目錄: $GENESIS_DIR"
echo ""

cd "$ROOT_DIR"
iota genesis \
  --working-dir "$GENESIS_DIR" \
  --committee-size 2 \
  --epoch-duration-ms 60000 \
  --force

echo ""
echo "[3/3] 複製金鑰與設定至各節點目錄..."

# iota genesis 產出: genesis/validator-config-0/, validator-config-1/
# 每個目錄含 validator.yaml, account.key, authority.key, network.key, protocol.key
for i in 0 1; do
  VNUM=$((i + 1))
  SRC="$GENESIS_DIR/validator-config-$i"
  DST_CONFIG="$ROOT_DIR/validator${VNUM}/config"
  DST_KEYS="$ROOT_DIR/validator${VNUM}/key-pairs"

  if [[ -d "$SRC" ]]; then
    mkdir -p "$DST_CONFIG" "$DST_KEYS"
    # 複製 yaml 設定
    [[ -f "$SRC/validator.yaml" ]] && cp "$SRC/validator.yaml" "$DST_CONFIG/validator.yaml"
    # 複製所有金鑰
    for keyfile in account.key authority.key network.key protocol.key worker.key; do
      [[ -f "$SRC/$keyfile" ]] && cp "$SRC/$keyfile" "$DST_KEYS/$keyfile"
    done
    echo "  validator${VNUM} 設定 ✓ (來源: $SRC)"
  else
    echo "  [WARN] 找不到 $SRC，請手動確認 genesis 輸出目錄"
  fi
done

# ── 驗證輸出 ─────────────────────────────────────────────────────────────────
echo ""
if [[ -f "$GENESIS_DIR/genesis.blob" ]]; then
  echo "✅ genesis.blob 已成功產生："
  echo "   路徑: $GENESIS_DIR/genesis.blob"
  echo "   大小: $(du -sh "$GENESIS_DIR/genesis.blob" | cut -f1)"
  echo ""
  echo "   genesis 目錄內容:"
  ls -lh "$GENESIS_DIR/"
else
  echo "[ERROR] genesis.blob 未產生，請檢查上方錯誤訊息。"
  exit 1
fi

echo ""
echo "===== Bootstrap 完成 ====="
echo "下一步: bash scripts/mqtt-init.sh"
echo "        docker compose up -d"
