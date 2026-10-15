# 资料检索 · Markdown RAG

在自己的电脑上检索Markdown资料。原文留在原处，不复制、不改写。支持关键词与云端向量混合检索、全文定位、页码出处、作者识别。

## 下载与使用

请在本仓库 **Releases** 下载对应系统的ZIP，**不要下载 Source code 当作免安装包**：

| 电脑 | 包名 |
|---|---|
| M1/M2/M3/M4 等 Apple Silicon Mac | md-rag-macos-arm64.zip |
| Intel Mac | md-rag-macos-x64.zip |
| Windows 64位（Intel/AMD） | md-rag-windows-x64.zip |

解压保留整个文件夹：Mac 双击 `启动.command`，Windows 双击 `启动.cmd`。浏览器自动打开 http://127.0.0.1:7789/ 。停止时双击对应的“停止服务”。包内自带Node.js，不要求用户安装开发环境。

若Release尚未出现，表示构建或验证尚未完成，不能视为各系统已可用。Windows ARM、32位Windows暂不支持；Windows图形文件选择窗口还需实际桌面人工检查，路径输入可作替代。

填写自己的API地址、嵌入模型、密钥并保存，添加Markdown文件夹后等待处理。也可先用关键词模式。语义处理会将文本发送到所配置服务并按自己的账户计费。

## 功能

- 一个文件夹一个资料集，增量更新、暂停与继续。
- 返回20/50/100篇；按关键词与语义名次综合排序。
- 第一处、最相关处、上一处/下一处、序号与位置条跳转。
- 其他关键词蓝色高亮，当前处绿色。
- 正文隐藏 `**【PDF 第x页｜原书第x页】**` 等页标，出处保留页码和待确认状态；原Markdown不变。
- “题目_中文作者.md”分开显示题目、作者；复制段落附出处。
- 当前默认以Markdown文件合并结果。多文章杂志的文章边界识别仍处试验阶段，未宣称全库自动分篇。个人试分记录不随公开仓库发布。

## 数据与开发

个人配置、索引、日志仅存本地 `data/`，不提交GitHub。API密钥不随程序发布。升级前停止旧版、备份data，不跨系统直接迁移原生索引；源Markdown可重新建库。

开发环境需要Node.js 24：`npm ci`，`npm start`。`npm test`执行离线集成验证，不调用真实云端API。打包：在目标系统运行 `python scripts/package.py`，输出到dist。

GitHub Actions分别在Mac ARM、Mac Intel、Windows x64运行测试。只有全部通过，打版本标签后的发布任务才会上传三个使用包与SHA256校验值。尚未成功运行的流程不算平台验证完成。

## 组件与权利

向量引擎使用[@zvec/zvec](https://github.com/zvec-ai/zvec-node)，遵循Apache-2.0；Node.js遵循其随包许可证。详见THIRD_PARTY_NOTICES.md。项目源自原有zvec-live方案的Mac适配与界面简化，未擅自为上游业务代码新增开源许可证。
