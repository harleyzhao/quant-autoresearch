# 调研报告：SpeedTree 现状、竞争格局与近年植物生成研究

> 日期：2026-09。配套文档：`02-方案-超越SpeedTree的Web端植物生成器.md`。
> 注：本次网络代理屏蔽了 arXiv / Purdue / Epic 文档原站，论文方法细节部分来自已有知识，已在文中标注「(记忆)」。

---

## 1. SpeedTree 现状（2024–2026）

### 1.1 产品形态

- **SpeedTree Modeler 10**：2024 年 9 月由 Unity 发布，合并了原先的 Games 版和 Cinema 版，用可配置的导出选项区分行业。
- **SpeedTree Library**：官方物种资产库，2026 年 5 月起改为订阅制，年费 999 美元，可单独订阅或作为 Modeler 许可的附加项。
- **许可分级**（按年收入）：Learning（免费，不可导出）、Indie（<20 万美元，单机、需联网）、Pro（20 万–100 万，可浮动许可）、Enterprise（>100 万，按项目授权）。
- 2021 年 7 月被 Unity 收购。Unity 之外的引擎（UE、Godot、离线渲染）通过 FBX / USD / 各引擎 SDK 接入。

### 1.2 核心能力（10.x 为准）

| 类别 | 能力 |
|---|---|
| 建模范式 | **Generator 层级**（Trunk → Branch → Frond/Leaf/Cap 等），每个 generator 有上百个属性曲线；并非生长模拟，而是「按层级批量放置」的参数化模型 |
| 手绘 | Freehand 模式手绘枝干；10.0 新增 **Trim** 剪枝工具 |
| 自动修剪 | **Shade Pruning**：后处理删除树冠内部被遮蔽的枝，既拟真又减面 |
| 藤蔓 | 10.0 新增物理藤蔓 generator，受重力、贴地、可在多棵树之间悬垂，响应风 |
| Hero mesh 融合 | 10.0 新增 mesh helper：在扫描/手工主干网格上画曲线做「spine-only」枝干，再挂程序化 generator，是它对接摄影测量的主要路径 |
| 季节 | 自 v8 起有 Season 滑条（叶色、落叶、花果）；10.1 为多个 generator 增加了更细的季节过渡属性 |
| 风 | 自带 Wind Wizard，层级化顶点动画（trunk / branch / leaf 频率分层），导出到引擎 SDK 或烘焙到顶点色 |
| 材质 | 依赖 Library 或用户导入的 PBR 贴图；叶片图集(atlas)烘焙器；无程序化树皮/叶片材质系统 |
| LOD | 自动 LOD、billboard；引擎 SDK 侧做过渡 |
| 导出 | FBX、USD、Alembic（Cinema 曲线/生长动画）、.st9 运行时、Unity/UE 原生格式 |

### 1.3 SpeedTree 的结构性弱点

1. **不是生长模型**。Generator 层级的本质是「在父枝上按曲线分布子枝」，没有芽竞争、光/空间响应、顶端优势、年龄等因果关系。真实感高度依赖艺术家调几百个曲线，物种间迁移差。
2. **季节是「贴图切换 + 叶片开关」**，而非物候过程。没有芽萌发、叶展、老化、离层等时间轴，无法从同一棵树产出「同株 20 年、同株四季」的一致性序列。
3. **形状控制手段间接**。想要「树冠靠这边、下方无枝、被墙挡住」必须手改或用 mesh force；缺少体积/轮廓/环境（相邻树、建筑、光照）驱动。
4. **树皮/分叉几何粗糙**。枝干是 lofted 圆管，分叉处靴口(cap)与 weld 贴图拼接，近景特写（电影）需再进 ZBrush/Houdini。
5. **材质不是程序化的**。库贴图订阅制，且缺乏「树皮随年龄/直径/湿度变化」的参数化表达。
6. **桌面单机、按机器授权**，无协作、无版本、无云算；学习曲线陡（论坛常见吐槽）。
7. **与 Unity 绑定后的中立性顾虑**：UE 生态已在 5.7 自建 PVE（见下）。

---

## 2. 竞争格局（2026）

