# 智绘姬无补丁集成记录

核对日期：2026-09-24。目标 SillyTavern 1.18.0、原版 `st-chatu8` 3.1.2（上游研究副本 commit `5f33ed1ac0b1e4caf87eb3703fb30a6cc5b0b50f`）。原版许可证为 Aladdin Free Public License v9；本仓库未复制或修改其源码。

## 已核实的入口

- 智绘姬设置命名空间 `extension_settings['st-chatu8']`，人物与服装在 `characterPresets`、`outfitPresets`；启用列表独立。导演只读/增量建档，不覆写全局启用列表。
- 3.1.2 的 `findAndReplaceInElement` 识别 `startTag + prompt + endTag`，生成 `.image-tag-button` 与 `.st-chatu8-image-span`。默认标记为 `image###` 和 `###`。
- `zidongdianji='true'` 开启普通自动点击；`zidongdianji2` 是激进永久自动点击，不启用。智绘姬监听 `js_generation_ended` 以开启自动点击窗口并处理最新消息。
- 智绘姬的原生 `generateComfyUIImage` 对工作流变量 `%prompt%`、`%negative_prompt%`、`%seed%` 进行替换，负责队列、图片缓存与正文内展示，并在 `generate-image-response` 通知结果。
- `client='jiuguan'` 使用酒馆服务器代理 ComfyUI。手机连接电脑上的酒馆时，`127.0.0.1` 因此指酒馆所在电脑。

## 采用的协议

导演在 `message.extra.narrative_director_v1.prompts` 保存镜头、原文范围、消息/Swipe 指纹和最终英文 prompt；不修改 `message.mes`。前端把标记临时插到对应段落后，交给智绘姬解析；酒馆重画消息后，导演从元数据重建标记。原文变更、换聊天或 Swipe 不再恢复旧标记。对正在生成的消息，第一张可在流式中段插入，结束后才选最终兜底镜头。相同原文锚点与提示词不会重复提交。

本项目不直接调用 ComfyUI 生图作为主路径，不触碰智绘姬的私有队列或图片数据库。应用配套配置是用户主动操作，只新建一个工作流/固定词预设，保留既有预设和人物数据；改动字段可回退。智绘姬的 `MODEL_NAME` 下拉框列出 checkpoint，可能不包含独立 UNet 文件；执行模型以选中工作流的 `UNETLoader.inputs.unet_name` 为准。

## 验证边界

已在本机真实酒馆中观察到：两个原文位置按钮在界面重画后仍各只有一个；自动点击将专用 Miaomiao 工作流提交至 `http://127.0.0.1:8188`；ComfyUI 成功输出；智绘姬 `generate-image-response` 返回成功且 `.st-chatu8-image-span` 内显示 896×1152 图片。端到端测试使用临时消息，回调导致的一条测试消息已从酒馆聊天中精确清理并复查原三条未动。安卓真机手势和不同设备的导出/导入仍待用户端验证。
