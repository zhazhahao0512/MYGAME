# 战斗界面素材

R032 按用户提供的原战斗概念图学习美术方向。所有 UI 文字、数值、按钮与单位仍由 HTML/CSS/Phaser 实际绘制；没有将一张带 UI 的生成图覆盖成游戏。

- `gothic-courtyard.png`：使用图像生成工具，以用户提供的战斗概念图作风格参考生成的无文字、无角色、无 UI 的哥特庭院背景（1672×941）；原生成文件 `exec-7092f2ab-1674-4023-9778-fe193b1ffcef.png` 原样复制，没有后期裁剪/重绘。运行时由 CSS 按战场区域显示。
- `iron-grain.svg`、`stone-wall.svg`：代码绘制的细噪声铁纹与石砖平铺纹理。
- `metal-corner.svg`、`ornate-frame.svg`：代码绘制的金属角饰与可缩放四角边框；不含外部引用，装饰不拦截点击。
- `fonts/expedition-serif.woff` 与 `expedition-serif-bold.woff`：Noto Serif CJK SC Regular/Bold 的当前源码文字子集，保留拉丁字符及数字；来源为环境安装的 Noto CJK TTC，字库索引 2。授权完整保留于 `fonts/LICENSE.txt`（包含 SIL OFL 1.1），随部署分发。CSS 名称为 Expedition Serif，不依赖用户电脑预装字体；新增子集外文字会使用本机衬线字体回退。
- `dungeon-background.png`：R028 的旧环境图，保留为历史素材；当前战斗使用 gothic-courtyard。

字体子集只在增补字形时重新生成，不属于普通构建依赖。维护者可在具有 Noto CJK 与 FontTools 的环境，把 `src/` 的 JS/TS/CSS 文本及 ASCII 32–126 写入 UTF-8 临时文件，然后运行：

```sh
pyftsubset /usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc --font-number=2 --text-file=/tmp/mygame-font-characters.txt --flavor=woff --output-file=public/art/fonts/expedition-serif.woff
pyftsubset /usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc --font-number=2 --text-file=/tmp/mygame-font-characters.txt --flavor=woff --output-file=public/art/fonts/expedition-serif-bold.woff
```

采用已验证的 WOFF；环境缺少 Brotli Python 扩展，未将 WOFF2 作为构建前提。字体和素材均由自有游戏服务器提供，游戏运行不请求第三方字体或图片服务。