| 产品 | 定位 | 对我们的意义 |
|---|---|---|
| **Unreal 5.7+ Procedural Vegetation Editor (PVE) + Quixel Megaplants** | 2025-11 起引擎内置（Experimental），基于 PCG 节点，用 Megaplants「配方」（扫描的枝/叶部件 + 骨架网格 + 材质）实时生长、重力调形、导出 static/skeletal mesh；与 **Nanite Foliage**（Assemblies 部件实例化、Skinning 风动、Voxel 远景）深度绑定。首批 5 个欧洲树种，免费 | 最强对手。免费、在引擎里、渲染最强。但：只在 UE、依赖扫描部件（物种有限）、不能做物候/生长时间轴、不跨平台、不能在 Web 协作。我们必须能**导出到它能吃的格式**，而不是与之正面对撞 |
| **Natsura**（Houdini） | 2026-04 早期访问，生长引擎 + 节点工具包，面向 Nanite-ready 输出，1.x 一次性买断 | 证明「生长模拟 + 现代引擎输出」有市场；但锁死 Houdini |
| **The Grove 3D**（Blender/Houdini 插件） | 真正的逐年生长模拟，光/重力响应，季节交互 | 生长思路的先行者，但产品化程度低、性能弱、材质靠外部 |
| **PlantFactory / VUE**（e-on / Bentley） | 2025-05 停止开发，免费开放 | 高端离线植物工具市场出现空缺 |
| Blender Sapling / Modular Tree / TreeIt / ngPlant / Arbaro | 免费或业余向 | 说明 Weber-Penn 类参数模型的天花板 |
| Web 开源：**EZ-Tree**、**SeedThree**（three.js WebGPU，20 物种，Weber-Penn + L-system，4 级 LOD，glTF 导出，MIT，v0.1 alpha） | 证明 three.js/WebGPU 路线可行 | 可作参考/对比基线，质量距电影级很远 |

**结论**：市场正在从「参数化 generator（SpeedTree）」转向「生长模拟 + 引擎原生渲染（PVE、Natsura）」。空白点是：**跨引擎、跨平台、Web 协作、物候/年龄时间轴、程序化材质、电影级近景几何**。

---

## 3. 近年学术前沿（按主题）

### 3.1 骨架/分枝结构生成

| 年份 | 工作 | 要点 | 可用性 |
|---|---|---|---|
| 1995 | Weber & Penn *Creation and Rendering of Realistic Trees* | 参数化层级模型，SpeedTree / Blender Sapling / SeedThree 的祖师；重几何、不重植物学 | 公开 |
| 2009 | Pałubicki et al. *Self-organizing tree models* (SIGGRAPH) | 芽竞争光/空间 + 内部信号（顶端优势、资源分配 BH 模型），空间殖民(space colonization) 变体。真实感与物种多样性来自少量生物学参数 | 公开，算法明确 |
| 2022 | *Ecoclimates* (SIGGRAPH, Pałubicki/Pirk) | 植被–土壤–气候反馈，50 万株个体几何交互式模拟 | 概念参考 |
| 2023 | *DeepTree: Modeling Trees with Situated Latents* (TVCG) | 神经「生长策略」：局部环境编码 → 下一步分枝决策，替代手写规则 (记忆) | 论文 |
| 2023 | *Latent L-systems* (TOG, Lee/Li/Benes) | Transformer 学习 155k 树的 L-string 分布，替代手写产生式 | 代码开源 |
| 2024 | *Tree-D Fusion* (ECCV, Benes 组) | 单图 → 扩散先验(SDS) 重建树冠包络 → 按属(genus)条件化空间殖民填充分枝；产出 60 万棵「环境感知、可仿真」树 | 代码/数据开源 |
| 2025 | *Autoregressive Generation of Static and Growing Trees* (SIGGRAPH Asia, Wonka 组) | 树 = 圆柱集合（两端点 + 半径）token 化，沙漏形多分辨率 Transformer；支持无条件、图像/点云/草图条件、补全、**4D 生长**。叶子仍程序化添加 | 论文（代码待查） |
| 2025 | *Tree Skeletonization from 3D Point Clouds by Denoising Diffusion* (ICCV) | 点云 → 骨架的扩散模型 | 论文 |
| 2025 | TreeStructor (TGRS)、GaussianPlant (arXiv 12/2025)、TreeFormer | 森林点云/3DGS → 逐株网格与骨架 | 扫描→程序化的输入源 |

**启示**：
- 结构真实感的正解已是**自组织生长**（2009 起），神经方法只是让「规则」变得可学习、可从图像/点云/文本反推。
- 2025 两条线值得直接采用：(a) 圆柱 token 自回归模型作为「灵感/初稿生成器」和「图像→树」通道；(b) Tree-D Fusion 的「包络 + 条件化空间殖民」作为用户**画轮廓/给参考图 → 树**的工程路径，且不需要训练即可先做。

