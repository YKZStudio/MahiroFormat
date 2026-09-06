# Mahiro Format 项目网站

[English](README.md) | [简体中文](README_zh_CN.md)

响应式纯静态网站。将本目录交给任意支持 HTTPS 的静态托管服务即可，无需安装依赖或执行构建。资源使用相对路径，支持仓库子目录托管。

页面读取 GitHub 最新发行版接口；`release-data.json` 保存经核验的备用发行信息，供无法连接 GitHub 的网络使用。维护网站时可用当前发行信息更新该文件。只有属于 YKZStudio/MahiroFormat、匹配所选系统的已发布安装包才会启用下载按钮；最新构建入口指向发行工作流。

Bilibili 主页入口位于桌面导航、手机菜单和页脚。下载区提供发行版页面、最新构建、GitHub 原始安装包和 GhProxy 加速链接。包含格式分类切换、截图放大、常见问题与复制链接功能。

图标使用 Phosphor Icons 2.1.1，MIT 许可证保存在 `assets/icons/LICENSE.txt`。角色素材沿用项目现有资源。

原作者：牢蜂（LaoFeng）；Mahiro Format 升级与维护：YKZStudio。非官方绪山真寻同人主题，无官方授权、合作或从属关系。仅供个人免费使用，禁止商业售卖/转卖/套壳。见 `LICENSE.txt` 与 `assets/ASSET-NOTICE.md`。
