# Docs True Dark

Google Docs 深色模式插件。**圖片保持原始像素，完全不變色。**

## 原理

Google Docs 把整份文件畫在 `<canvas>` 上。其他插件會用 CSS `invert()` 翻轉整張畫布，所以圖片也跟著變成負片；DarkWave 則是先翻轉、再把圖片翻回來，只能做到「接近原色」。

這個插件完全不翻轉畫布，而是在 Docs 設定畫筆顏色時（`fillStyle`、`strokeStyle`、`shadowColor`、漸層色標）攔截下來，用 OKLab 色彩空間翻轉亮度、保留色相，再交給 Docs。`drawImage()` 完全沒動到，所以圖片、彩色表情符號都和原檔一模一樣。實測和原圖逐像素比對，差異為 0。

工具列、選單、側欄這些介面（一般網頁元素）用 CSS 處理。

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
| `ui.css` | 工具列、選單、側欄的深色樣式 |
| `content.js` | 把插件設定同步到頁面，設定改變時重新整理 |
| `popup.html` / `popup.js` | 設定面板 |

## 已知限制

- 目前只支援 Google 文件（`/document/`），試算表和簡報尚未支援。
- 有透明背景的圖片，透明的地方會透出深色底。
- 介面的 CSS 依賴 Docs 的 class 名稱（`#docs-chrome`、`.kix-appview-editor` 等），Google 改版可能要更新；文件本體的深色化不依賴 class 名稱，比較穩定。
