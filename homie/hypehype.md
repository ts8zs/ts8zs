# GBG，但更难 —— HypeHype(EA)
大体是GBG的威力加强版 关于节点编程的优劣势可参考GBG一文  

# 优点  

- 有很多模版 看到的游戏都能改 虽然不一定改的动  
- 游戏切起来很快 应该有做预加载  
- 资源很小 可以快速加载每个游戏。资源由简单的风格化几何形状组成。面数通常低于2000。不支持任何纹理贴图，法线贴图但支持但支持UV贴图。  
https://wiki.hypehype.com/en/editor/asset-creation-instructions  
- 功能预制体和机制  
https://www.youtube.com/watch?v=3J8t8rLmoXg  
- 每月的gamejam保证了一定量的可玩游戏  
  
# 缺点  
  
- 编辑和游玩时偶现卡死闪退  
- wiki体验比较差 经常进入空页面(据说改进中)  
- 节点多了会比较震撼  
- 节点在场景里面导致经常找不到游戏逻辑节点  
- 编辑时经常迷失镜头  
- 没找到调高度雾和视距的地方 导致节点会随着缩放小时难以大规模编辑  
- 节点蓝图显示模式的默认排序有些问题，看起来比较混乱  
- 经常刷到一些不可玩游戏未完成游戏和增强版  
  
# 其他功能  
  
直播做游戏(做游戏默认会直播 可关) 但是在首页刷到我一般直接刷掉  
2d粒子编辑器 粒子编辑支持粒子片形状更换和一些参数调整,如颜色 但不支持3d粒子  
支持生成式8bit音效 https://wiki.hypehype.com/en/editor/components/audio/sound-generator  
播放列表 关卡  
  
# 美术风格  
  
目前，HypeHype中的通用艺术风格执行围绕着具有圆润边缘和扁平材料的简单形状，这是一种常见的超休闲外观。  
另一种艺术风格是简单形状平面阴影的多边形风格(lowpoly)。角色有自己的艺术风格分类。  
  
# 组件  
![fish](image.png)
## 加载项  
  
https://wiki.hypehype.com/en/editor/components/meta/add-ons  
加载项包含可轻松应用于对象的组件集合。将加载项拖到对象以将其组件应用于该对象。  
附加组件旨在创建游戏逻辑组，这些逻辑组可以应用于对象或单独使用，以便轻松地将游戏逻辑添加到 Hype 中。用户可以创建自己的附加组件，但有各种各样的预制附加组件和可重用项可用。  
  
## 容器(类似全局函数)  
  
https://wiki.hypehype.com/en/editor/components/meta/container  
容器是可以包含其他组件节点的节点。将组件节点拖放到容器中以将其添加到容器中。  
容器可以关闭和打开，在编辑器视图中隐藏或显示包含的组件。  

预制体和机制 https://www.youtube.com/watch?v=3J8t8rLmoXg  
金币预制体会发出的得分信号被Scoreboard,collect all coins等机制监听  

# 节点  

同是节点 两种表现 地图上和container是同一种 但在container里面是以节点表示  
container有input和output 代表可以从外部连入以及连出  

# 游戏模版主要类型  

休闲类 闯关类 平台跳跃 赛车 街机类 纯动画展示  

# 编辑器操作  

单指拖动 双指旋转和缩放  
选中时可以拖动控件进行移动旋转和缩放  
可以选择snap to grid和free move  

# 未来上线功能  

多人游戏  

> 您很快就可以和朋友一起玩，也可以制作自己的多人游戏  

编辑器改进  

> 向编辑器添加新的游戏制作功能和游戏逻辑，以便您可以制作各种游戏  
> 通过使所有人都能更轻松、更快速、更有趣地使用编辑器来改善编辑器体验 - 无论经验或技能如何  

更个性化的"为你而设"Feed  

> "为你而设"Feed将得到改进，为您带来更多更好的游戏和内容  

维基编辑器帮助  

> 您现在正在阅读的这份文件是一项正在进行的工作。我们正在努力扩展所有页面，以提供详细的解释，示例用法和其他类型的教程，用于您在HypeHype编辑器中可以使用的所有工具和功能  
> 我们还整合了所有信息，使此帮助门户成为您所有查询的一站式解决方案  

# 启示  

资源要简单但多样  
加载要快  
模版要多  
编辑器稳定性要好  
社区分享开源  