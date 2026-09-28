# Fenext 图标与界面素材

- `public/fenext-icon.png`：用户提供的白底原图，供网页 favicon 和 Apple touch icon 使用。
- `public/fenext-fox-transparent.png`：通过内置 image_gen 背景提取生成的透明 PNG，供登录页、侧栏等界面内品牌标识使用。
- `desktop/assets/icon-source.png`：保留狐狸原样、圆角瓷白底和透明四角的桌面图标源文件，由 `scripts/compose-desktop-icon.mjs` 从透明狐狸素材精确合成。
- `scripts/generate-icons.mjs` 从桌面源文件生成 macOS `.icns`、Windows `.ico` 和运行时 PNG；网页图标仍使用原图，托盘图标使用透明狐狸。

透明素材生成提示词（内置工具模式）：

```text
Use case: background-extraction. Edit target: the attached original Fenext pixel-art fennec fox head. Remove ONLY the white background and replace it with genuine fully transparent alpha in a PNG. Keep the exact original fox design, pixel-block edges, colors, facial expression, ears, eyes, nose, tongue, proportions, placement and canvas framing unchanged. Preserve light-colored pixels belonging to the fox, especially the eye highlights. No redrawing, no smoothing, no added shadow, no white outline, no checkerboard painted into the image, no text. Asset type: transparent cutout used at 40px in the app UI; must blend cleanly with warm gray backgrounds.
```
