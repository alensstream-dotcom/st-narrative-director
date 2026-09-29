# 智绘姬 Anima 工作流：增加人物差异

这份说明对应用户提供的 `st-chatu8-workflow-anima30s酒馆 (1).json`，以及两张 `ComfyUI_00176_ (1).png`、`ComfyUI_00134_.png`。图片元数据是实际提交给 ComfyUI 的提示词和节点设置；没有进行新一轮生图测试。

## 观察

两图种子分别为 `466889648` 和 `1431995479`，并非固定种子。两图都使用 `miaomiaoRealskin_anima13.safetensors`、`anima-turbo-lora-v0.2.safetensors`（模型/文本强度均 `0.7`）、正面词 `<wlr:DogmaV6.1-000020:0.8:1>`。初次采样为 12 步、CFG 1、Euler、sgm_uniform；放大后第二轮以原底模重绘，10 步、去噪 0.3。两张图片都带有相同的固定正面词：`fair skin`、`high contrast`、`photorealistic`、`raw photo`、`photo background`。实际人物描述一个是栗棕色波浪发，一个是浅棕茶色及肩发；它们在发色和肤色上本身就接近。

由此无法单独证明 Dogma 是唯一原因。但高强度 Dogma、Turbo 的默认画风、固定审美词、相近的身份特征以及二次重绘，都可能压缩人脸与风格差异。Anima 官方模型卡明确说 Turbo 的蒸馏会增强默认画风、降低多样性：[Anima 模型卡](https://huggingface.co/circlestone-labs/Anima)。

工作流里的节点 22 是 `WeiLinPromptUI`。它的作者文档明确支持 `<wlr:名称:模型权重:文本权重>`，因此本工作流应继续使用 `wlr` 形式：[WeiLin-Comfyui-Tools](https://github.com/weilin9999/WeiLin-Comfyui-Tools)。PNG 证明这个标签进入了提交的正面词；是否成功找到相应 LoRA 文件，还应以 ComfyUI 加载日志为准。

## 建议先替换的智绘姬固定词

正面固定词：

```text
masterpiece, best quality, detailed illustration, <wlr:DogmaV6.1-000020:0.55:0.65>
```

负面固定词：

```text
worst quality, low quality, bad anatomy, extra fingers, watermark, logo, text, signature
```

保留 Dogma 的审美效果，但把模型强度从 0.8 降到 0.55、文本强度从 1 降到 0.65。去掉对所有人物统一指定的浅肤色、强对比、摄影风格和照片背景；需要这些特征时再由具体人物或场景提供。负面词不再全局禁止年长外观、背光和简单背景，避免抹掉人物年龄与镜头差别。质量方面仍保留 `masterpiece` 与 `best quality`。这个强度是有依据的起始方案，不是已经实测证明的最优值。

如果觉得美感损失明显，可以只把 Dogma 调回 `0.7:0.8`；若人脸仍然过于相似，再试 `0.45:0.55`。每次只改一组设置，比较同一人物提示词与同一种子，才能判断哪项设置起作用。世界书本身也会优先使用人物已有的独特发型、瞳色、眼型、脸部轮廓或标记，同一角色跨图保持这些词一致。不要为制造差异而乱加数据库没有记录的五官。

## 工作流文件

已另存到下载目录：`C:\Users\LZ339\Downloads\anima30s酒馆-人物多样-轻重绘.json`。它只把第二轮 KSampler（节点 14）的去噪从 `0.3` 调到 `0.2`，其余节点、模型、Turbo LoRA、Euler、sgm_uniform 与智绘姬占位符保持原样。旧文件仍可随时导回。

这个工作流调整只能减少第二轮重绘造成的人脸漂移，不能替代固定正面词的修改。两份修改建议一起使用，且不要求改正文主 API 的模型、推理强度或回复长度。