### 3.2 木质体、分叉与树皮几何

| 年份 | 工作 | 要点 |
|---|---|---|
| 2024 | *Interactive Invigoration: Volumetric Modeling of Trees with Strands* (TOG, Li/Pałubicki/Pirk/Benes) | 用**strand（束）**表示树体：每根 strand 从根到某个末端芽，枝干截面 = 穿过的 strand 束（对应管道模型/达芬奇法则）。自然得到非圆截面、分叉融合、树皮纵脊、年轮；生长 = 加 strand。交互速率 (记忆) |
| 2025 | *Stressful Tree Modeling: Breaking Branches with Strands* (SIGGRAPH) | 同一表示扩展到力学：短时标弯折/扭转/断裂，长时标压缩木/拉伸木 → 真实枝形与断口 |

**启示**：这是 SpeedTree「lofted 圆管 + 靴口贴图」的直接替代，能把近景（电影）分叉、树瘤、断枝、树皮开裂做成**结构性**而非贴图性效果。工程上可退化为：骨架 + 每段 strand 计数 → 截面轮廓 → 蒙皮，成本可控。

### 3.3 叶片：形态、脉络、季节

- Runions et al. 2005 *Modeling and visualization of leaf venation patterns*：生长素源 + 脉络竞争，可生成任意叶形的脉络 → 直接用作程序化叶片法线/透射贴图的骨架。
- 叶片老化/季节：Markov 链驱动颜色与卷曲（温度、湿度、时间参数）；干燥叶片用双层三角网格 + 脉络约束 Delaunay/Voronoi 做卷曲皱缩（PMC 2013 等）。
- 真实感渲染：Wang et al. 2005 *Real-time rendering of plant leaves*（空间可变 BRDF/BTDF）；Habel et al. 2007 *Physically Based Real-Time Translucency for Leaves*。这两者是「双面 + 透射 + 次表面」叶片材质的基础，至今引擎仍在用简化版。

### 3.4 风与动画

- 工业标准：UE **Pivot Painter 2.0**（层级枢轴烘焙进贴图，按深度分组的风参数）；Crytek/GPU Gems 3 顶点级风。
- 2025 *DynamicTree* (arXiv 10/2025)：4DTree 数据集 8,786 棵 100 帧物理可信风动序列；用**稀疏体素频谱**表示模态振动，实时驱动真实扫描树。
- Nanite Skinning（UE 5.7）：树用骨骼蒙皮 + 组装件实例，50 万棵树亚毫秒骨骼更新（Witcher 4 演示）。

**启示**：我们生成时天然有层级骨架，可**免费**导出 Pivot Painter 兼容数据、骨骼蒙皮、以及模态频谱三种风表示，比 SpeedTree 的顶点色方案更通用。

### 3.5 实时渲染与 LOD

- **Nanite Foliage**（UE 5.7）：Assemblies（重复部件实例化，3.5 GB → 29 MB）、Voxel 远景、Skinning。是目前游戏侧最强方案。
- Web 侧：three.js r171+ WebGPURenderer 生产可用；BatchedMesh + meshoptimizer LOD；InstancedMesh2 + BVH 剔除；社区已有 19 万棵树 + 八面体 impostor 的 WebGPU 演示；SeedThree 用 Web Worker 离线烘焙 impostor。
- WebGPU 已在 Chrome/Edge/Safari 26/Firefox(Win/Mac) 默认开启，Firefox Linux/Android 2026 内补齐。

### 3.6 贴图与材质的程序化/神经生成

- MatFormer（Adobe，Transformer 生成 Substance 图）→ **VLMaterial**(2025, 视觉语言模型生成程序化材质) → **MultiMat**(2025, 多模态程序合成) → **ProcTex**(2025, 面向部件化程序模型的文生贴图) → Chord(2025, 生成图 → PBR 分解)。
- 意义：树皮/叶片/苔藓/地衣可以用**节点图 + 少量参数**表达，并由图像/文本反推参数，摆脱对扫描库订阅的依赖，同时天然支持「随年龄/直径/湿度/季节连续变化」。

---

## 4. 综合判断

