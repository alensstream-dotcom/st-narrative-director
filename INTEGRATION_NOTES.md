# 无补丁集成记录

日期：2026-09-23。

## 已核实源码

- SillyTavern 1.18.0：`public/scripts/st-context.js`、`events.js`、`world-info.js`、`src/endpoints/backends/chat-completions.js`、`src/endpoints/extensions.js`。
- 安装的原版 st-chatu8 3.1.0：commit `4e1e8f8a6cab1375d39eb806a292516dbb9c43be`。
- 当前上游研究副本 3.1.2：commit `5f33ed1ac0b1e4caf87eb3703fb30a6cc5b0b50f`。
- 原版仓库：https://github.com/damoshen123/st-chatu8
- 官方扩展机制：https://docs.sillytavern.app/for-contributors/writing-extensions/

## 原版实际链路

上游 `index.js`：

- 2321：设置命名空间 `st-chatu8`。
- 24196、24303：角色/服装预设格式与初始化，`characterPresets`、`outfitPresets`、启用列表相互独立。
- 24319、24342、24371：角色的 `outfits` 是服装预设 ID 列表；服装预设有中英名、`owner`、上半身/全身及背面描述。导演按此格式增加有证据的新服装或复用已关联服装，不改启用列表。33113 的原版角色展开器从启用人物的 `outfits` 中读取候选，但没有逐任务服装覆盖入口。
- 33113：`processCharacterPrompt`，依赖全局启用列表，且写入全局人物负面词。
- 46819：`replacepro` 将智绘姬工作流占位符替换为实际参数。
- 46864：`generateComfyUIImage`，原生队列、串行锁、角色展开、固定词、工作流、酒馆代理/直连。
- 47374：`comfyuigenerate` 监听 `generate-image-request` 并返回 `generate-image-response`，含请求 ID、图片或错误。它仍在执行中读取全局设置，没有任务级快照入口。
- 47684：`generateBananaImage`，云端多格式执行，亦读取全局设置。
- 7933：`saveChatImage` 私有存储函数；51745、53995：私有图片显示/查看器。没有模块导出，无法宣称第三方能直接调用。

## 最终选择

用户明确拒绝修改原版插件，因此放弃补丁。项目未包含原版执行器代码或其重打包副本。

独立适配器读取原版角色/工作流配置，通过 SillyTavern 官方服务器端接口执行：

- `/api/sd/comfy/generate`：提交任务局部 API workflow。
- `/api/backends/chat-completions/generate`：独立导演 API、支持范围内的云端图片 API。
- `/api/images/upload`：酒馆图片持久化，不另建图片数据库。

这条路径保留原版更新与设置，但不复用其内部队列/提示词替换规则/私有缓存查看器。固定正负提示词在确认框显示，任务不再二次改写剧情。不要称为“原版智绘姬执行了该任务”。

用户后来指定 Miaomiao Harem 及当前配套工作流。服务器保存的 `anima加速.json` 已使用该模型，配套参数为 12 步、CFG 2.5、Euler/simple、896×1152、加速 LoRA 0.8、ModelSamplingAuraFlow shift 3 / flow。新插件独立模板保留这些节点与连接，仅替换正负词、种子、输出名前缀。未能读取浏览器未保存画布，不能断言未保存状态与服务器文件完全相同。原版旧 JANIMA 8 步配置未改。

可直接访问 ComfyUI 时按真实 prompt ID 轮询队列及历史；浏览器限制直连时回退酒馆原生代理，界面只显示“已提交”，不虚构原生任务 ID。酒馆 1.18.0 代理在连接断开时会调用全局 interrupt：插件不主动取消该 fetch，但关闭页面/网络断开仍有此上游风险。取消按钮只取消排队或晚到图片展示。

## 隔离与生命周期

任务配置保存于适配器 WeakMap，只向聊天记录写入不含秘密的参数摘要。工作流按 JSON 结构替换，不对正文做关键词补丁。切换原版模型不会改变已确认任务的快照。

监听已核实的 `GENERATION_STARTED`、`STREAM_TOKEN_RECEIVED`、`GENERATION_ENDED`、消息/聊天/Swipe 生命周期。流式事件处理不等待网络。`WORLD_INFO_ACTIVATED` 只读实际激活条目。

原文与隐藏思考分离，source span 校验，消息 UUID+聊天+Swipe+前缀指纹绑定。重复完成/取消后完成不再次插图。

## 许可证

原版 st-chatu8 使用 Aladdin Free Public License v9，不是 MIT/Apache。本项目仅独立实现协议适配，无原版代码打包、不修改原版文件。上游文档/源码仅作为接口核查依据；没有默认获得分发原版改版的许可。独立项目文件使用本仓库 LICENSE。
