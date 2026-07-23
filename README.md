# 會唱歌的尺｜Singing Ruler Lab

繁體中文、理論先行的互動教學網頁，用Euler–Bernoulli懸臂梁模型解釋2026 TYPT第13題 **The Singing Ruler**。

**正式網站：** <https://addielu-phy.github.io/singing-ruler-lab/>

## 內容

- 從等效彈簧模型銜接到連續梁偏微分方程
- 固定—自由邊界條件與前四個特徵根
- 長方形截面的基頻公式
- 長度、厚度、材料、振幅與模態互動實驗
- Euler–Bernoulli與EB模態Rayleigh–Ritz轉動慣量近似比較
- 真實實驗的夾具、阻尼、聲輻射與非線性限制

核心公式：

```text
fₙ = βₙ² / (2πL²) · √(EI / ρA)
```

對寬 `b`、彎曲方向厚度 `h` 的長方形尺：

```text
fₙ = βₙ² / (4π√3) · h/L² · √(E/ρ)
```

## 本機執行

網站本體是零依賴靜態HTML／CSS／ES modules：

```bash
python -m http.server 9057 --bind 127.0.0.1
```

開啟 <http://127.0.0.1:9057/>。

## 驗證

安裝僅供開發QA使用的套件：

```bash
npm install
npx playwright install chromium
npm test
BASE_URL=http://127.0.0.1:9057/ npm run qa
```

驗證範圍包括：

- 11項物理與輸入防禦回歸測試
- 1440、1024、921、920、390、320像素寬的精確視窗
- 長度平方反比、厚度正比、寬度消去、模態比、Rayleigh–Ritz係數
- 暫停、重設、自訂材料驗證、hash焦點與reduced-motion
- 水平溢出、觸控尺寸、公式可讀文字與axe WCAG A/AA

## 模型邊界

此網站模擬的是梁的固有彎曲振動，不是完整聲學數位孿生。模型未完整包含夾具滑動、材料阻尼、空氣附加質量、Timoshenko剪切效應、碰撞、真實麥克風與房間響應。音訊按鈕只播放單一理論頻率的合成純音。

## 來源

- [使用者提供的TYPT簡報](https://docs.google.com/presentation/d/1KL1EgClQH7qyMllYU0xf3RIf7cquG6kQ/edit)
- [GYPT第13題：The Singing Ruler](https://www.gypt.org/aufgaben/13-the-singing-ruler.html)

## 授權

MIT License。詳見 [LICENSE](LICENSE)。