1. **SpeedTree 的护城河是「工业管线成熟度 + 引擎 SDK + 资产库」，不是算法。** 它的算法内核（Weber-Penn 式 generator）已被 2009 以来的生长模型和 2023 以来的神经方法在真实感与可控性上超越。
2. **UE PVE 抢的是「游戏 + UE」这一块**，并把 Nanite 当护城河；它没有解决电影、跨引擎、Web 协作、时间轴、程序化材质。
3. **要「超越」，必须在四个维度同时领先**：真实感（生长 + strand 几何）、可控性（轮廓/环境/参考图/文字驱动）、时间轴（年龄 + 物候 + 风）、材质（程序化、状态化），再用 Web 平台补上协作与分发。
4. **不要重造渲染器护城河**：目标是把最好的数据（骨架层级、strand 截面、部件实例、风层级）导出给 UE/Unity/Houdini/USD，让 Web 端预览「足够好」而不是「取代 Nanite」。

参考链接见文末「资料来源」。

---

## 资料来源

SpeedTree
- https://unity.com/products/speedtree
- https://www.cgchannel.com/2024/09/unity-releases-speedtree-10/
- https://cgpress.org/archives/speedtree-10-released-with-vines-freehand-pruning-mesh-rigging-and-more.html
- https://docs.unity3d.com/speedtree-modeler/manual/whats-new.html
- https://support.unity.com/hc/en-us/articles/15723241438228
- https://support.unity.com/hc/en-us/articles/49699142648980-How-do-I-receive-my-SpeedTree-Library-purchase

竞品
- https://dev.epicgames.com/documentation/unreal-engine/procedural-vegetation-editor-pve-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/nanite-foliage
- https://www.unrealengine.com/news/unreal-engine-5-7-is-now-available
- https://digitalproduction.com/2025/10/17/unreal-5-7-preview-pcg-grows-up-foliage-gets-fancy/
- https://quixel.com/news/quixel-on-fab-new-megascans-and-megaplants
- https://www.cgchannel.com/2026/04/houdini-plant-generation-toolkit-natsura-is-now-in-early-access/
- https://www.natsura.com/features
- https://www.thegrove3d.com/
- https://www.cgchannel.com/2024/05/download-e-ons-plantfactory-plantcatalog-and-vue-for-free/
- https://github.com/SkyeShark/SeedThree
- https://github.com/dgreenheck/ez-tree

论文
- Weber & Penn 1995: https://courses.cs.duke.edu/cps124/fall01/resources/p119-weber.pdf
- Self-organizing tree models 2009: https://algorithmicbotany.org/papers/selforg.sig2009.small.pdf
- Ecoclimates 2022: https://dl.acm.org/doi/10.1145/3528223.3530146
- DeepTree 2023: https://arxiv.org/pdf/2305.05153
- Latent L-systems 2023: https://dl.acm.org/doi/10.1145/3627101 ；代码 https://github.com/JaeLee18/ACM-TOG-Latent-L-systems-Transformer-based-Tree-Generator
- Tree-D Fusion 2024: https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/05802.pdf ；代码 https://github.com/JaeLee18/TreeDFusion_ECCV24
- Interactive Invigoration (strands) 2024: https://dl.acm.org/doi/10.1145/3658206
- Stressful Tree Modeling 2025: https://dl.acm.org/doi/10.1145/3721238.3730745
- Autoregressive Generation of Static and Growing Trees 2025: https://arxiv.org/abs/2502.04762
- Tree Skeletonization by Denoising Diffusion 2025: https://openaccess.thecvf.com/content/ICCV2025/papers/Marks_Tree_Skeletonization_from_3D_Point_Clouds_by_Denoising_Diffusion_ICCV_2025_paper.pdf
- TreeStructor 2025: https://lewkesy.github.io/treestructor/
- GaussianPlant 2025: https://arxiv.org/pdf/2512.14087
- DynamicTree 2025: https://arxiv.org/pdf/2510.22213
- Leaf venation 2005: https://algorithmicbotany.org/papers/venation.sig2005.pdf
- Real-time rendering of plant leaves 2005: https://dl.acm.org/doi/10.1145/1073204.1073252
- Leaf translucency 2007: https://www.cg.tuwien.ac.at/research/publications/2007/Habel_2007_RTT/Habel_2007_RTT-Preprint.pdf
- Seasonal leaf change: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3596921/
- VLMaterial 2025: https://arxiv.org/pdf/2501.18623 ；MultiMat 2025: https://arxiv.org/pdf/2509.22151 ；ProcTex 2025: https://arxiv.org/pdf/2501.17895

Web / 渲染
- https://web.dev/blog/webgpu-supported-major-browsers
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- https://discourse.threejs.org/t/a-forest-of-octahedral-impostors/85735
- https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610
- https://dev.epicgames.com/documentation/unreal-engine/pivot-painter-tool-2.0-in-unreal-engine
