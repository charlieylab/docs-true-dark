# Docs True Dark

Google Docs 深色模式插件。**圖片保持原始像素，完全不變色。**

## 原理

Google Docs 把整份文件畫在 `<canvas>` 上。其他插件會用 CSS `invert()` 翻轉整張畫布，所以圖片也跟著變成負片；DarkWave 則是先翻轉、再把圖片翻回來，只能做到「接近原色」。

這個插件完全不翻轉畫布，而是在 Docs 設定畫筆顏色時（`fillStyle`、`strokeStyle`、`shadowColor`、漸層色標）攔截下來，用 OKLab 色彩空間翻轉亮度、保留色相，再交給 Docs。`drawImage()` 完全沒動到，所以圖片、彩色表情符號都和原檔一模一樣。實測和原圖逐像素比對，差異為 0。

工具列、選單、側欄這些介面（一般網頁元素）用 CSS 處理。

## 圖片複製／下載

Docs 的圖片按 Ctrl+C 只能貼到其他 Docs，貼到 LINE、Discord、ChatGPT 等對話框沒反應。滑鼠移到文件裡的圖片上，右上角會出現小工具列：

- **複製**：以 PNG 放進剪貼簿，任何軟體的對話框都能直接 Ctrl+V 貼上
- **下載**：存成原始圖片檔（檔名為「文件標題-圖片N」）

原理：圖片是用 `drawImage()` 畫在畫布上的，`image-saver.js` 在畫的時候記下每張圖的位置（包括先畫到離屏畫布再複製過去的情況）。取圖依序嘗試：Docs 自己的圖片資料 → 背景程式下載原圖（只允許 `*.googleusercontent.com`、`docs.google.com`）→ 頁面直接讀取 → 從畫面上裁下該區塊。這個功能不受深色模式開關影響，關掉深色模式也能用。

## 安裝（開發者模式）

1. 到 [Releases](../../releases) 下載最新版的 ZIP，解壓縮到一個不會刪掉的位置
   （或在本頁按綠色的 **Code → Download ZIP**）
2. Chrome 網址列輸入 `chrome://extensions`
3. 打開右上角的「開發人員模式」
4. 按「載入未封裝項目」，選解壓縮出來、有 `manifest.json` 的那個資料夾
5. 重新整理已經開著的 Google Docs 分頁

更新時，用新版檔案覆蓋原本的資料夾，再到 `chrome://extensions` 按插件卡片上的 🔄 重新載入。

## 設定

點工具列上的插件圖示：
- 深色模式：開啟／關閉／跟隨系統
- 主題：深灰／純黑（OLED）／柔和

切換後，已開啟的文件會自動重新整理（畫布要重畫才會換顏色）。

## 檔案

| 檔案 | 用途 |
|---|---|
| `page-hook.js` | 在頁面主環境攔截 Canvas 顏色並重新上色 |
| `image-saver.js` | 記錄圖片位置、顯示複製／下載工具列 |
| `background.js` | 下載跨網域的原始圖片 |
| `ui.css` | 工具列、選單、側欄的深色樣式 |
| `frame.js` | 在分享視窗等內嵌頁面裡還原圖片顏色與背景遮罩 |
| `content.js` | 把插件設定同步到頁面，設定改變時重新整理；轉送圖片下載請求 |
| `popup.html` / `popup.js` | 設定面板 |

## 已知限制

- 目前只支援 Google 文件（`/document/`），試算表和簡報尚未支援。
- 有透明背景的圖片，透明的地方會透出深色底。
- 複製一律是 PNG，GIF 動圖複製後會變靜態，要保留動圖請用「下載」；Docs 裡裁切過的圖，下載到的是裁切前的原圖。
- 改了 `manifest.json`（新增背景程式與圖片網域權限），更新後要在 `chrome://extensions` 按一下重新載入。
- 介面的 CSS 依賴 Docs 的 class 名稱（`#docs-chrome`、`.kix-appview-editor` 等），Google 改版可能要更新；文件本體的深色化不依賴 class 名稱，比較穩定。
